import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";
import { addressOf } from "./kinds";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// Opening a file in the Vault editor (#690; spec #680): the file's text in a
// CodeMirror editor, saved by the next, with the Address that
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
    // A fresh note rests in preview: the heading's mark is not drawn (#776).
    expect(textOf(await editor())).toBe("Idea\n\nthree small words\n");
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
    // Off the cursor's line the brackets are hidden (live preview, #700); the
    // cursor on the line is what leaves `[[Idea]]` whole to colour.
    const view = EditorView.findFromDOM(
      box.closest(".cm-editor") as HTMLElement
    )!;
    view.dispatch({ selection: { anchor: view.state.doc.length - 2 } });
    await waitFor(() =>
      expect(box.querySelectorAll("span[class]").length).toBeGreaterThan(0)
    );
    const coloured = (text: string) =>
      Array.from(box.querySelectorAll("span")).filter(
        // The follow mark (#701) wraps the same text; this counts the colour.
        (span) =>
          span.textContent === text &&
          span.className !== "" &&
          !span.hasAttribute("data-follow")
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

// Typing saves (#693; spec #680): on a pause, on ⌘S, on blur, and before
// another file replaces the document, each `basedOn` the hash last read or
// written. A Revision the core wrote in the same save is taken in, so the
// next save cannot write the file back without it.

const VIEW = () => {
  const dom = document.querySelector(".cm-editor") as HTMLElement;
  return EditorView.findFromDOM(dom)!;
};
/** What the user does: a change that is not the file arriving. */
const type = (text: string) => {
  const view = VIEW();
  act(() =>
    view.dispatch({ changes: { from: view.state.doc.length, insert: text } })
  );
};
const SAVED = (hash: string, content: string) => ({
  written: true,
  hash,
  content,
  shape: [],
});

describe("typing saves", () => {
  it("Enter inserts a line break at the cursor, so a blank line can be typed (#777)", async () => {
    open({ "vault.read": FILE("one\ntwo") }, "#/vault/plain.md");
    const box = await editor();
    const view = EditorView.findFromDOM(
      box.closest(".cm-editor") as HTMLElement
    )!;
    view.dispatch({ selection: { anchor: 3 } });
    fireEvent.keyDown(box, { key: "Enter", code: "Enter", keyCode: 13 });
    fireEvent.keyDown(box, { key: "Enter", code: "Enter", keyCode: 13 });
    expect(view.state.doc.toString()).toBe("one\n\n\ntwo");
  });

  it("saves a pause after the last keystroke, basedOn the hash it read, and not before", async () => {
    const replace = vi.fn(() => SAVED("h2", "one two\n"));
    open(
      { "vault.read": FILE("one\n"), "vault.replaceFile": replace },
      "#/vault/plain.md"
    );
    await editor();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    type(" two");
    await act(() => vi.advanceTimersByTimeAsync(1900));
    expect(replace).not.toHaveBeenCalled();
    type(" a");
    await act(() => vi.advanceTimersByTimeAsync(1900));
    expect(replace).not.toHaveBeenCalled();
    type(" more");
    await act(() => vi.advanceTimersByTimeAsync(2100));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith({
      path: "plain.md",
      content: "one\n two a more",
      basedOn: "h",
    });
  });

  it("⌘S saves at once, and the next save is basedOn the hash the last one wrote", async () => {
    const replace = vi
      .fn()
      .mockReturnValueOnce(SAVED("h2", "a\nb\n"))
      .mockReturnValueOnce(SAVED("h3", "a\nb\nc\n"));
    open(
      { "vault.read": FILE("a\n"), "vault.replaceFile": replace },
      "#/vault/plain.md"
    );
    const box = await editor();
    type("b\n");
    fireEvent.keyDown(box, { key: "s", ctrlKey: true });
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace.mock.calls[0]?.[0]).toMatchObject({
      content: "a\nb\n",
      basedOn: "h",
    });
    type("c\n");
    fireEvent.keyDown(box, { key: "s", ctrlKey: true });
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(2));
    expect(replace).toHaveBeenLastCalledWith(
      expect.objectContaining({ basedOn: "h2" })
    );
  });

  it("a file that has not been typed in is never saved, however long it is open or whatever blurs", async () => {
    const replace = vi.fn();
    open(
      { "vault.read": FILE("a\n"), "vault.replaceFile": replace },
      "#/vault/plain.md"
    );
    const box = await editor();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.keyDown(box, { key: "s", ctrlKey: true });
    fireEvent.blur(box);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(replace).not.toHaveBeenCalled();
  });

  it("a saved file is clean: a blur or ⌘S after it saves nothing more until it is typed in again", async () => {
    const replace = vi.fn(() => SAVED("h2", "a\nb\n"));
    open(
      { "vault.read": FILE("a\n"), "vault.replaceFile": replace },
      "#/vault/plain.md"
    );
    const box = await editor();
    type("b\n");
    fireEvent.keyDown(box, { key: "s", ctrlKey: true });
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    await act(async () => {});
    fireEvent.blur(box);
    fireEvent.keyDown(box, { key: "s", ctrlKey: true });
    await act(async () => {});
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("saves on blur", async () => {
    const replace = vi.fn(() => SAVED("h2", "a\nb\n"));
    open(
      { "vault.read": FILE("a\n"), "vault.replaceFile": replace },
      "#/vault/plain.md"
    );
    const box = await editor();
    type("b\n");
    fireEvent.blur(box);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  });

  it("takes in the Revision the core wrote beside the typing, keeping what was typed meanwhile", async () => {
    let finish: (value: unknown) => void = () => {};
    const replace = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    open(
      {
        "vault.read": FILE("answer\n\nhistory\n"),
        "vault.replaceFile": replace,
      },
      "#/vault/plain.md"
    );
    const box = await editor();
    const view = VIEW();
    act(() => view.dispatch({ changes: { from: 6, insert: "!" } }));
    fireEvent.keyDown(box, { key: "s", ctrlKey: true });
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    // Typed while the save was out, before the history it will gain.
    act(() => view.dispatch({ changes: { from: 0, insert: ">" } }));
    finish(SAVED("h2", "answer!\n\nhistory\n- 2026 · answer\n"));
    await waitFor(() =>
      expect(textOf(box)).toBe(">answer!\n\nhistory\n- 2026 · answer\n")
    );
    expect(textOf(box)).toBe(">answer!\n\nhistory\n- 2026 · answer\n");
  });

  it("saves the typing of the file being left before the next replaces the document", async () => {
    const replace = vi.fn(() => SAVED("h2", "idea!\n"));
    open(
      {
        "vault.read": (input: { path: string }) =>
          FILE(input.path === "plain.md" ? "plain\n" : "idea\n"),
        "vault.replaceFile": replace,
      },
      "#/vault/notes/Idea.md"
    );
    await editor();
    type("!");
    fireEvent.click(await screen.findByRole("treeitem", { name: "plain" }));
    await waitFor(async () => expect(textOf(await editor())).toBe("plain\n"));
    expect(replace).toHaveBeenCalledWith({
      path: "notes/Idea.md",
      content: "idea\n!",
      basedOn: "h",
    });
  });

  it("saves when the window is closing, and only typing that has not been saved", async () => {
    const replace = vi.fn(() => SAVED("h2", "a\nb\n"));
    open(
      { "vault.read": FILE("a\n"), "vault.replaceFile": replace },
      "#/vault/plain.md"
    );
    await editor();
    act(() => void window.dispatchEvent(new Event("pagehide")));
    await act(async () => {});
    expect(replace).not.toHaveBeenCalled();

    type("b\n");
    act(() => void window.dispatchEvent(new Event("pagehide")));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith({
      path: "plain.md",
      content: "a\nb\n",
      basedOn: "h",
    });
  });

  it("a write that failed is an alert naming the file and the reason, with no path from the machine", async () => {
    const replace = vi.fn(() => {
      throw new Error("Couldn't write plain.md: no space left on device");
    });
    open(
      { "vault.read": FILE("a\n"), "vault.replaceFile": replace },
      "#/vault/plain.md"
    );
    const box = await editor();
    type("b\n");
    fireEvent.blur(box);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "Couldn't write plain.md: no space left on device"
    );
    expect(textOf(box)).toBe("a\nb\n");
  });

  it("a refused save is said in an alert and the typing stays", async () => {
    const replace = vi.fn(() => ({
      written: false,
      reason: "outsideVault",
      detail: "plain.md is outside the vault",
    }));
    open(
      { "vault.read": FILE("a\n"), "vault.replaceFile": replace },
      "#/vault/plain.md"
    );
    const box = await editor();
    type("b\n");
    fireEvent.blur(box);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("plain.md is outside the vault");
    expect(textOf(box)).toBe("a\nb\n");
  });

  it("says a Revision that could not be recorded, the typing saved all the same", async () => {
    const replace = vi.fn(() => ({
      ...SAVED("h2", "a\nb\n"),
      unrecorded: "the history would not parse",
    }));
    open(
      { "vault.read": FILE("a\n"), "vault.replaceFile": replace },
      "#/vault/plain.md"
    );
    const box = await editor();
    type("b\n");
    fireEvent.blur(box);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("history was not recorded");
    expect(textOf(box)).toBe("a\nb\n");
  });
});

// Changed on disk (#699; spec #680 stories 34–37): a file that moved under
// unsaved typing is one non-modal line with two actions, not a modal and not
// an overwrite; a clean editor takes the new text in without a word.

const changed = (
  more: Partial<Record<"changed" | "removed", string[]>> & {
    renamed?: { from: string; to: string }[];
  }
) => ({
  type: "vaultChanged" as const,
  changed: [],
  removed: [],
  renamed: [],
  ...more,
});

/** A disk the test moves under the open editor: `vault.read` answers with it. */
const disk = (text: string, hash = "h") => {
  const now = { text, hash };
  return {
    now,
    read: vi.fn(() => ({ ...FILE(now.text), hash: now.hash })),
    move: (to: string, at: string) => {
      now.text = to;
      now.hash = at;
    },
  };
};

const said = async (words: RegExp) =>
  (await screen.findByText(words)).closest("[role=status]")!;
const line = () => said(/changed on disk/);

describe("changed on disk", () => {
  it("a vaultChanged naming the open path under unsaved typing shows the line, and autosave stops while typing goes on", async () => {
    const d = disk("one\n");
    const replace = vi.fn(() => SAVED("h3", "one\nmine\n"));
    const { stream } = open(
      { "vault.read": d.read, "vault.replaceFile": replace },
      "#/vault/plain.md"
    );
    const box = await editor();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    type("mine\n");
    d.move("one\nelsewhere\n", "h2");
    act(() => stream.push(changed({ changed: ["plain.md"] })));
    expect((await line()).textContent).toContain("just now");
    await act(() => vi.advanceTimersByTimeAsync(5000));
    type("more\n");
    fireEvent.blur(box);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(replace).not.toHaveBeenCalled();
    expect(textOf(box)).toBe("one\nmine\nmore\n");
    // Non-modal: a status, not a dialog or an alert.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect((await line()).textContent).toContain("2 min ago");
  });

  it("keep mine saves the typing basedOn the disk's hash", async () => {
    const d = disk("one\n");
    const replace = vi.fn(() => SAVED("h3", "one\nmine\n"));
    const { stream } = open(
      { "vault.read": d.read, "vault.replaceFile": replace },
      "#/vault/plain.md"
    );
    await editor();
    type("mine\n");
    d.move("one\nelsewhere\n", "h2");
    act(() => stream.push(changed({ changed: ["plain.md"] })));
    await line();
    fireEvent.click(screen.getByRole("button", { name: "keep mine" }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith({
      path: "plain.md",
      content: "one\nmine\n",
      basedOn: "h2",
    });
    await waitFor(() =>
      expect(screen.queryByText(/changed on disk/)).toBeNull()
    );
  });

  it("take the disk copy replaces the document, clears the line and saves nothing", async () => {
    const d = disk("one\n");
    const replace = vi.fn();
    const { stream } = open(
      { "vault.read": d.read, "vault.replaceFile": replace },
      "#/vault/plain.md"
    );
    const box = await editor();
    type("mine\n");
    d.move("one\nelsewhere\n", "h2");
    act(() => stream.push(changed({ changed: ["plain.md"] })));
    await line();
    fireEvent.click(screen.getByRole("button", { name: "take the disk copy" }));
    await waitFor(() => expect(textOf(box)).toBe("one\nelsewhere\n"));
    expect(screen.queryByText(/changed on disk/)).toBeNull();
    fireEvent.blur(box);
    await act(async () => {});
    expect(replace).not.toHaveBeenCalled();
    // Clean again: the next typing saves, basedOn what was taken.
    replace.mockReturnValue(SAVED("h3", "one\nelsewhere\nx"));
    type("x");
    fireEvent.blur(box);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace.mock.calls[0]?.[0]).toMatchObject({ basedOn: "h2" });
  });

  it("a hash-mismatch refusal shows the same line, not an alert, and the typing stays", async () => {
    const d = disk("one\n");
    const replace = vi.fn<() => unknown>(() => ({
      written: false,
      reason: "changedOnDisk",
      detail: "plain.md changed since it was read",
    }));
    open(
      { "vault.read": d.read, "vault.replaceFile": replace },
      "#/vault/plain.md"
    );
    const box = await editor();
    type("mine\n");
    d.move("one\nelsewhere\n", "h2");
    fireEvent.blur(box);
    await line();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(textOf(box)).toBe("one\nmine\n");
    replace.mockReturnValue(SAVED("h3", "one\nmine\n"));
    fireEvent.click(screen.getByRole("button", { name: "keep mine" }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(2));
    expect(replace).toHaveBeenLastCalledWith(
      expect.objectContaining({ basedOn: "h2" })
    );
  });

  it("the echo of the editor's own save is not a change on disk", async () => {
    const d = disk("one\n");
    const replace = vi.fn(() => {
      d.move("one\nmine\n", "h2");
      return SAVED("h2", "one\nmine\n");
    });
    const { stream } = open(
      { "vault.read": d.read, "vault.replaceFile": replace },
      "#/vault/plain.md"
    );
    await editor();
    type("mine\n");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Editor" }), {
      key: "s",
      ctrlKey: true,
    });
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    type("more\n");
    act(() => stream.push(changed({ changed: ["plain.md"] })));
    await act(async () => {});
    await act(async () => {});
    expect(screen.queryByText(/changed on disk/)).toBeNull();
  });

  it("a clean editor reloads silently, the cursor kept where the text allows", async () => {
    const d = disk("hello world\n");
    const { stream } = open({ "vault.read": d.read }, "#/vault/plain.md");
    const box = await editor();
    const view = VIEW();
    act(() => view.dispatch({ selection: { anchor: 9 } }));
    d.move("hello brave world\n", "h2");
    act(() => stream.push(changed({ changed: ["plain.md"] })));
    await waitFor(() => expect(textOf(box)).toBe("hello brave world\n"));
    expect(view.state.selection.main.head).toBe(15);
    expect(screen.queryByText(/changed on disk/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("another file's change is none of this editor's business", async () => {
    const d = disk("one\n");
    const { stream } = open({ "vault.read": d.read }, "#/vault/plain.md");
    await editor();
    type("mine\n");
    act(() => stream.push(changed({ changed: ["notes/Idea.md"] })));
    await act(async () => {});
    expect(screen.queryByText(/changed on disk/)).toBeNull();
  });

  it("a removed open file is said in the same line, the typing kept and the window not moved", async () => {
    const d = disk("one\n");
    const replace = vi.fn();
    const { stream } = open(
      { "vault.read": d.read, "vault.replaceFile": replace },
      "#/vault/plain.md"
    );
    const box = await editor();
    type("mine\n");
    act(() => stream.push(changed({ removed: ["plain.md"] })));
    expect((await said(/removed on disk/)).textContent).toContain("just now");
    expect(window.location.hash).toBe("#/vault/plain.md");
    expect(textOf(box)).toBe("one\nmine\n");
    fireEvent.blur(box);
    await act(async () => {});
    expect(replace).not.toHaveBeenCalled();
  });

  it("a renamed open file says where it went, even when the editor is clean", async () => {
    const d = disk("one\n");
    const { stream } = open({ "vault.read": d.read }, "#/vault/plain.md");
    await editor();
    act(() =>
      stream.push(
        changed({ renamed: [{ from: "plain.md", to: "notes/Idea.md" }] })
      )
    );
    expect((await said(/renamed on disk/)).textContent).toContain(
      "notes/Idea.md"
    );
    expect(window.location.hash).toBe("#/vault/plain.md");
  });

  it("a save of the file being left that finds it changed is said as a refusal, not lost", async () => {
    const d = disk("one\n");
    const replace = vi.fn<() => unknown>(() => ({
      written: false,
      reason: "changedOnDisk",
      detail: "plain.md changed since it was read",
    }));
    open(
      { "vault.read": d.read, "vault.replaceFile": replace },
      "#/vault/plain.md"
    );
    await editor();
    type("mine\n");
    fireEvent.click(await screen.findByRole("treeitem", { name: "Idea" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "plain.md changed since it was read"
    );
    // Said as a refusal of the left file, not as a change to the new one.
    expect(screen.queryByText(/changed on disk/)).toBeNull();
  });

  it("a removed file that comes back as it was retracts the line, and saving resumes", async () => {
    const d = disk("one\n");
    const replace = vi.fn(() => SAVED("h2", "one\nmine\n"));
    const { stream } = open(
      { "vault.read": d.read, "vault.replaceFile": replace },
      "#/vault/plain.md"
    );
    const box = await editor();
    type("mine\n");
    act(() => stream.push(changed({ removed: ["plain.md"] })));
    await said(/removed on disk/);
    act(() => stream.push(changed({ changed: ["plain.md"] })));
    await waitFor(() =>
      expect(screen.queryByText(/removed on disk/)).toBeNull()
    );
    fireEvent.blur(box);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  });

  it("says so when an action cannot read the disk, rather than doing nothing", async () => {
    const d = disk("one\n");
    const { stream } = open({ "vault.read": d.read }, "#/vault/plain.md");
    await editor();
    type("mine\n");
    d.move("two\n", "h2");
    act(() => stream.push(changed({ changed: ["plain.md"] })));
    await line();
    d.read.mockImplementation(() => {
      throw new Error("gone");
    });
    fireEvent.click(screen.getByRole("button", { name: "keep mine" }));
    expect((await line()).textContent).toContain("could not read the file");
  });

  it("the line belongs to its file: opening another clears it", async () => {
    const d = disk("one\n");
    const { stream } = open({ "vault.read": d.read }, "#/vault/plain.md");
    await editor();
    type("mine\n");
    d.move("two\n", "h2");
    act(() => stream.push(changed({ changed: ["plain.md"] })));
    await line();
    fireEvent.click(await screen.findByRole("treeitem", { name: "Idea" }));
    await waitFor(() =>
      expect(screen.queryByText(/changed on disk/)).toBeNull()
    );
  });
});
