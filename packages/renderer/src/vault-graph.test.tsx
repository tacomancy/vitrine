import { cleanup, fireEvent, screen, within } from "@testing-library/react";
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
  notDrawn: [] as { path: string; target: string; state: string }[],
  overflow: [] as {
    path: string;
    kind: string | null;
    hop: number;
    links: number;
  }[],
};
const OVERFLOW = [
  { path: "notes/Busy.md", kind: null, hop: 1, links: 4 },
  { path: "src/Cut.md", kind: "source", hop: 2, links: 1 },
];
const NOT_DRAWN = [
  { path: "notes/Idea.md", target: "Dup", state: "ambiguous" },
  { path: "notes/Other.md", target: "nowhere", state: "unresolved" },
];

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

  it("asks for two hops and lists its neighbours in layout order, with name and Kind", async () => {
    const asked = vi.fn(() => GRAPH);
    open({ "vault.graph": asked });
    fireEvent.click(await graphTab());
    const box = await list();
    expect(asked).toHaveBeenCalledWith({ path: "notes/Idea.md", hops: 2 });
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

  it("lists each node's hop, a second-Ring node after the first and a control switches to one hop", async () => {
    const asked = vi.fn(({ hops }: { hops: number }) =>
      hops === 1
        ? GRAPH
        : {
            ...GRAPH,
            nodes: [
              ...GRAPH.nodes,
              { path: "far/Away.md", kind: null, hop: 2, x: 2, y: 0 },
            ],
          }
    );
    open({ "vault.graph": asked });
    fireEvent.click(await graphTab());
    await list();
    const rows = () => screen.getAllByRole("option").map((o) => o.textContent);
    expect(rows()).toHaveLength(4);
    expect(rows()[0]).toContain("1 hop");
    expect(rows()[3]).toContain("Away");
    expect(rows()[3]).toContain("2 hops");
    const two = screen.getByRole<HTMLInputElement>("radio", { name: "2" });
    expect(two.checked).toBe(true);
    // A radio group is one tab stop moved by the arrows; a click is its stand-in here.
    fireEvent.click(screen.getByRole("radio", { name: "1" }));
    await vi.waitFor(() => expect(rows()).toHaveLength(3));
    expect(asked).toHaveBeenLastCalledWith({ path: "notes/Idea.md", hops: 1 });
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
    open({
      "vault.graph": {
        nodes: [GRAPH.nodes[0]],
        edges: [],
        notDrawn: [],
        overflow: [],
      },
    });
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
        hops: 2,
      })
    );
  });

  it("counts and lists the links it cannot draw, each with its file, target as written and state", async () => {
    open({ "vault.graph": { ...GRAPH, notDrawn: NOT_DRAWN } });
    fireEvent.click(await graphTab());
    await list();
    const panel = screen.getByRole("region", { name: "Not drawn" });
    expect(within(panel).getByText("2 not drawn")).toBeDefined();
    const items = within(panel)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items).toEqual([
      expect.stringMatching(/Idea.*\[\[Dup\]\].*ambiguous/),
      expect.stringMatching(/Other.*\[\[nowhere\]\].*unresolved/),
    ]);
    // Counted and listed, never drawn: no ghost node, no extra line.
    expect(document.querySelectorAll("svg [data-node]")).toHaveLength(4);
    expect(document.querySelectorAll("svg line")).toHaveLength(3);
  });

  it("links the count to Loose Ends, where an ambiguous link has its row", async () => {
    open({ "vault.graph": { ...GRAPH, notDrawn: NOT_DRAWN } });
    fireEvent.click(await graphTab());
    await list();
    const link = screen.getByRole("link", { name: "2 not drawn" });
    expect(link.getAttribute("href")).toBe("#/loose-ends");
  });

  it("does not link the count when nothing is ambiguous: Loose Ends has no row for an unresolved link", async () => {
    open({
      "vault.graph": { ...GRAPH, notDrawn: NOT_DRAWN.slice(1) },
    });
    fireEvent.click(await graphTab());
    await list();
    expect(screen.getByText("1 not drawn")).toBeDefined();
    expect(screen.queryByRole("link", { name: "1 not drawn" })).toBeNull();
  });

  it("draws no Not drawn panel when every link lands", async () => {
    open();
    fireEvent.click(await graphTab());
    await list();
    expect(screen.queryByRole("region", { name: "Not drawn" })).toBeNull();
  });

  it("does not call a file with only undrawable links linkless", async () => {
    open({
      "vault.graph": {
        nodes: [GRAPH.nodes[0]],
        edges: [],
        notDrawn: NOT_DRAWN,
      },
    });
    fireEvent.click(await graphTab());
    expect(await screen.findByText("2 not drawn")).toBeDefined();
    expect(screen.queryByText("No links yet.")).toBeNull();
  });
});

describe("the Graph tab, overflow", () => {
  it("says how many a Ring's cap left off and lists them ranked, with Kind, hop and links", async () => {
    open({ "vault.graph": { ...GRAPH, overflow: OVERFLOW } });
    fireEvent.click(await graphTab());
    await list();
    const panel = screen.getByRole("region", { name: "Not shown" });
    expect(within(panel).getByText("+2 more")).toBeDefined();
    expect(
      within(panel)
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual([
      expect.stringMatching(/Busy.*note.*1 hop.*4 links/),
      expect.stringMatching(/Cut.*source.*2 hops.*1 link\b/),
    ]);
    // Not drawn: a cut node is a row in this list and no dot.
    expect(document.querySelectorAll("svg [data-node]")).toHaveLength(4);
  });

  it("opens a cut node's file from its row", async () => {
    open({ "vault.graph": { ...GRAPH, overflow: OVERFLOW } });
    fireEvent.click(await graphTab());
    await list();
    const panel = screen.getByRole("region", { name: "Not shown" });
    fireEvent.click(within(panel).getByRole("button", { name: /Cut/ }));
    expect(window.location.hash).toBe("#/vault/src/Cut.md");
  });

  it("draws no panel when nothing was cut", async () => {
    open();
    fireEvent.click(await graphTab());
    await list();
    expect(screen.queryByRole("region", { name: "Not shown" })).toBeNull();
  });
});
