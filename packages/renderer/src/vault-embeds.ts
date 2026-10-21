import { parseWikilink } from "markdown";
import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { imageKey, known } from "./vault-links";

// A block-level image for an embed that is a line to itself (docs/architecture.md
// § Live preview; spec #751). Off the cursor's line `![[diagram.png]]` is the
// picture; on it, the text, as every other piece of live-preview syntax is.
// A StateField, not the live-preview ViewPlugin: a block decoration may not
// come from a plugin.
//
// What the embed names is the index's answer (`known`, filled by `vaultLinks`
// through `vault.resolveLinks`), never a name resolved here. An embed that has
// not resolved to an image stays the text it is.

// The extensions the core's bytes route serves (`VAULT_IMAGE_TYPES`).
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;

const wikilinkText = (raw: string) => raw.replace(/^!?\[\[/, "").slice(0, -2);

// What to undo when a drawn image goes. Kept per element, not per widget:
// CodeMirror reuses the DOM of an `eq` widget and drops the new instance, so
// the instance that runs `destroy` is not the one that ran `toDOM`.
const cleanups = new WeakMap<HTMLElement, () => void>();

// `|300` is a width and `|WxH` both; the image keeps its proportions when only
// the width is given. Any other alias is the link's display text, which an
// image has none of, so it draws at its natural size.
type Size = { width: number | null; height: number | null };

function sizeOf(alias: string | null): Size {
  const m = /^(\d+)(?:x(\d+))?$/.exec(alias?.trim() ?? "");
  if (m === null) return { width: null, height: null };
  return {
    width: Number(m[1]),
    height: m[2] === undefined ? null : Number(m[2]),
  };
}

/** The line that stands in for an embed the index could not land, so a broken one is never an empty paragraph. */
class MissingEmbed extends WidgetType {
  constructor(readonly words: string) {
    super();
  }

  eq(other: MissingEmbed) {
    return other.words === this.words;
  }

  toDOM() {
    const line = document.createElement("div");
    line.className = "cm-embed-missing";
    line.textContent = this.words;
    return line;
  }

  ignoreEvent() {
    return false;
  }
}

/** An image the page fetches with the bearer header and draws from an object URL, as the Experiment page does. */
class ImageEmbed extends WidgetType {
  constructor(
    readonly path: string,
    readonly text: string,
    readonly size: Size
  ) {
    super();
  }

  eq(other: ImageEmbed) {
    return (
      other.path === this.path &&
      other.text === this.text &&
      other.size.width === this.size.width &&
      other.size.height === this.size.height
    );
  }

  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-embed-image";
    const img = document.createElement("img");
    img.alt = this.text;
    if (this.size.width !== null) img.style.width = `${this.size.width}px`;
    if (this.size.height !== null) img.style.height = `${this.size.height}px`;
    wrap.append(img);
    const aborted = new AbortController();
    let url: string | null = null;
    cleanups.set(wrap, () => {
      aborted.abort();
      if (url !== null) URL.revokeObjectURL(url);
    });
    const { port, token } = window.vitrine;
    const address = this.path.split("/").map(encodeURIComponent).join("/");
    fetch(`http://127.0.0.1:${port}/vault-image/${address}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: aborted.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`the core answered ${res.status}`);
        const made = URL.createObjectURL(await res.blob());
        if (aborted.signal.aborted) URL.revokeObjectURL(made);
        else {
          url = made;
          img.src = made;
        }
      })
      // The bytes could not be had: the image stays its alt text, the embed's
      // own words, rather than the engine's broken-image icon.
      .catch(() => undefined);
    return wrap;
  }

  destroy(dom: HTMLElement) {
    cleanups.get(dom)?.();
  }

  // Clicks on the picture are the editor's: they put the cursor on the line.
  ignoreEvent() {
    return false;
  }
}

type Embed = { from: number; to: number } & (
  | { kind: "image"; path: string; text: string; size: Size }
  | { kind: "missing"; words: string }
);

/** The embeds that are a whole line and that the index has answered for. */
function embedsOf(state: EditorState): Embed[] {
  const answers = state.field(known);
  const out: Embed[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "Frontmatter" || node.name === "FencedCode") {
        return false;
      }
      if (node.name !== "Wikilink" && node.name !== "Image") return;
      const line = state.doc.lineAt(node.from);
      if (line.from !== node.from || line.to !== node.to) return;
      const text = state.sliceDoc(node.from, node.to);
      let key: string | null;
      let alt: string;
      let size = sizeOf(null);
      if (node.name === "Wikilink") {
        if (!text.startsWith("!")) return;
        key = wikilinkText(text);
        const { alias } = parseWikilink(key);
        size = sizeOf(alias);
        alt = text;
      } else {
        key = imageKey(node.node, state);
        alt = /^!\[([^\]]*)\]/.exec(text)?.[1] ?? "";
      }
      if (key === null) return;
      const answer = answers[key];
      if (answer === undefined) return;
      const name = parseWikilink(key).target;
      if (answer.resolution === "resolved" && answer.path !== null) {
        if (!IMAGE.test(answer.path)) return;
        out.push({
          from: node.from,
          to: node.to,
          kind: "image",
          path: answer.path,
          text: alt,
          size,
        });
      } else if (answer.resolution === "ambiguous") {
        out.push({
          from: node.from,
          to: node.to,
          kind: "missing",
          words: `Could not choose between the files named ${name}`,
        });
      } else if (answer.resolution === "unresolved") {
        out.push({
          from: node.from,
          to: node.to,
          kind: "missing",
          words: `Could not find ${name}`,
        });
      }
    },
  });
  return out;
}

const embeds = StateField.define<Embed[]>({
  create: embedsOf,
  update(value, tr) {
    const changed =
      tr.docChanged ||
      tr.startState.field(known) !== tr.state.field(known) ||
      // The parse of a long note finishes in the background.
      syntaxTree(tr.startState) !== syntaxTree(tr.state);
    return changed ? embedsOf(tr.state) : value;
  },
});

function drawn(state: EditorState, list: Embed[]): DecorationSet {
  // Every line a selection touches counts as the cursor's, as in `livePreview`.
  const spans = state.selection.ranges.map((r) => ({
    from: state.doc.lineAt(r.from).from,
    to: state.doc.lineAt(r.to).to,
  }));
  const out: Range<Decoration>[] = [];
  for (const e of list) {
    if (spans.some((s) => e.from <= s.to && e.to >= s.from)) continue;
    out.push(
      Decoration.replace({
        block: true,
        widget:
          e.kind === "image"
            ? new ImageEmbed(e.path, e.text, e.size)
            : new MissingEmbed(e.words),
      }).range(e.from, e.to)
    );
  }
  return Decoration.set(out);
}

const images = StateField.define<DecorationSet>({
  create: (state) => drawn(state, state.field(embeds)),
  update(value, tr) {
    return tr.docChanged ||
      tr.selection !== undefined ||
      tr.startState.field(embeds) !== tr.state.field(embeds)
      ? drawn(tr.state, tr.state.field(embeds))
      : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const vaultEmbeds = () => [embeds, images];
