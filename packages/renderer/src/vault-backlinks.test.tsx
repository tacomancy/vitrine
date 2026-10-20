import { cleanup, fireEvent, screen } from "@testing-library/react";
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
});
