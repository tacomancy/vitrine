import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

// Inline-only live preview (docs/architecture.md § Vault surface, *Editor*;
// spec #680, stories 16–18). The marks that make prose — `**`, `_`, backticks,
// `[[ ]]`, an alias pipe, a heading's `#`, a `^blockid` — are replaced by
// nothing off the cursor's line and left as text on it. The decorations are
// computed on the editor's LF text from the syntax tree the grammar already
// builds, so they cannot disagree with what is coloured or counted.
//
// Frontmatter, tables, embeds and callouts are skipped whole: the first
// slice renders none of them, and a mark inside them is source, not prose.

const hide = Decoration.replace({});

/** A callout is a blockquote whose first line opens `[!type]`. */
const CALLOUT = /^>[ \t]*\[!/;

/** The alias pipe: the first one a backslash has not escaped. */
const ALIAS_PIPE = /(?<!\\)\|/;

function inlineMarks(
  state: EditorState,
  from: number,
  to: number,
  onCursorLine: (from: number, to: number) => boolean,
  seen: Set<number>,
  out: Range<Decoration>[]
) {
  const add = (start: number, end: number) => {
    // Visible ranges are disjoint, but a mark may straddle two of them.
    if (end <= start || seen.has(start)) return;
    seen.add(start);
    out.push(hide.range(start, end));
  };
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      switch (node.name) {
        // Skipped whole, so nothing inside them is ever mistaken for prose.
        // A fenced block is code, not inline: its fences stay.
        case "Table":
        case "Frontmatter":
        case "FencedCode":
          return false;
        case "Blockquote":
          if (CALLOUT.test(state.doc.lineAt(node.from).text.trimStart())) {
            return false;
          }
          return;
        case "EmphasisMark":
        case "CodeMark":
          if (!onCursorLine(node.from, node.to)) add(node.from, node.to);
          return;
        case "HeaderMark": {
          // ATX only: a setext underline is a whole line of marks, not a prefix.
          if (node.node.parent?.name.startsWith("ATX") !== true) return;
          if (onCursorLine(node.from, node.to)) return;
          const space = state.sliceDoc(node.to, node.to + 1) === " " ? 1 : 0;
          add(node.from, node.to + space);
          return;
        }
        case "BlockId":
          if (onCursorLine(node.from, node.to)) return;
          // The space before it goes too, or the line would end in a gap.
          add(
            state.sliceDoc(node.from - 1, node.from) === " "
              ? node.from - 1
              : node.from,
            node.to
          );
          return;
        case "Wikilink": {
          const text = state.sliceDoc(node.from, node.to);
          if (text.startsWith("!")) return; // an embed stays as text
          if (onCursorLine(node.from, node.to)) return;
          const pipe = text.search(ALIAS_PIPE);
          // With an alias only the alias is the link's face, so the target
          // and the pipe go with the brackets.
          add(node.from, node.from + (pipe < 0 ? 2 : pipe + 1));
          add(node.to - 2, node.to);
          return;
        }
      }
    },
  });
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  // Every line a selection touches counts as the cursor's: a multi-line
  // selection is being edited across, so its marks are shown.
  const spans = state.selection.ranges.map((r) => ({
    from: state.doc.lineAt(r.from).from,
    to: state.doc.lineAt(r.to).to,
  }));
  const onCursorLine = (from: number, to: number) =>
    spans.some((s) => from <= s.to && to >= s.from);
  const out: Range<Decoration>[] = [];
  const seen = new Set<number>();
  // Only what is drawn is walked, which is what keeps a 1 MB note responsive.
  for (const { from, to } of view.visibleRanges) {
    inlineMarks(state, from, to, onCursorLine, seen, out);
  }
  return Decoration.set(out, true);
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        // The parse of a long note finishes in the background.
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = build(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (p) =>
      // A hidden mark is one cursor stop, so `[[` cannot be half-deleted.
      EditorView.atomicRanges.of(
        (view) => view.plugin(p)?.decorations ?? Decoration.none
      ),
  }
);

export const livePreview = () => plugin;
