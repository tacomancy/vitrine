import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// Dropping an image file on a note (#754; spec #751 stories 1–4, 10, 13–16,
// 19): the file is copied first, and only then is `![[name]]` written into
// the note, at the drop position, as one undoable transaction. A drop that
// cannot be copied says so and writes nothing.

const READ = { indexing: null, watching: { ok: true }, current: { ok: true } };
const FILE = (text: string) => ({
  text,
  hash: "h",
  eol: "lf",
  bom: false,
  mtime: Date.UTC(2026, 7, 5, 12),
});

const DOC = "intro\n\nthe middle of it\n\ntail";

const open = async (
  attach: (input: { source: string }) => unknown,
  text = DOC
) => {
  window.location.hash = "#/vault/plain.md";
  window.vitrine = {
    port: 4242,
    token: "t",
    pathOf: (file: File) => `/Users/r/Downloads/${file.name}`,
  };
  const resolved = {
    resolution: "resolved",
    path: "assets/shot.png",
    kind: null,
    candidates: [],
  };
  renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": READ,
    "vault.tree": [{ path: "plain.md", kind: null }],
    "vault.pdfFault": null,
    "vault.read": () => FILE(text),
    "vault.replaceFile": { written: true, hash: "h2", content: text },
    "vault.resolveLinks": { "shot.png": resolved },
    "vault.attachImage": attach,
  });
  const box = await screen.findByRole("textbox", { name: "Editor" });
  const view = EditorView.findFromDOM(
    box.closest(".cm-editor") as HTMLElement
  )!;
  return { box, view };
};

const doc = (view: EditorView) => view.state.doc.toString();
const file = (name: string, type = "image/png") =>
  new File([new Uint8Array([137, 80, 78, 71])], name, { type });

/** A drop of `files` whose pointer is over `pos` (jsdom has no layout to map coordinates). */
function dropOn(view: EditorView, files: File[], pos: number | null) {
  vi.spyOn(view, "posAtCoords").mockReturnValue(pos);
  fireEvent.drop(view.contentDOM, {
    dataTransfer: { files, types: ["Files"] },
    clientX: 5,
    clientY: 5,
  });
}

const EMPTY_LINE = DOC.indexOf("\n\n") + 1; // the blank line after "intro"

describe("dropping an image on the note", () => {
  it("copies the file in and writes its embed at the drop position, from the name the copy was given", async () => {
    const attach = vi.fn(() => ({
      file: "shot (2).png",
      path: "assets/shot (2).png",
    }));
    const { view } = await open(attach);

    dropOn(view, [file("shot.png")], EMPTY_LINE);

    await waitFor(() => expect(doc(view)).toContain("![[shot (2).png]]"));
    expect(attach).toHaveBeenCalledWith({
      source: "/Users/r/Downloads/shot.png",
    });
    expect(doc(view)).toBe(
      "intro\n![[shot (2).png]]\nthe middle of it\n\ntail"
    );
  });

  it("puts the embed on a line of its own when dropped mid-paragraph, so it can be drawn", async () => {
    const { view } = await open(() => ({
      file: "shot.png",
      path: "assets/shot.png",
    }));
    const at = DOC.indexOf("middle");

    dropOn(view, [file("shot.png")], at);

    await waitFor(() => expect(doc(view)).toContain("![[shot.png]]"));
    expect(doc(view)).toBe(
      "intro\n\nthe \n![[shot.png]]\nmiddle of it\n\ntail"
    );
  });

  it("draws the image once the cursor is off its line", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(new Blob([new Uint8Array([1])])))
      )
    );
    URL.createObjectURL = vi.fn(() => "blob:vitrine/1");
    URL.revokeObjectURL = vi.fn();
    const { box, view } = await open(() => ({
      file: "shot.png",
      path: "assets/shot.png",
    }));

    dropOn(view, [file("shot.png")], DOC.indexOf("middle"));
    await waitFor(() => expect(doc(view)).toContain("![[shot.png]]"));
    view.dispatch({ selection: EditorSelection.cursor(0) });

    await waitFor(() => expect(box.querySelectorAll("img")).toHaveLength(1));
  });

  it("writes each of several files, in the order dropped", async () => {
    const stored = ["a.png", "b.png", "c.png"];
    const attach = vi.fn(({ source }: { source: string }) => {
      const name = source.split("/").pop()!;
      return { file: name, path: `assets/${name}` };
    });
    const { view } = await open(attach);

    dropOn(
      view,
      stored.map((n) => file(n)),
      EMPTY_LINE
    );

    await waitFor(() => expect(doc(view)).toContain("![[c.png]]"));
    expect(doc(view)).toBe(
      "intro\n![[a.png]]\n![[b.png]]\n![[c.png]]\nthe middle of it\n\ntail"
    );
  });

  it("is undone, text and all, by the editor's undo — and only that drop", async () => {
    const { view } = await open(() => ({
      file: "shot.png",
      path: "assets/shot.png",
    }));
    view.dispatch({ changes: { from: 0, insert: "typed " } });
    dropOn(view, [file("shot.png")], EMPTY_LINE + "typed ".length);
    await waitFor(() => expect(doc(view)).toContain("![[shot.png]]"));

    fireEvent.keyDown(view.contentDOM, { key: "z", ctrlKey: true });

    expect(doc(view)).toBe("typed " + DOC);
  });

  it("writes nothing and says why when the copy is refused", async () => {
    const { view } = await open(() => {
      throw new Error(
        "notes.txt is not an image a note can draw: PNG, JPEG, GIF, WebP or SVG."
      );
    });

    dropOn(view, [file("notes.txt", "text/plain")], EMPTY_LINE);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "notes.txt is not an image a note can draw: PNG, JPEG, GIF, WebP or SVG."
    );
    expect(doc(view)).toBe(DOC);
  });

  it("still writes the files that copied when one of a batch is refused", async () => {
    const { view } = await open(({ source }) => {
      if (source.endsWith(".txt")) throw new Error("notes.txt is not an image");
      return { file: "ok.png", path: "assets/ok.png" };
    });

    dropOn(view, [file("notes.txt", "text/plain"), file("ok.png")], EMPTY_LINE);

    await waitFor(() => expect(doc(view)).toContain("![[ok.png]]"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "notes.txt"
    );
    expect(doc(view).match(/!\[\[/g)).toHaveLength(1);
  });

  it("keeps the embed at the place dropped when the note is typed in while the copy is out", async () => {
    let finish!: (v: { file: string; path: string }) => void;
    const slow = new Promise<{ file: string; path: string }>(
      (r) => (finish = r)
    );
    const { view } = await open(() => slow);

    dropOn(view, [file("shot.png")], EMPTY_LINE);
    view.dispatch({ changes: { from: 0, insert: "XX" } });
    await act(async () =>
      finish({ file: "shot.png", path: "assets/shot.png" })
    );

    await waitFor(() => expect(doc(view)).toContain("![[shot.png]]"));
    expect(doc(view)).toBe("XXintro\n![[shot.png]]\nthe middle of it\n\ntail");
  });

  it("falls back to the cursor when the pointer is over no text", async () => {
    const { view } = await open(() => ({
      file: "shot.png",
      path: "assets/shot.png",
    }));
    view.dispatch({ selection: EditorSelection.cursor(EMPTY_LINE) });

    dropOn(view, [file("shot.png")], null);

    await waitFor(() => expect(doc(view)).toContain("![[shot.png]]"));
  });

  it("leaves a drop of something that is not a file — selected text, a link — to the editor", async () => {
    const attach = vi.fn();
    const { view } = await open(attach);

    vi.spyOn(view, "posAtCoords").mockReturnValue(EMPTY_LINE);
    fireEvent.drop(view.contentDOM, {
      dataTransfer: { files: [], types: ["text/plain"], getData: () => "hi" },
    });

    expect(attach).not.toHaveBeenCalled();
  });
});
