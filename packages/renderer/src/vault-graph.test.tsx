import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, scrollsInto, vault } from "./fake-core";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => window.history.replaceState(null, "", "/"));

// The Vault's Graph tab (#741; spec #740, ADR 0047): the open file's first
// Ring, drawn from positions the core computed, with the same nodes in one
// keyboard list.

const READ = { indexing: null, watching: { ok: true }, current: { ok: true } };
const node = (path: string, kind: string | null, x: number, y: number) => ({
  path,
  kind,
  hop: path === "notes/Idea.md" ? 0 : 1,
  x,
  y,
});
const GRAPH = {
  nodes: [
    node("notes/Idea.md", null, 0, 0),
    node("notes/Other.md", null, 0, -1),
    node("q/What now.md", "question", 1, 0),
    node("src/Paper.md", "source", -1, 0),
  ],
  edges: [
    { a: "notes/Idea.md", b: "notes/Other.md", count: 1 },
    { a: "notes/Idea.md", b: "q/What now.md", count: 3 },
    { a: "notes/Idea.md", b: "src/Paper.md", count: 1 },
  ],
};

const open = (more: Record<string, unknown> = {}) => {
  window.location.hash = "#/vault/notes/Idea.md";
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": READ,
    "vault.kinds": [],
    "vault.tree": [{ path: "notes/Idea.md", kind: null }],
    "vault.read": { text: "", hash: "h", eol: "lf", bom: false, mtime: 0 },
    "vault.backlinks": [],
    "vault.unlinkedMentions": [],
    "vault.pdfFault": null,
    "vault.graph": GRAPH,
    ...more,
  });
};

const graphTab = () => screen.findByRole("tab", { name: "graph" });
const list = () => screen.findByRole("listbox", { name: "Graph" });

describe("the Graph tab", () => {
  it("sits beside backlinks, which stays the tab it opens on", async () => {
    open();
    const backlinks = await screen.findByRole("tab", { name: "backlinks" });
    expect(backlinks.getAttribute("aria-selected")).toBe("true");
    expect((await graphTab()).getAttribute("aria-selected")).toBe("false");
    expect(screen.queryByRole("listbox", { name: "Graph" })).toBeNull();
  });

  it("asks for the open file's first Ring and lists its neighbours in layout order, with name and Kind", async () => {
    const asked = vi.fn(() => GRAPH);
    open({ "vault.graph": asked });
    fireEvent.click(await graphTab());
    const box = await list();
    expect(asked).toHaveBeenCalledWith({ path: "notes/Idea.md", hops: 1 });
    const rows = screen.getAllByRole("option").map((o) => o.textContent);
    expect(rows).toEqual([
      expect.stringContaining("Other"),
      expect.stringContaining("What now"),
      expect.stringContaining("Paper"),
    ]);
    expect(rows[1]).toContain("question");
    expect(rows[2]).toContain("source");
    expect(box.getAttribute("aria-activedescendant")).toBe(
      screen.getAllByRole("option")[0]?.id
    );
  });

  it("draws each node where the core put it, and a count on a line that collapses links", async () => {
    open();
    fireEvent.click(await graphTab());
    await list();
    const dots = [...document.querySelectorAll("svg [data-node]")];
    expect(
      dots.map((d) => [
        d.getAttribute("data-node"),
        d.getAttribute("data-x"),
        d.getAttribute("data-y"),
      ])
    ).toEqual([
      ["notes/Idea.md", "0", "0"],
      ["notes/Other.md", "0", "-1"],
      ["q/What now.md", "1", "0"],
      ["src/Paper.md", "-1", "0"],
    ]);
    expect(document.querySelectorAll("svg line")).toHaveLength(3);
    expect(screen.getByText("3")).toBeDefined();
  });

  it("opens a node's file on a click on the dot, on a click on its row and on ↵", async () => {
    open();
    fireEvent.click(await graphTab());
    const box = await list();
    fireEvent.click(document.querySelector('svg [data-node="src/Paper.md"]')!);
    expect(window.location.hash).toBe("#/vault/src/Paper.md");
    // The tab stays on the graph while the file changes under it.
    await list();
    fireEvent.click(screen.getAllByRole("option")[1]!);
    expect(window.location.hash).toBe("#/vault/q/What%20now.md");
    const next = await list();
    expect(next).not.toBe(box);
    fireEvent.keyDown(next, { key: "ArrowDown" });
    fireEvent.keyDown(next, { key: "ArrowDown" });
    fireEvent.keyDown(next, { key: "Enter" });
    expect(window.location.hash).toBe("#/vault/src/Paper.md");
  });

  it("walks the list with the arrows and keeps the choice in view (ADR 0030)", async () => {
    const asked = scrollsInto();
    open();
    fireEvent.click(await graphTab());
    const box = await list();
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "End" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    const chosen = document.getElementById(
      box.getAttribute("aria-activedescendant") ?? ""
    );
    expect(chosen?.textContent).toContain("What now");
    expect(chosen?.getAttribute("aria-selected")).toBe("true");
    expect(asked.at(-1)?.row).toBe(chosen);
  });

  it("labels the centre always, and a node only while hovered or chosen", async () => {
    open();
    fireEvent.click(await graphTab());
    await list();
    const labels = () =>
      [...document.querySelectorAll("svg text[data-label]")].map(
        (t) => t.textContent
      );
    // The first row is the chosen one on opening.
    expect(labels()).toEqual(["Idea", "Other"]);
    fireEvent.mouseEnter(
      document.querySelector('svg [data-node="src/Paper.md"]')!
    );
    expect(labels()).toEqual(["Idea", "Other", "Paper"]);
    fireEvent.mouseLeave(
      document.querySelector('svg [data-node="src/Paper.md"]')!
    );
    expect(labels()).toEqual(["Idea", "Other"]);
  });

  it("says in words that a file with no links has none", async () => {
    open({ "vault.graph": { nodes: [GRAPH.nodes[0]], edges: [] } });
    fireEvent.click(await graphTab());
    expect(await screen.findByText("No links yet.")).toBeDefined();
    expect(screen.queryByRole("listbox", { name: "Graph" })).toBeNull();
  });

  it("says not known when the graph could not be read, never an empty neighbourhood", async () => {
    open({
      "vault.graph": () => {
        throw new Error("boom");
      },
    });
    fireEvent.click(await graphTab());
    expect(await screen.findByText("not known")).toBeDefined();
    expect(screen.queryByText("No links yet.")).toBeNull();
  });

  it("follows the open file", async () => {
    const asked = vi.fn(() => GRAPH);
    open({ "vault.graph": asked });
    fireEvent.click(await graphTab());
    await list();
    fireEvent.click(screen.getAllByRole("option")[0]!);
    await vi.waitFor(() =>
      expect(asked).toHaveBeenLastCalledWith({
        path: "notes/Other.md",
        hops: 1,
      })
    );
  });
});
