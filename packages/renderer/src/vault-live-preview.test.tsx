import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// Inline-only live preview (#700; spec #680, stories 16–18, 21): the marks
// that make prose are hidden off the cursor's line and shown on it, and the
// shapes the first slice does not render stay as the text they are.

const READ = { indexing: null, watching: { ok: true }, current: { ok: true } };
const FILE = (text: string) => ({
  text,
  hash: "h",
  eol: "lf",
  bom: false,
  mtime: Date.UTC(2026, 7, 5, 12),
});

const open = async (text: string) => {
  window.location.hash = "#/vault/plain.md";
  renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": READ,
    "vault.tree": [{ path: "plain.md", kind: null }],
    "vault.pdfFault": null,
    "vault.read": () => FILE(text),
  });
  const box = await screen.findByRole("textbox", { name: "Editor" });
  const view = EditorView.findFromDOM(
    box.closest(".cm-editor") as HTMLElement
  )!;
  return { box, view };
};

/** What each line shows, hidden marks gone. */
const lines = (box: HTMLElement) =>
  Array.from(box.querySelectorAll(".cm-line")).map((l) => l.textContent);

const cursorAt = (view: EditorView, pos: number) =>
  view.dispatch({ selection: EditorSelection.cursor(pos) });

describe("hiding marks off the cursor's line", () => {
  const DOC = [
    "# Title",
    "a **bold** and _soft_ and `code`",
    "see [[Target]] and [[Target|alias]]",
    "tail ^blk",
  ].join("\n");

  it("hides every mark off the cursor's line", async () => {
    const { box, view } = await open(DOC);
    cursorAt(view, DOC.length); // on the last line
    expect(lines(box)).toEqual([
      "Title",
      "a bold and soft and code",
      "see Target and alias",
      "tail ^blk",
    ]);
  });

  it("shows the marks on the line the cursor is on, and hides them again when it leaves", async () => {
    const { box, view } = await open(DOC);
    cursorAt(view, DOC.indexOf("bold"));
    expect(lines(box)[1]).toBe("a **bold** and _soft_ and `code`");
    expect(lines(box)[0]).toBe("Title");
    cursorAt(view, 2);
    expect(lines(box)[0]).toBe("# Title");
    expect(lines(box)[1]).toBe("a bold and soft and code");
  });

  it("shows the wikilink's brackets and alias pipe on its line", async () => {
    const { box, view } = await open(DOC);
    cursorAt(view, DOC.indexOf("Target"));
    expect(lines(box)[2]).toBe("see [[Target]] and [[Target|alias]]");
  });

  it("hides a block id off its line", async () => {
    const { box, view } = await open("para ^blk\n\nnext");
    cursorAt(view, 14);
    expect(lines(box)[0]).toBe("para");
  });

  it("treats every line of a multi-line selection as the cursor's", async () => {
    const { box, view } = await open("**a**\n**b**\n**c**");
    view.dispatch({ selection: EditorSelection.range(0, 8) });
    expect(lines(box)).toEqual(["**a**", "**b**", "c"]);
  });
});

describe("what stays as text", () => {
  it("leaves frontmatter, a table, an embed and a callout exactly as written", async () => {
    const doc = [
      "---",
      "title: **x**",
      "---",
      "",
      "| a | b |",
      "| - | - |",
      "| **x** | [[T]] |",
      "",
      "![[Embedded]]",
      "",
      "> [!note] Title",
      "> **x** and [[T]]",
      "",
      "end",
    ].join("\n");
    const { box, view } = await open(doc);
    cursorAt(view, doc.length);
    expect(lines(box)).toEqual(doc.split("\n"));
  });
});

describe("a hidden mark cannot be half-deleted", () => {
  it("moves the cursor over a hidden `[[` as one step", async () => {
    const doc = "x\n[[T]] y";
    const { view } = await open(doc);
    cursorAt(view, 0);
    // Off the wikilink's line the brackets are hidden: the position between
    // the two `[` is not one the cursor can stop at.
    const moved = view.moveByChar(EditorSelection.cursor(2), true);
    expect(moved.head).not.toBe(3);
    const atoms = view.state.facet(EditorView.atomicRanges);
    const ranges = atoms
      .map((f) => f(view))
      .flatMap((set) => {
        const out: [number, number][] = [];
        for (const c = set.iter(); c.value; c.next()) out.push([c.from, c.to]);
        return out;
      });
    expect(ranges).toContainEqual([2, 4]);
  });
});

describe("a 1 MB note", () => {
  it("opens and moves its cursor without decorating the whole note", async () => {
    const para =
      "A **bold** claim with [[Link|alias]] and `code`, then more.\n";
    const doc = para.repeat(Math.ceil(1_000_000 / para.length));
    const started = performance.now();
    const { box, view } = await open(doc);
    cursorAt(view, doc.length - 5);
    cursorAt(view, 10);
    const elapsed = performance.now() - started;
    expect(doc.length).toBeGreaterThanOrEqual(1_000_000);
    expect(elapsed).toBeLessThan(5000);
    // Only the viewport is drawn, so only it is parsed for marks.
    expect(box.querySelectorAll(".cm-line").length).toBeLessThan(2000);
    expect(lines(box)[0]).toBe(para.trimEnd()); // the cursor's line, shown
    expect(lines(box)[1]).toBe("A bold claim with alias and code, then more.");
  });
});
