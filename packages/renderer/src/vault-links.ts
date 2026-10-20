import { syntaxTree } from "@codemirror/language";
import {
  StateEffect,
  StateField,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { LinkResolution } from "core";
import { classifyLink } from "./link-rule";

/**
 * What the editor does about a link, tag or `href` in the text (#701; spec
 * #680 stories 15, 41, 42). The editor draws and reports a click; what a
 * click *means* — a route, a refusal, a list of candidates — is the surface's,
 * which owns the router and the one refusal module.
 */
export type LinkHooks = {
  /** Where each `[[…]]` text lands; the editor draws from the answer. */
  resolve: (links: string[]) => Promise<Record<string, LinkResolution>>;
  /** A wikilink was activated; `link` is the text between the brackets. */
  onWikilink: (link: string) => void;
  /** A tag was activated, as written, `#` included. */
  onTag: (tag: string) => void;
  /** A Markdown link or bare URL was activated. */
  onHref: (href: string) => void;
};

/** Forget every answer: a different file resolves the same text differently. */
export const forgetResolutions = StateEffect.define<null>();
const learn = StateEffect.define<Record<string, LinkResolution>>();

const known = StateField.define<Record<string, LinkResolution>>({
  create: () => ({}),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(forgetResolutions)) value = {};
      else if (effect.is(learn)) value = { ...value, ...effect.value };
    }
    return value;
  },
});

const wikilinkText = (raw: string) => raw.replace(/^!?\[\[/, "").slice(0, -2);

/**
 * The marks that make a link followable: a data attribute the click handler
 * reads, and the resolution drawn into the class so an unresolved link never
 * looks like one that goes somewhere. Built from the syntax tree, whose
 * Wikilink and Tag nodes are the grammar the index counts
 * (`vault-grammar.parity.test.ts`).
 */
function marksOf(view: EditorView): DecorationSet {
  const answers = view.state.field(known);
  const marks: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        const text = () => view.state.doc.sliceString(node.from, node.to);
        if (node.name === "Wikilink") {
          const link = wikilinkText(text());
          const state = answers[link]?.resolution ?? "pending";
          marks.push(
            Decoration.mark({
              class: `cm-follow cm-follow-${state}`,
              attributes: {
                "data-follow": "wikilink",
                "data-link": link,
                "data-resolution": state,
              },
            }).range(node.from, node.to)
          );
        } else if (node.name === "Tag") {
          marks.push(
            Decoration.mark({
              class: "cm-follow cm-follow-tag",
              attributes: { "data-follow": "tag", "data-tag": text() },
            }).range(node.from, node.to)
          );
        } else if (node.name === "Link" || node.name === "URL") {
          // A `[text](url)`'s URL is a child of its Link; a bare URL has no
          // parent Link. Either way the *href* is what the classifier sees.
          const parent = node.node.parent;
          if (node.name === "URL" && parent?.name === "Link") return;
          if (parent?.name === "Image") return;
          const urlNode =
            node.name === "URL" ? node.node : node.node.getChild("URL");
          if (urlNode === null) return;
          const url = view.state.doc.sliceString(urlNode.from, urlNode.to);
          const refused = classifyLink(url).kind === "refused";
          marks.push(
            Decoration.mark({
              class: refused ? "cm-follow cm-not-link" : "cm-follow",
              attributes: {
                "data-href": url,
                ...(refused ? { "data-not-link": "true" } : {}),
              },
            }).range(node.from, node.to)
          );
        }
      },
    });
  }
  return Decoration.set(marks, true);
}

/** Every wikilink text in the document the editor has not yet been told about. */
function unknownLinks(view: EditorView): string[] {
  const answers = view.state.field(known);
  const wanted = new Set<string>();
  syntaxTree(view.state).iterate({
    enter(node) {
      if (node.name !== "Wikilink") return;
      const link = wikilinkText(view.state.doc.sliceString(node.from, node.to));
      if (answers[link] === undefined) wanted.add(link);
    },
  });
  return [...wanted];
}

export function vaultLinks(hooks: () => LinkHooks): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      timer: ReturnType<typeof setTimeout> | undefined;
      constructor(private view: EditorView) {
        this.decorations = marksOf(view);
        this.ask();
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.startState.field(known) !== update.state.field(known)
        ) {
          this.decorations = marksOf(update.view);
        }
        if (update.docChanged || update.transactions.some(forgets)) this.ask();
      }
      /** After a pause, so typing does not ask per keystroke; a failed ask leaves links drawn as pending. */
      ask() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          const links = unknownLinks(this.view);
          if (links.length === 0) return;
          hooks()
            .resolve(links)
            .then(
              (answers) => this.view.dispatch({ effects: learn.of(answers) }),
              () => undefined
            );
        }, 0);
      }
      destroy() {
        clearTimeout(this.timer);
      }
    },
    { decorations: (value) => value.decorations }
  );
  return [
    known,
    plugin,
    EditorView.domEventHandlers({
      click(event) {
        const target = event.target;
        if (!(target instanceof Element)) return false;
        const hit = target.closest<HTMLElement>("[data-follow], [data-href]");
        if (hit === null) return false;
        const { follow, link, tag, href } = hit.dataset;
        if (follow === "wikilink" && link !== undefined) {
          hooks().onWikilink(link);
        } else if (follow === "tag" && tag !== undefined) {
          hooks().onTag(tag);
        } else if (href !== undefined) {
          hooks().onHref(href);
        } else return false;
        event.preventDefault();
        return true;
      },
    }),
  ];
}

const forgets = (tr: { effects: readonly StateEffect<unknown>[] }) =>
  tr.effects.some((e) => e.is(forgetResolutions));
