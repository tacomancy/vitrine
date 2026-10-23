import { syntaxTree } from "@codemirror/language";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import styles from "./VaultEditor.module.css";

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

/** A glyph standing in for a list or task mark: bullets and boxes are prose. */
class Glyph extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: Glyph) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = styles.glyph ?? "";
    span.textContent = this.text;
    return span;
  }
}

const bullet = Decoration.replace({ widget: new Glyph("•") });
const box = (done: boolean) =>
  Decoration.replace({ widget: new Glyph(done ? "☑" : "☐") });

const lineClass = (name: string) =>
  Decoration.line({ class: styles[name] ?? "" });
/** The first line of a list item: its depth as padding, its mark as the hang. */
const listLine = (indent: number, hang: number) =>
  Decoration.line({
    class: styles.listLine ?? "",
    attributes: {
      style: `padding-left:${indent + hang}em;text-indent:-${hang}em`,
    },
  });
const listLineSource = lineClass("listLine");
const quoteLine = lineClass("quoteLine");
const fenceLine = lineClass("fenceLine");

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
  // A line decoration sits at the line's start, where a mark may also begin.
  const addLine = (deco: Decoration, at: number) => {
    if (seen.has(-at - 1)) return;
    seen.add(-at - 1);
    out.push(deco.range(at));
  };
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
        case "Table":
        case "Frontmatter":
        // An image is drawn (or named) by the embed layer, not by its marks.
        case "Image":
          return false;
        // A fenced block is code, not inline: its fences stay and its lines
        // are set in the code face.
        case "FencedCode": {
          const last = state.doc.lineAt(node.to).number;
          for (let n = state.doc.lineAt(node.from).number; n <= last; n++) {
            addLine(fenceLine, state.doc.line(n).from);
          }
          return false;
        }
        case "ListMark": {
          // The line is styled whether or not the cursor is on it; only the
          // mark itself turns to source under the cursor.
          const line = state.doc.lineAt(node.from);
          const text = state.sliceDoc(node.from, node.to);
          if (onCursorLine(node.from, node.to)) {
            addLine(listLineSource, line.from);
            return;
          }
          // Depth is the leading whitespace (a tab is four columns), drawn as
          // padding so a wrapped line hangs under its text, not the margin.
          const lead = state.sliceDoc(line.from, node.from);
          const cols = [...lead].reduce((n, c) => n + (c === "\t" ? 4 : 1), 0);
          const bulleted = /^[-*+]$/.test(text);
          const task = /^\[[ xX]\]/.test(
            state.sliceDoc(node.to + 1, node.to + 5)
          );
          const hang =
            (bulleted ? 1.1 : 0.6 * (text.length - 1) + 1.5) + (task ? 1.4 : 0);
          addLine(listLine(cols * 0.5, hang), line.from);
          add(line.from, node.from);
          // An ordered item's number is already how it reads.
          if (bulleted) {
            seen.add(node.from);
            out.push(bullet.range(node.from, node.to));
          }
          return;
        }
        case "TaskMarker":
          if (!onCursorLine(node.from, node.to)) {
            const done = /\[[xX]\]/.test(state.sliceDoc(node.from, node.to));
            seen.add(node.from);
            out.push(box(done).range(node.from, node.to));
          }
          return;
        case "QuoteMark": {
          addLine(quoteLine, state.doc.lineAt(node.from).from);
          if (onCursorLine(node.from, node.to)) return;
          const space = state.sliceDoc(node.to, node.to + 1) === " " ? 1 : 0;
          add(node.from, node.to + space);
          return;
        }
        case "StrikethroughMark":
          if (!onCursorLine(node.from, node.to)) add(node.from, node.to);
          return;
        case "Link": {
          // `[text](url)` is its text; a reference link has no URL here and
          // keeps its brackets, since its label is not prose.
          const parts: { from: number; to: number }[] = [];
          let hasUrl = false;
          for (let c = node.node.firstChild; c; c = c.nextSibling) {
            if (c.name === "URL") hasUrl = true;
            if (["LinkMark", "URL", "LinkTitle"].includes(c.name))
              parts.push(c);
          }
          if (!hasUrl) return;
          for (const part of parts) {
            if (!onCursorLine(part.from, part.to)) add(part.from, part.to);
          }
          return;
        }
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

/**
 * A note just opened has no cursor the user put there: the one at the top is
 * where the document happened to start, and showing its line's marks makes a
 * fresh note look like source (#776). Until the user moves the cursor or
 * types, no line counts as the cursor's.
 */
export const restPreview = StateEffect.define<null>();
const resting = StateField.define<boolean>({
  create: () => true,
  update(value, tr) {
    if (tr.effects.some((e) => e.is(restPreview))) return true;
    // Disk-pushed text maps the selection; only the user sets one.
    return value && tr.selection === undefined;
  },
});

function build(view: EditorView): DecorationSet {
  const { state } = view;
  // Every line a selection touches counts as the cursor's: a multi-line
  // selection is being edited across, so its marks are shown.
  const spans = state.field(resting)
    ? []
    : state.selection.ranges.map((r) => ({
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
        update.startState.field(resting) !== update.state.field(resting) ||
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

export const livePreview = () => [resting, plugin];
