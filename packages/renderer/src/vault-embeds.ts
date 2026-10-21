import { syntaxTree } from "@codemirror/language";
import { StateField, type EditorState, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { known } from "./vault-links";

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

/** An image the page fetches with the bearer header and draws from an object URL, as the Experiment page does. */
class ImageEmbed extends WidgetType {
  private abort: AbortController | null = null;
  private url: string | null = null;

  constructor(
    readonly path: string,
    readonly text: string
  ) {
    super();
  }

  eq(other: ImageEmbed) {
    return other.path === this.path && other.text === this.text;
  }

  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-embed-image";
    const img = document.createElement("img");
    img.alt = this.text;
    wrap.append(img);
    const aborted = new AbortController();
    this.abort = aborted;
    const { port, token } = window.vitrine;
    const address = this.path.split("/").map(encodeURIComponent).join("/");
    fetch(`http://127.0.0.1:${port}/vault-image/${address}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: aborted.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`the core answered ${res.status}`);
        const url = URL.createObjectURL(await res.blob());
        if (aborted.signal.aborted) URL.revokeObjectURL(url);
        else {
          this.url = url;
          img.src = url;
        }
      })
      .catch(() => undefined);
    return wrap;
  }

  destroy() {
    this.abort?.abort();
    if (this.url !== null) URL.revokeObjectURL(this.url);
  }

  // Clicks on the picture are the editor's: they put the cursor on the line.
  ignoreEvent() {
    return false;
  }
}

type Embed = { from: number; to: number; path: string; text: string };

/** The embeds that are a whole line and resolved to an image. */
function embedsOf(state: EditorState): Embed[] {
  const answers = state.field(known);
  const out: Embed[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "Frontmatter" || node.name === "FencedCode") {
        return false;
      }
      if (node.name !== "Wikilink") return;
      const line = state.doc.lineAt(node.from);
      if (line.from !== node.from || line.to !== node.to) return;
      const text = state.sliceDoc(node.from, node.to);
      if (!text.startsWith("!")) return;
      const answer = answers[wikilinkText(text)];
      if (answer?.resolution !== "resolved" || answer.path === null) return;
      if (!IMAGE.test(answer.path)) return;
      out.push({ from: node.from, to: node.to, path: answer.path, text });
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
        widget: new ImageEmbed(e.path, e.text),
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
