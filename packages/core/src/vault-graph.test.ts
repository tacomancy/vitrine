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

const graph = async (c: Awaited<ReturnType<typeof opened>>, path: string) => {
  const reply = await c.query<Graph>("vault.graph", { path, hops: 1 });
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

describe("vault.graph, Not drawn", () => {
  it("lists an ambiguous and an unresolved link, each with its file, the target as written and its state", async () => {
    const c = await opened({
      "centre.md": "[[Dup]] and [[nowhere]] and [[ok]]\n",
      "ok.md": "fine\n",
      "one/dup.md": "x\n",
      "two/dup.md": "y\n",
    });
    const g = await graph(c, "centre.md");
    expect(g.notDrawn).toEqual([
      { path: "centre.md", target: "Dup", state: "ambiguous" },
      { path: "centre.md", target: "nowhere", state: "unresolved" },
    ]);
    // Neither is a ghost: only the resolved neighbour is a node or an edge.
    expect(g.nodes.map((n) => n.path)).toEqual(["centre.md", "ok.md"]);
    expect(g.edges).toHaveLength(1);
  });

  it("counts a link to a file whose block or heading is gone as unresolved", async () => {
    const c = await opened({
      "centre.md": "[[paper#^gone]]\n",
      "paper.md": "text ^here\n",
    });
    const g = await graph(c, "centre.md");
    expect(g.notDrawn).toEqual([
      { path: "centre.md", target: "paper", state: "unresolved" },
    ]);
  });

  it("includes the links of the files on the Ring, with the file each is in", async () => {
    const c = await opened({
      "centre.md": "[[a]]\n",
      "a.md": "[[missing]]\n",
      "far.md": "[[missing-too]]\n",
    });
    const g = await graph(c, "centre.md");
    // far.md is not in the neighbourhood, so its link is not this graph's.
    expect(g.notDrawn).toEqual([
      { path: "a.md", target: "missing", state: "unresolved" },
    ]);
  });

  it("lists each link once as written, by file name and then document order", async () => {
    const c = await opened({
      "centre.md": "[[zz]] [[aa]] [[zz]]\n[[a]]\n",
      "a.md": "[[b-gone]]\n",
    });
    const g = await graph(c, "centre.md");
    expect(g.notDrawn.map((n) => [n.path, n.target])).toEqual([
      ["a.md", "b-gone"],
      ["centre.md", "zz"],
      ["centre.md", "aa"],
      ["centre.md", "zz"],
    ]);
  });

  it("is empty when every link resolves", async () => {
    const c = await opened({ "centre.md": "[[a]]\n", "a.md": "a\n" });
    expect((await graph(c, "centre.md")).notDrawn).toEqual([]);
  });
});
