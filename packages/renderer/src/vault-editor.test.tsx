import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";
import { addressOf } from "./kinds";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// Opening a file in the Vault editor (#690; spec #680): the file's text in a
// CodeMirror editor, read-only until the save ticket, with the Address that
// names it and the Inbox's account of one that names nothing.

const READ = { indexing: null, watching: { ok: true }, current: { ok: true } };
const TREE = [
  { path: "notes/Idea.md", kind: null },
  { path: "plain.md", kind: null },
];
// Noon UTC, so the date is the same day in every timezone a CI runner has.
const MTIME = Date.UTC(2026, 7, 5, 12);
const FILE = (text: string) => ({
  text,
  hash: "h",
  eol: "lf",
  bom: false,
  mtime: MTIME,
});

const open = (more: Record<string, unknown> = {}, hash = "#/vault") => {
  window.location.hash = hash;
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": READ,
    "vault.tree": TREE,
    "vault.pdfFault": null,
    ...more,
  });
};

const editor = () => screen.findByRole("textbox", { name: "Editor" });
/** The document as CodeMirror draws it: one element per line, so the text is the lines joined. */
const textOf = (box: HTMLElement) =>
  Array.from(box.querySelectorAll(".cm-line"))
    .map((line) => line.textContent)
    .join("\n");

describe("opening a file", () => {
  it("shows the file's text in the editor and its path, edited date and word count in the header", async () => {
    const read = vi.fn(() => FILE("# Idea\n\nthree small words\n"));
    open({ "vault.read": read }, "#/vault/notes/Idea.md");
    expect(textOf(await editor())).toBe("# Idea\n\nthree small words\n");
    expect(read).toHaveBeenCalledWith({ path: "notes/Idea.md" });
    const header = screen.getByRole("heading", { name: "notes/Idea.md" });
    expect(header.parentElement?.textContent).toContain("5 Aug");
    expect(header.parentElement?.textContent).toContain("5 words");
  });

  it("shows a CRLF file's text as the editor holds it, with no stray carriage returns", async () => {
    open(
      { "vault.read": { ...FILE("one\ntwo\n"), eol: "crlf" } },
      "#/vault/plain.md"
    );
    expect(textOf(await editor())).toBe("one\ntwo\n");
    expect(document.querySelectorAll(".cm-line")).toHaveLength(3);
    expect((await editor()).textContent).not.toContain("\r");
  });

  it("is read-only and never asks the core to write", async () => {
    const replace = vi.fn();
    const create = vi.fn();
    open(
      {
        "vault.read": FILE("text\n"),
        "vault.replaceFile": replace,
        "vault.create": create,
      },
      "#/vault/plain.md"
    );
    const box = await editor();
    fireEvent.input(box, { data: "x" });
    fireEvent.keyDown(box, { key: "a" });
    fireEvent.blur(box);
    expect(textOf(box)).toBe("text\n");
    expect(box.getAttribute("contenteditable")).toBe("false");
    expect(replace).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("opens an Address with spaces and non-ASCII in it", async () => {
    const read = vi.fn(() => FILE("x\n"));
    open({ "vault.read": read }, "#/vault/notes/caf%C3%A9%20au%20lait.md");
    await editor();
    expect(read).toHaveBeenCalledWith({ path: "notes/café au lait.md" });
  });

  it("opens from a tree row, the Address following the choice", async () => {
    open({
      "vault.read": (input: { path: string }) =>
        FILE(input.path === "plain.md" ? "plain text\n" : "idea text\n"),
    });
    fireEvent.click(await screen.findByRole("treeitem", { name: "Idea" }));
    expect(textOf(await editor())).toBe("idea text\n");
    expect(window.location.hash).toBe("#/vault/notes/Idea.md");
    const view = document.querySelector(".cm-editor");
    expect(view).not.toBeNull();
    fireEvent.click(screen.getByRole("treeitem", { name: "plain" }));
    await waitFor(async () =>
      expect(textOf(await editor())).toBe("plain text\n")
    );
    expect(window.location.hash).toBe("#/vault/plain.md");
    // The one view carries the change: choosing a file never rebuilds it.
    expect(document.querySelector(".cm-editor")).toBe(view);
    // Back returns to the file before: the router is the only reader.
    window.history.back();
    await waitFor(async () =>
      expect(textOf(await editor())).toBe("idea text\n")
    );
  });
});

describe("a link that names a plain Note", () => {
  it("lands in the Vault at that file; every other Kind keeps its surface", () => {
    expect(addressOf(null, "notes/Idea.md")).toBe("#/vault/notes/Idea.md");
    expect(addressOf("note", "a b.md")).toBe("#/vault/a%20b.md");
    expect(addressOf("question", "q.md")).toBe("#/question/q.md");
    expect(addressOf("source", "s.md")).toBe("#/source/s.md");
    // No surface and no plain Note either: still named, not linked.
    expect(addressOf("source-stub", "s.md")).toBeNull();
    expect(addressOf("something-else", "x.md")).toBeNull();
  });
});

describe("an Address that names nothing", () => {
  it("lands on the Inbox naming the Address and why", async () => {
    open(
      {
        "vault.read": () => {
          throw new Error("Couldn't read gone.md: no such file");
        },
      },
      "#/vault/gone.md"
    );
    const line = await screen.findByText(/#\/vault\/gone\.md/);
    expect(line.textContent).toContain("no such file");
    expect(line.getAttribute("role")).toBe("status");
    await waitFor(() => expect(window.location.hash).toBe("#/inbox"));
  });
});

describe("what the editor colours", () => {
  it("draws a tag and a wikilink as links, and does not colour what the index does not count", async () => {
    open(
      {
        "vault.read": FILE(
          "---\ntags: [a]\n# not a heading\n---\nSee [[Idea]] and #ml/probing, not a#b or `#code`.\n"
        ),
      },
      "#/vault/plain.md"
    );
    const box = await editor();
    await waitFor(() =>
      expect(box.querySelectorAll("span[class]").length).toBeGreaterThan(0)
    );
    const coloured = (text: string) =>
      Array.from(box.querySelectorAll("span")).filter(
        (span) => span.textContent === text && span.className !== ""
      );
    expect(coloured("[[Idea]]")).toHaveLength(1);
    expect(coloured("#ml/probing")).toHaveLength(1);
    // `a#b` is not a tag; a `#code` in a code span is code, not a tag.
    for (const text of ["#b", "#code"]) {
      for (const span of coloured(text))
        expect(span.className).not.toMatch(/tag/);
    }
    // The frontmatter is source: its `# not a heading` is not a heading.
    expect(box.querySelectorAll("[class*='h1']")).toHaveLength(0);
    expect(
      Array.from(box.querySelectorAll("span")).some((span) =>
        /frontmatter/.test(span.className)
      )
    ).toBe(true);
    expect(coloured("[[Idea]]")[0]!.className).toMatch(/wikilink/);
    expect(coloured("#ml/probing")[0]!.className).toMatch(/tag/);
  });
});
