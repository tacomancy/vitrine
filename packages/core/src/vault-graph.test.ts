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

describe("vault.graph, Ring caps", () => {
  // n leaves n01..nNN, all linked from the centre: each has one link.
  const leaves = (n: number) =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [
        `n${String(i + 1).padStart(2, "0")}.md`,
        "x\n",
      ])
    );
  const hub = (n: number) => ({
    "centre.md": Object.keys(leaves(n))
      .map((p) => `[[${p.replace(".md", "")}]]`)
      .join(" "),
    ...leaves(n),
  });

  it("keeps all 40 on the first Ring and cuts nothing", async () => {
    const g = await graph(await opened(hub(40)), "centre.md");
    expect(g.nodes).toHaveLength(41);
    expect(g.overflow).toEqual([]);
  });

  it("cuts the 41st by name when every file has the same links, and lists it", async () => {
    const g = await graph(await opened(hub(41)), "centre.md");
    expect(g.nodes).toHaveLength(41);
    expect(g.nodes.map((n) => n.path)).not.toContain("n41.md");
    expect(g.overflow).toEqual([
      { path: "n41.md", kind: null, hop: 1, links: 1 },
    ]);
    // A cut node is no line either: nothing is drawn to a file not drawn.
    expect(g.edges).toHaveLength(40);
  });

  it("keeps the most-linked over the name-first, and ranks the overflow most-linked first, then by name", async () => {
    const files: Record<string, string> = hub(43);
    // zz is last by name but has two links; yy and xx have one more each than the rest.
    files["centre.md"] += " [[zz]] [[yy]]";
    files["zz.md"] = "[[extra]] [[extra2]]\n";
    files["yy.md"] = "[[extra]]\n";
    files["extra.md"] = "x\n";
    files["extra2.md"] = "x\n";
    const g = await graph(await opened(files), "centre.md");
    const paths = g.nodes.map((n) => n.path);
    expect(paths).toContain("zz.md");
    expect(paths).toContain("yy.md");
    // 45 neighbours: the 5 name-last of the one-link files are cut, in name order.
    expect(g.overflow.map((o) => o.path)).toEqual([
      "n39.md",
      "n40.md",
      "n41.md",
      "n42.md",
      "n43.md",
    ]);
    const cutAt = (path: string) =>
      g.overflow.findIndex((o) => o.path === path);
    expect(cutAt("n39.md")).toBeLessThan(cutAt("n43.md"));
  });

  it("ranks overflow by link count before name", async () => {
    // Forty files with three links each fill the Ring; a1 has one link and
    // b1 has two, so b1 outranks a1 in the list though it sorts after it.
    const files: Record<string, string> = {};
    const names = Array.from({ length: 40 }, (_, i) => `n${i}`);
    for (const n of names) files[`${n}.md`] = "[[extra]] [[extra2]]\n";
    files["centre.md"] = [...names, "a1", "b1"]
      .map((n) => `[[${n}]]`)
      .join(" ");
    files["a1.md"] = "x\n";
    files["b1.md"] = "[[extra]]\n";
    files["extra.md"] = "x\n";
    files["extra2.md"] = "x\n";
    const g = await graph(await opened(files), "centre.md");
    expect(g.overflow).toEqual([
      { path: "b1.md", kind: null, hop: 1, links: 2 },
      { path: "a1.md", kind: null, hop: 1, links: 1 },
    ]);
    expect(g.nodes.filter((n) => n.hop === 1)).toHaveLength(40);
  });

  it("keeps all 80 on the second Ring and cuts the 81st", async () => {
    const second = (n: number) => ({
      "centre.md": "[[mid]]\n",
      "mid.md": hub(n)["centre.md"],
      ...leaves(n),
    });
    const eighty = await graph(await opened(second(80)), "centre.md", 2);
    expect(eighty.nodes.filter((n) => n.hop === 2)).toHaveLength(80);
    expect(eighty.overflow).toEqual([]);

    const eightyOne = await graph(await opened(second(81)), "centre.md", 2);
    expect(eightyOne.nodes.filter((n) => n.hop === 2)).toHaveLength(80);
    expect(eightyOne.overflow).toEqual([
      { path: "n81.md", kind: null, hop: 2, links: 1 },
    ]);
  });

  it("does not move a kept node when the cut changes", async () => {
    const one = await graph(await opened(hub(41)), "centre.md");
    const two = await graph(await opened(hub(44)), "centre.md");
    expect(two.nodes).toEqual(one.nodes);
    expect(two.overflow.map((o) => o.path)).toEqual([
      "n41.md",
      "n42.md",
      "n43.md",
      "n44.md",
    ]);
  });
});
