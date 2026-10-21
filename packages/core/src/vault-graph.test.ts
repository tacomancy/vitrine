import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, vaultWith } from "./test-core.js";
import type { Graph } from "./vault-graph.js";

// The core seam for the Vault's Graph tab (spec #740, #741): `vault.graph`
// driven through the core's own entry over a temp vault.

afterEach(closeCores);

async function opened(files: Record<string, string>) {
  const c = await core({ settleMs: 40 });
  const path = await vaultWith(files);
  expect((await c.mutate("vault.open", { path })).error).toBeUndefined();
  await c.indexed();
  return c;
}

const graph = async (
  c: Awaited<ReturnType<typeof opened>>,
  path: string,
  hops: 1 | 2 = 1
) => {
  const reply = await c.query<Graph>("vault.graph", { path, hops });
  expect(reply.error).toBeUndefined();
  return reply.result?.data as Graph;
};

const kind = (k: string) => `---\nkind: ${k}\n---\n`;

describe("vault.graph, first Ring", () => {
  it("draws the open file at the centre and its neighbours on the Ring, both directions", async () => {
    const c = await opened({
      "centre.md": "# C\n[[out]]\n",
      "out.md": "# out\n",
      "in.md": "[[centre]]\n",
      "far.md": "[[out]]\n",
    });
    const g = await graph(c, "centre.md");
    expect(g.nodes.map(({ path, hop }) => [path, hop])).toEqual([
      ["centre.md", 0],
      ["in.md", 1],
      ["out.md", 1],
    ]);
    expect(g.nodes[0]).toMatchObject({ x: 0, y: 0 });
    expect(g.edges).toEqual([
      { a: "centre.md", b: "in.md", count: 1 },
      { a: "centre.md", b: "out.md", count: 1 },
    ]);
  });

  it("collapses several links, block links included, in either direction into one counted edge", async () => {
    const c = await opened({
      "centre.md": "[[paper]] and [[paper#^h1]]\n",
      "paper.md":
        "---\nkind: source\nid: srcsrcsrc1\n---\n> quoted ^h1\n\nback [[centre]]\n",
    });
    const g = await graph(c, "centre.md");
    expect(g.edges).toEqual([{ a: "centre.md", b: "paper.md", count: 3 }]);
    expect(g.nodes).toHaveLength(2);
  });

  it("leaves out a self-link, and an ambiguous or unresolved one", async () => {
    const c = await opened({
      "centre.md": "[[centre]] [[dup]] [[nowhere]]\n",
      "one/dup.md": "x\n",
      "two/dup.md": "y\n",
    });
    const g = await graph(c, "centre.md");
    expect(g.nodes.map((n) => n.path)).toEqual(["centre.md"]);
    expect(g.edges).toEqual([]);
  });

  it("carries each node's Kind, null for a file that declares none", async () => {
    const c = await opened({
      "centre.md": "[[a]] [[b]]\n",
      "a.md": kind("question"),
      "b.md": "plain\n",
    });
    const g = await graph(c, "centre.md");
    expect(g.nodes.map((n) => [n.path, n.kind])).toEqual([
      ["centre.md", null],
      ["b.md", null],
      ["a.md", "question"],
    ]);
  });

  it("puts each Kind in its own sector, sorted by name inside it, whatever order the rows come in", async () => {
    const files = {
      "centre.md": "[[zeta]] [[alpha]] [[src]] [[q]]\n",
      "zeta.md": "z\n",
      "alpha.md": "a\n",
      "src.md": kind("source"),
      "q.md": kind("question"),
    };
    const g = await graph(await opened(files), "centre.md");
    // Sector order is fixed: notes, then Questions, then Sources.
    expect(g.nodes.slice(1).map((n) => n.path)).toEqual([
      "alpha.md",
      "zeta.md",
      "q.md",
      "src.md",
    ]);
    // Same input, same picture — on a fresh index with the files made in
    // another order, and on a repeated call.
    const reordered = Object.fromEntries(Object.entries(files).reverse());
    const c2 = await opened(reordered);
    expect(await graph(c2, "centre.md")).toEqual(g);
    expect(await graph(c2, "centre.md")).toEqual(g);
  });

  it("places the Ring at one radius, with distinct angles", async () => {
    const c = await opened({
      "centre.md": "[[a]] [[b]]\n",
      "a.md": "a\n",
      "b.md": "b\n",
    });
    const [, a, b] = (await graph(c, "centre.md")).nodes;
    const radius = (n: { x: number; y: number }) => Math.hypot(n.x, n.y);
    expect(radius(a!)).toBeCloseTo(1, 3);
    expect(radius(b!)).toBeCloseTo(1, 3);
    expect([a!.x, a!.y]).not.toEqual([b!.x, b!.y]);
  });

  it("centres a lone file in its sector, the note sector starting at the top", async () => {
    const c = await opened({ "centre.md": "[[a]]\n", "a.md": "a\n" });
    const [, a] = (await graph(c, "centre.md")).nodes;
    // Eight equal sectors of 45°: the first, from -90°, is centred on -67.5°.
    expect(a!.x).toBeCloseTo(Math.cos((-67.5 * Math.PI) / 180), 3);
    expect(a!.y).toBeCloseTo(Math.sin((-67.5 * Math.PI) / 180), 3);
  });
});

describe("vault.graph, second Ring", () => {
  const files = {
    "centre.md": "[[near]] [[also]]\n",
    "near.md": "[[far]] [[far2]]\n",
    "also.md": "[[far]]\n",
    "far.md": "[[near]] [[far2]] [[centre]]\n",
    "far2.md": kind("question"),
    "unrelated.md": "[[far2]]\n",
  };

  it("puts files two hops away on an outer Ring and adds the edges among every drawn file", async () => {
    const g = await graph(await opened(files), "centre.md", 2);
    expect(g.nodes.map(({ path, hop }) => [path, hop])).toEqual([
      ["centre.md", 0],
      ["also.md", 1],
      ["far.md", 1],
      ["near.md", 1],
      ["far2.md", 2],
    ]);
    const far2 = g.nodes.find((n) => n.path === "far2.md")!;
    expect(Math.hypot(far2.x, far2.y)).toBeCloseTo(2, 3);
    expect(g.edges).toEqual([
      { a: "also.md", b: "centre.md", count: 1 },
      { a: "also.md", b: "far.md", count: 1 },
      { a: "centre.md", b: "far.md", count: 1 },
      { a: "centre.md", b: "near.md", count: 1 },
      { a: "far.md", b: "far2.md", count: 1 },
      { a: "far.md", b: "near.md", count: 2 },
      { a: "far2.md", b: "near.md", count: 1 },
    ]);
  });

  it("never moves a hop-1 node when the hops change", async () => {
    const c = await opened(files);
    const one = await graph(c, "centre.md", 1);
    const two = await graph(c, "centre.md", 2);
    expect(two.nodes.filter((n) => n.hop <= 1)).toEqual(one.nodes);
  });

  it("keeps a Kind's sector on the outer Ring, sorted by name inside it", async () => {
    const c = await opened({
      "centre.md": "[[near]]\n",
      "near.md": "[[zeta]] [[alpha]] [[q]]\n",
      "zeta.md": "z\n",
      "alpha.md": "a\n",
      "q.md": kind("question"),
    });
    const g = await graph(c, "centre.md", 2);
    expect(g.nodes.slice(2).map((n) => n.path)).toEqual([
      "alpha.md",
      "zeta.md",
      "q.md",
    ]);
  });

  it("does not draw a file that is both one and two hops away twice, or the centre as a hop-2 node", async () => {
    const g = await graph(
      await opened({
        "centre.md": "[[a]] [[b]]\n",
        "a.md": "[[b]] [[centre]]\n",
        "b.md": "x\n",
      }),
      "centre.md",
      2
    );
    expect(g.nodes.map((n) => [n.path, n.hop])).toEqual([
      ["centre.md", 0],
      ["a.md", 1],
      ["b.md", 1],
    ]);
  });
});
