import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, scrollsInto, vault } from "./fake-core";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// The Vault surface's left pane (spec #680, first slice): the Sidebar entry,
// the tree with Kind glyphs, collapse, the keyboard list that follows its
// choice (ADR 0030), *new note*, and the three voices of an empty slot
// (ADR 0032) with refusals as alerts and everything else polite (ADR 0033).

const READ = { indexing: null, watching: { ok: true }, current: { ok: true } };
const READING = {
  indexing: { done: 1, total: 9 },
  watching: { ok: true },
  current: { ok: true },
};

const TREE = [
  { path: "notes/Idea.md", kind: null },
  { path: "notes/deep/Thought.md", kind: null },
  { path: "plain.md", kind: null },
  { path: "q/What now.md", kind: "question" },
  { path: "q/Page.md", kind: "research-question" },
  { path: "sources/Paper.md", kind: "source", annotations: 3 },
  { path: "sources/Stub.md", kind: "source-stub" },
  { path: "sources/pdf/paper.pdf", kind: null },
];

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

const tree = () => screen.findByRole("tree", { name: "Files" });
/** Every visible row's accessible name, top to bottom. */
const names = () =>
  screen.getAllByRole("treeitem").map((i) => i.getAttribute("aria-label"));
const item = (name: string) => screen.getByRole("treeitem", { name });

describe("the Vault entry", () => {
  it("is a link to #/vault in the Sidebar, never hollow, and lit while the surface is open", async () => {
    open({ "vault.kinds": [] });
    await tree();
    const nav = screen.getByRole("navigation", { name: "Surfaces" });
    const link = Array.from(nav.querySelectorAll("a")).find(
      (a) => a.textContent === "Vault"
    );
    expect(link?.getAttribute("href")).toBe("#/vault");
    expect(link?.getAttribute("aria-current")).toBe("page");
    expect(link?.closest("li")?.textContent).toBe("Vault");
  });
});

describe("the files tree", () => {
  it("lists folders before files, every folder open, each file with its Kind and a Source its annotation count", async () => {
    open();
    await tree();
    expect(names()).toEqual([
      "notes",
      "deep",
      "Thought",
      "Idea",
      "q",
      "Page, research question",
      "What now, question",
      "sources",
      "pdf",
      "paper.pdf",
      "Paper, source, 3 annotations",
      "Stub, source stub",
      "plain",
    ]);
    // The glyph is the Inbox's family; a Note has none.
    expect(item("What now, question").textContent).toContain("◆");
    expect(item("Paper, source, 3 annotations").textContent).toContain("●");
    expect(item("Paper, source, 3 annotations").textContent).toContain("3");
    expect(item("Stub, source stub").textContent).toContain("○");
    expect(item("Idea").textContent).toBe("Idea");
  });

  it("collapses and reopens a folder from the pointer and from the keyboard", async () => {
    open();
    const list = await tree();
    fireEvent.click(item("notes"));
    expect(item("notes").getAttribute("aria-expanded")).toBe("false");
    expect(names()).not.toContain("Idea");
    expect(names()).not.toContain("Thought");
    fireEvent.click(item("notes"));
    expect(names()).toContain("Idea");

    // ← closes the folder the choice is on; → opens it.
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(item("notes").getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(item("notes").getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the choice on a published id, moves it with the arrows, and keeps it in view (ADR 0030)", async () => {
    const asked = scrollsInto();
    open();
    const list = await tree();
    const chosen = () =>
      document.getElementById(list.getAttribute("aria-activedescendant") ?? "");
    expect(chosen()?.getAttribute("aria-label")).toBe("notes");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(chosen()?.getAttribute("aria-label")).toBe("Thought");
    fireEvent.keyDown(list, { key: "End" });
    expect(chosen()?.getAttribute("aria-label")).toBe("plain");
    fireEvent.keyDown(list, { key: "Home" });
    expect(chosen()?.getAttribute("aria-label")).toBe("notes");
    expect(asked.at(-1)).toMatchObject({ block: "nearest" });
    expect(asked.at(-1)?.row.getAttribute("aria-label")).toBe("notes");
  });

  it("opens a file at its Address on ↵ and on a click, and lights the open one", async () => {
    open();
    const list = await tree();
    fireEvent.click(item("Idea"));
    expect(window.location.hash).toBe("#/vault/notes/Idea.md");
    expect(item("Idea").getAttribute("aria-current")).toBe("page");

    fireEvent.keyDown(list, { key: "End" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(window.location.hash).toBe("#/vault/plain.md");
  });

  it("arrives on an Address with the file lit and named", async () => {
    open(
      {
        "vault.read": { text: "", hash: "h", eol: "lf", bom: false, mtime: 0 },
      },
      "#/vault/q/What%20now.md"
    );
    await tree();
    expect(item("What now, question").getAttribute("aria-current")).toBe(
      "page"
    );
    expect(screen.getByText("q/What now.md")).toBeDefined();
  });
});

describe("new note", () => {
  const typeName = async (name: string) => {
    await tree();
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    const box = screen.getByRole("textbox", { name: "Note name" });
    fireEvent.change(box, { target: { value: name } });
    fireEvent.keyDown(box, { key: "Enter" });
  };

  it("asks the core for the note, opens it, and the tree re-reads", async () => {
    const create = vi.fn(() => ({ path: "notes/Fresh.md" }));
    open({ "vault.create": create });
    await typeName("Fresh");
    await waitFor(() =>
      expect(window.location.hash).toBe("#/vault/notes/Fresh.md")
    );
    expect(create).toHaveBeenCalledWith({ name: "Fresh" });
  });

  it("says a taken name in an alert and keeps what was typed", async () => {
    open({
      "vault.create": () => {
        throw new Error(
          "A note named Idea is already in notes; pick another name."
        );
      },
    });
    await typeName("Idea");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("already in notes");
    expect(screen.getByRole("textbox", { name: "Note name" })).toHaveProperty(
      "value",
      "Idea"
    );
    expect(window.location.hash).toBe("#/vault");
  });

  it("cancels on Escape without asking the core", async () => {
    const create = vi.fn();
    open({ "vault.create": create });
    await tree();
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Note name" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("textbox", { name: "Note name" })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("the three voices of an empty tree (ADR 0032)", () => {
  it("claims the vault has no notes yet, with a warrant and new note on offer, once the read is whole", async () => {
    open({ "vault.tree": [] });
    expect(await screen.findByText("No notes here yet.")).toBeDefined();
    expect(screen.getByText("read in full · watching")).toBeDefined();
    expect(screen.getByRole("button", { name: "New note" })).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says it is reading, and claims nothing, while the index is still being read", async () => {
    open({ "vault.tree": [], "vault.status": READING });
    expect(await screen.findByText("not read yet")).toBeDefined();
    expect(screen.queryByText("No notes here yet.")).toBeNull();
  });

  it("says not known, not empty, when the tree could not be read — and never as an alert", async () => {
    open({
      "vault.tree": () => {
        throw new Error("boom");
      },
    });
    expect(await screen.findByText("not known")).toBeDefined();
    expect(screen.queryByText("No notes here yet.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still draws the files it has while the read is incomplete", async () => {
    open({ "vault.status": READING });
    await tree();
    expect(names()).toContain("Idea");
  });
});

// The *search* tab (#697): full-text over note bodies, answered by the core
// from its index; the matching line with the term marked, a keyboard list
// that follows its choice (ADR 0030), ↵ opens.

const HITS = [
  {
    path: "notes/Idea.md",
    kind: null,
    line: "Probing finds the feature direction.",
    marks: [[0, 7]],
  },
  {
    path: "q/What now.md",
    kind: "question",
    line: "Does probing generalise?",
    marks: [[5, 12]],
  },
  {
    path: "sources/Paper.md",
    kind: "source",
    line: "linear probing baselines",
    marks: [[7, 14]],
  },
];

describe("the search tab", () => {
  const searchTab = () => screen.getByRole("tab", { name: "search" });
  const box = () => screen.getByRole("searchbox", { name: "Search the vault" });
  const options = () => screen.getAllByRole("option");
  const typeQuery = async (text: string) => {
    await tree();
    fireEvent.click(searchTab());
    fireEvent.change(box(), { target: { value: text } });
  };

  it("offers files and search as tabs, files first, and swaps the pane without losing the tree", async () => {
    open({ "vault.search": [] });
    await tree();
    expect(
      screen.getByRole("tab", { name: "files" }).getAttribute("aria-selected")
    ).toBe("true");
    expect(searchTab().getAttribute("aria-selected")).toBe("false");
    expect(screen.queryByRole("searchbox")).toBeNull();
    fireEvent.click(searchTab());
    expect(searchTab().getAttribute("aria-selected")).toBe("true");
    expect(box()).toBeDefined();
    expect(screen.queryByRole("tree", { name: "Files" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "files" }));
    expect(await tree()).toBeDefined();
    expect(names()).toContain("Idea");
  });

  it("asks the core nothing until a word is typed, then lists each hit with its Kind, its line and the term marked", async () => {
    const search = vi.fn(() => HITS);
    open({ "vault.search": search });
    await tree();
    fireEvent.click(searchTab());
    expect(search).not.toHaveBeenCalled();
    fireEvent.change(box(), { target: { value: "probing" } });
    await screen.findAllByRole("option");
    expect(search).toHaveBeenCalledWith({ query: "probing" });
    expect(options().map((o) => o.getAttribute("aria-label"))).toEqual([
      "Idea, notes/Idea.md",
      "What now, question, q/What now.md",
      "Paper, source, sources/Paper.md",
    ]);
    const marks = Array.from(options()[0]?.querySelectorAll("mark") ?? []);
    expect(marks.map((m) => m.textContent)).toEqual(["Probing"]);
    expect(options()[0]?.textContent).toContain(
      "Probing finds the feature direction."
    );
    expect(options()[1]?.textContent).toContain("◆");
  });

  it("moves the choice with the arrows, keeps it in view, and opens the chosen file on ↵", async () => {
    const asked = scrollsInto();
    open({ "vault.search": HITS });
    await typeQuery("probing");
    await screen.findAllByRole("option");
    const active = () =>
      document.getElementById(
        box().getAttribute("aria-activedescendant") ?? ""
      );
    expect(active()?.getAttribute("aria-label")).toBe("Idea, notes/Idea.md");
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    expect(active()?.getAttribute("aria-label")).toContain("Paper");
    expect(asked.at(-1)).toMatchObject({ block: "nearest" });
    expect(asked.at(-1)?.row.getAttribute("aria-label")).toContain("Paper");
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    expect(active()?.getAttribute("aria-label")).toContain("Paper");
    fireEvent.keyDown(box(), { key: "ArrowUp" });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(window.location.hash).toBe("#/vault/q/What%20now.md");
  });

  it("opens a hit on a click, and starts the choice again at the top for a new query", async () => {
    open({ "vault.search": HITS });
    await typeQuery("probing");
    await screen.findAllByRole("option");
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.change(box(), { target: { value: "probing b" } });
    await waitFor(() =>
      expect(
        document
          .getElementById(box().getAttribute("aria-activedescendant") ?? "")
          ?.getAttribute("aria-label")
      ).toBe("Idea, notes/Idea.md")
    );
    fireEvent.click(options()[2] as HTMLElement);
    expect(window.location.hash).toBe("#/vault/sources/Paper.md");
  });

  it("says nothing matched, politely, once the read is whole", async () => {
    open({ "vault.search": [] });
    await typeQuery("zebra");
    expect(await screen.findByText("Nothing matches zebra.")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("claims nothing while the index is still being read", async () => {
    open({ "vault.search": [], "vault.status": READING });
    await typeQuery("zebra");
    expect(await screen.findByText("not read yet")).toBeDefined();
    expect(screen.queryByText(/Nothing matches/)).toBeNull();
  });

  it("says not known, never empty, when the search could not be answered", async () => {
    open({
      "vault.search": () => {
        throw new Error("boom");
      },
    });
    await typeQuery("zebra");
    expect(await screen.findByText("not known")).toBeDefined();
    expect(screen.queryByText(/Nothing matches/)).toBeNull();
  });
});

// The Reader beat's two commands, exposed on the rows that own them (#702;
// spec #680 story 10): a stub's *attach a PDF*, a Source's *open in reader*.
// The surface builds neither — it calls what the Loose Ends row and the
// Source route already do.
describe("a row's Reader commands", () => {
  it("gives a Source row *open in reader*, which goes to the Source's own Address", async () => {
    open();
    await tree();
    fireEvent.click(
      within(item("Paper, source, 3 annotations")).getByRole("button", {
        name: "open in reader",
      })
    );
    expect(window.location.hash).toBe("#/source/sources/Paper.md");
  });

  it("gives a stub row *attach a PDF* and neither command to a note, a question or a folder", async () => {
    open();
    await tree();
    const withButtons = screen
      .getAllByRole("treeitem")
      .filter((row) => within(row).queryAllByRole("button").length > 0)
      .map((row) => row.getAttribute("aria-label"));
    expect(withButtons).toEqual([
      "Paper, source, 3 annotations",
      "Stub, source stub",
    ]);
    expect(
      within(item("Stub, source stub")).getByRole("button", {
        name: "attach a PDF",
      })
    ).toBeDefined();
  });

  it("attaches a chosen PDF to the stub through the Loose Ends write, and says so", async () => {
    const attach = vi.fn<(input: unknown) => object>(() => ({}));
    open({
      "sources.unnamedPdfs": ["sources/pdf/waiting.pdf"],
      "sources.attachToStub": attach,
    });
    await tree();
    fireEvent.click(
      within(item("Stub, source stub")).getByRole("button", {
        name: "attach a PDF",
      })
    );
    fireEvent.click(await screen.findByRole("button", { name: "waiting.pdf" }));
    await waitFor(() =>
      expect(attach).toHaveBeenCalledWith({
        pdf: "sources/pdf/waiting.pdf",
        stub: "sources/Stub.md",
      })
    );
    expect(await screen.findByText(/Attached waiting\.pdf/)).toBeDefined();
  });

  it("says when no PDF waits, and says a refusal as an alert, leaving the choice open", async () => {
    open({ "sources.unnamedPdfs": [] });
    await tree();
    fireEvent.click(
      within(item("Stub, source stub")).getByRole("button", {
        name: "attach a PDF",
      })
    );
    expect(
      await screen.findByText("No PDF in the folder is waiting for a Source.")
    ).toBeDefined();
    cleanup();
    open({
      "sources.unnamedPdfs": ["sources/pdf/waiting.pdf"],
      "sources.attachToStub": () => {
        throw new Error("sources/Other.md already names that PDF.");
      },
    });
    await tree();
    fireEvent.click(
      within(item("Stub, source stub")).getByRole("button", {
        name: "attach a PDF",
      })
    );
    fireEvent.click(await screen.findByRole("button", { name: "waiting.pdf" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "already names that PDF"
    );
    expect(screen.getByRole("button", { name: "waiting.pdf" })).toBeDefined();
  });
});
