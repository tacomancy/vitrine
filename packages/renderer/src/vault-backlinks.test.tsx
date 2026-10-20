import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, scrollsInto, vault } from "./fake-core";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// The Vault's right pane (#695; spec #680): what links to the open file, each
// row with its Kind glyph, the line it was written on and a Kind · field ·
// date line; a keyboard list that follows its choice (ADR 0030).

const READ = { indexing: null, watching: { ok: true }, current: { ok: true } };
// Noon UTC, so the date is the same day in every timezone a CI runner has.
const WHEN = Date.UTC(2026, 7, 5, 12);
const ROWS = [
  {
    path: "q/What now.md",
    kind: "research-question",
    field: "Working answer",
    date: WHEN,
    snippet: "Leans on [[Idea]] for the why.",
    block: null,
  },
  {
    path: "notes/Other.md",
    kind: null,
    field: null,
    date: WHEN,
    snippet: "also [[Idea]]",
    block: null,
  },
];

const open = (more: Record<string, unknown> = {}) => {
  window.location.hash = "#/vault/notes/Idea.md";
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": READ,
    "vault.kinds": [],
    "vault.tree": [{ path: "notes/Idea.md", kind: null }],
    "vault.read": { text: "", hash: "h", eol: "lf", bom: false, mtime: WHEN },
    "vault.backlinks": ROWS,
    "vault.unlinkedMentions": [],
    "vault.pdfFault": null,
    ...more,
  });
};

const list = () => screen.findByRole("listbox", { name: "Backlinks" });

describe("the backlinks pane", () => {
  it("asks for the open file's backlinks and draws each with its glyph, snippet and Kind · field · date", async () => {
    const asked = vi.fn(() => ROWS);
    open({ "vault.backlinks": asked });
    await list();
    expect(asked).toHaveBeenCalledWith({ path: "notes/Idea.md" });
    const [first, second] = screen.getAllByRole("option");
    expect(first?.textContent).toContain("■");
    expect(first?.textContent).toContain("Leans on [[Idea]] for the why.");
    expect(first?.textContent).toContain(
      "research question · Working answer · 5 Aug"
    );
    // A note with no heading above its link has no field to name.
    expect(second?.textContent).toContain("note · 5 Aug");
  });

  it("opens the linking file on a click and on ↵", async () => {
    open();
    const box = await list();
    fireEvent.click(screen.getAllByRole("option")[1]!);
    expect(window.location.hash).toBe("#/vault/notes/Other.md");
    // The pane is the new file's own, so it is a new element.
    const next = await list();
    expect(next).not.toBe(box);
    fireEvent.keyDown(next, { key: "ArrowDown" });
    fireEvent.keyDown(next, { key: "Home" });
    fireEvent.keyDown(next, { key: "Enter" });
    expect(window.location.hash).toBe("#/vault/q/What%20now.md");
  });

  it("keeps the choice on a published id and in view (ADR 0030)", async () => {
    const asked = scrollsInto();
    open();
    const box = await list();
    expect(box.getAttribute("aria-activedescendant")).toBe(
      screen.getAllByRole("option")[0]?.id
    );
    fireEvent.keyDown(box, { key: "ArrowDown" });
    const chosen = document.getElementById(
      box.getAttribute("aria-activedescendant") ?? ""
    );
    expect(chosen?.getAttribute("aria-selected")).toBe("true");
    expect(asked.at(-1)?.row).toBe(chosen);
  });

  it("claims nothing links here only once the read is whole", async () => {
    open({ "vault.backlinks": [] });
    expect(await screen.findByText("Nothing links here yet.")).toBeDefined();
    cleanup();
    open({
      "vault.backlinks": [],
      "vault.status": {
        indexing: { done: 1, total: 9 },
        watching: { ok: true },
        current: { ok: true },
      },
    });
    expect(await screen.findByText("not read yet")).toBeDefined();
    expect(screen.queryByText("Nothing links here yet.")).toBeNull();
  });

  it("says not known when the backlinks could not be read", async () => {
    open({
      "vault.backlinks": () => {
        throw new Error("boom");
      },
    });
    expect(await screen.findByText("not known")).toBeDefined();
    expect(screen.queryByText("Nothing links here yet.")).toBeNull();
  });

  describe("unlinked mentions", () => {
    const MENTIONS = [
      {
        path: "notes/Talk.md",
        kind: null,
        line: "We discussed idea at length.",
        marks: [[13, 17]],
      },
      {
        path: "q/Why.md",
        kind: "question",
        line: "Is the idea sound?",
        marks: [[11, 15]],
      },
    ];
    const mentions = () =>
      screen.findByRole("listbox", { name: "Unlinked mentions" });

    it("asks for the open file's mentions and draws each with its glyph, line and the name marked", async () => {
      const asked = vi.fn(() => MENTIONS);
      open({ "vault.unlinkedMentions": asked });
      const box = await mentions();
      expect(asked).toHaveBeenCalledWith({ path: "notes/Idea.md" });
      const [first] = Array.from(box.querySelectorAll('[role="option"]'));
      expect(first?.textContent).toContain("We discussed idea at length.");
      expect(first?.querySelector("mark")?.textContent).toBe("idea");
      // Linked backlinks stay their own list.
      expect(screen.getByRole("listbox", { name: "Backlinks" })).toBeDefined();
    });

    it("opens the mentioning file on a click and on ↵, moving with the arrows", async () => {
      open({ "vault.unlinkedMentions": MENTIONS });
      const box = await mentions();
      const rows = box.querySelectorAll('[role="option"]');
      fireEvent.click(rows[1]!);
      expect(window.location.hash).toBe("#/vault/q/Why.md");
      const next = await mentions();
      fireEvent.keyDown(next, { key: "ArrowDown" });
      fireEvent.keyDown(next, { key: "Enter" });
      expect(window.location.hash).toBe("#/vault/q/Why.md");
      fireEvent.keyDown(next, { key: "Home" });
      fireEvent.keyDown(next, { key: "Enter" });
      expect(window.location.hash).toBe("#/vault/notes/Talk.md");
    });

    it("keeps the choice on a published id and in view (ADR 0030)", async () => {
      const asked = scrollsInto();
      open({ "vault.unlinkedMentions": MENTIONS });
      const box = await mentions();
      fireEvent.keyDown(box, { key: "ArrowDown" });
      const chosen = document.getElementById(
        box.getAttribute("aria-activedescendant") ?? ""
      );
      expect(chosen?.getAttribute("aria-selected")).toBe("true");
      expect(chosen?.textContent).toContain("Is the idea sound?");
      expect(asked.at(-1)?.row).toBe(chosen);
    });

    it("says not known when the mentions could not be read", async () => {
      open({
        "vault.unlinkedMentions": () => {
          throw new Error("boom");
        },
      });
      expect(await screen.findByText("not known")).toBeDefined();
    });

    it("draws nothing when no file mentions the name", async () => {
      open();
      await list();
      expect(
        screen.queryByRole("listbox", { name: "Unlinked mentions" })
      ).toBeNull();
    });
  });
});

// On a Source the rows group by the highlight they target (#702): the
// annotation-level backlinks Prompt 7 asks for, file-level links beneath.
describe("a Source's backlinks", () => {
  const link = (path: string, block: string | null) => ({
    path,
    kind: null,
    field: null,
    date: WHEN,
    snippet: `from ${path}`,
    block,
  });
  const GROUPED = [
    link("notes/A.md", null),
    link("notes/B.md", "h10"),
    link("notes/C.md", "h2"),
    link("notes/D.md", "h2"),
  ];

  it("groups by ^h<n> in highlight order, each group's files under it, file-level links last", async () => {
    open({ "vault.backlinks": GROUPED });
    await list();
    const groups = screen.getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "^h2",
      "^h10",
      "file-level",
    ]);
    expect(
      groups.map((g) =>
        within(g)
          .getAllByRole("option")
          .map((o) => o.textContent)
          .join("|")
      )
    ).toEqual([
      expect.stringMatching(/from notes\/C\.md.*from notes\/D\.md/),
      expect.stringContaining("from notes/B.md"),
      expect.stringContaining("from notes/A.md"),
    ]);
  });

  it("keeps one keyboard list across the groups, in the order they are drawn", async () => {
    open({ "vault.backlinks": GROUPED });
    const box = await list();
    fireEvent.keyDown(box, { key: "End" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(window.location.hash).toBe("#/vault/notes/A.md");
    const next = await list();
    fireEvent.keyDown(next, { key: "ArrowDown" });
    fireEvent.keyDown(next, { key: "Enter" });
    expect(window.location.hash).toBe("#/vault/notes/D.md");
  });

  it("gives every row its own id and marks only the chosen one, across the groups", async () => {
    open({ "vault.backlinks": GROUPED });
    const box = await list();
    const options = screen.getAllByRole("option");
    expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "true",
      "false",
    ]);
    expect(box.getAttribute("aria-activedescendant")).toBe(options[2]?.id);
  });

  it("stays flat when no link targets a highlight", async () => {
    open();
    await list();
    expect(screen.queryAllByRole("group")).toEqual([]);
  });

  it("names only the file-level group when that is all there is, as flat", async () => {
    open({ "vault.backlinks": [link("notes/A.md", null)] });
    await list();
    expect(screen.queryAllByRole("group")).toEqual([]);
  });
});
