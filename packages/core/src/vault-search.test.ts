import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, vaultWith } from "./test-core.js";
import type { SearchHit } from "./vault-search.js";

// The core seam for the Vault's *search* tab (spec #680, #697): `vault.search`
// answers from the index's FTS5 table, driven through the core's own entry
// over a temp vault.

afterEach(closeCores);

async function opened(files: Record<string, string>) {
  const c = await core({ settleMs: 40 });
  const path = await vaultWith(files);
  const reply = await c.mutate("vault.open", { path });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  return { c, path };
}

type Core = Awaited<ReturnType<typeof opened>>["c"];
const search = async (c: Core, query: string) => {
  const reply = await c.query<SearchHit[]>("vault.search", { query });
  expect(reply.error).toBeUndefined();
  return reply.result?.data ?? [];
};

/** The marked slices of a hit's line, in order. */
const marked = (hit: SearchHit) =>
  hit.marks.map(([from, to]) => hit.line.slice(from, to));

describe("vault.search", () => {
  it("finds a note by a word in its body, with the matching line and the term marked", async () => {
    const { c } = await opened({
      "notes/Idea.md":
        "First line\nProbing finds the feature direction.\nEnd\n",
      "notes/Other.md": "Nothing relevant\n",
    });
    const hits = await search(c, "probing");
    expect(hits.map((h) => h.path)).toEqual(["notes/Idea.md"]);
    expect(hits[0]?.line).toBe("Probing finds the feature direction.");
    expect(marked(hits[0] as SearchHit)).toEqual(["Probing"]);
  });

  it("carries the file's Kind, and matches a Question's body too", async () => {
    const { c } = await opened({
      "q.md":
        "---\nkind: question\nid: qqqqqqqqqq\n---\n# Does grokking recur?\n",
    });
    const hits = await search(c, "grokking");
    expect(hits).toMatchObject([{ path: "q.md", kind: "question" }]);
  });

  it("takes every word, and the last one as a prefix while it is being typed", async () => {
    const { c } = await opened({
      "a.md": "sparse autoencoders reveal features\n",
      "b.md": "sparse coding only\n",
    });
    expect((await search(c, "sparse auto")).map((h) => h.path)).toEqual([
      "a.md",
    ]);
    const both = await search(c, "sparse");
    expect(both.map((h) => h.path).sort()).toEqual(["a.md", "b.md"]);
  });

  it("marks every occurrence of every term on the line, whatever its case", async () => {
    const { c } = await opened({
      "a.md": "Circuits and more circuits, with a Feature.\n",
    });
    const [hit] = await search(c, "circuits feature");
    expect(marked(hit as SearchHit)).toEqual([
      "Circuits",
      "circuits",
      "Feature",
    ]);
  });

  it("marks a word the index matched by folding case and accents, and treats _ as a break", async () => {
    const { c } = await opened({
      "a.md": "A quiet café near the Zürich lab.\n",
      "b.md": "uses foo bar here\n",
    });
    const [cafe] = await search(c, "cafe");
    expect(marked(cafe as SearchHit)).toEqual(["café"]);
    const [zurich] = await search(c, "ZURICH");
    expect(marked(zurich as SearchHit)).toEqual(["Zürich"]);
    const [pair] = await search(c, "foo_bar");
    expect(pair?.path).toBe("b.md");
    expect(marked(pair as SearchHit)).toEqual(["foo", "bar"]);
  });

  it("does not search frontmatter or the files that are not Markdown", async () => {
    const { c } = await opened({
      "a.md": "---\ntitle: Zebra\n---\nbody\n",
      "data.txt": "zebra\n",
    });
    expect(await search(c, "zebra")).toEqual([]);
  });

  it("answers a query with no word in it with nothing, and a quote or operator as plain text", async () => {
    const { c } = await opened({ "a.md": "cats AND dogs\n" });
    expect(await search(c, "  ?? ")).toEqual([]);
    expect(await search(c, '"')).toEqual([]);
    expect((await search(c, 'AND "dogs" NOT')).map((h) => h.path)).toEqual([]);
    expect((await search(c, "cats AND")).map((h) => h.path)).toEqual(["a.md"]);
  });

  it("follows an edit and a delete on disk", async () => {
    const { c, path } = await opened({ "a.md": "alpha\n", "b.md": "alpha\n" });
    await writeFile(join(path, "a.md"), "omega\n");
    await expect
      .poll(async () => (await search(c, "omega")).map((h) => h.path))
      .toEqual(["a.md"]);
    expect((await search(c, "alpha")).map((h) => h.path)).toEqual(["b.md"]);
    const { rm } = await import("node:fs/promises");
    await rm(join(path, "b.md"));
    await expect.poll(async () => await search(c, "alpha")).toEqual([]);
  });

  it("caps the list, so a common word does not hand the window a thousand rows", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 80; i++) files[`n/${i}.md`] = "common word\n";
    const { c } = await opened(files);
    expect(await search(c, "common")).toHaveLength(50);
  });

  it("builds the body table when an older index is opened, without losing a file", async () => {
    const vault = await vaultWith({
      "a.md": "alpha text\n",
      "sub/b.md": "beta text\n",
    });
    await mkdir(join(vault, ".vitrine"));
    // The version before this table: every other table is there, none of the bodies.
    const old = new DatabaseSync(join(vault, ".vitrine", "index.sqlite"));
    old.exec("PRAGMA user_version = 8; CREATE TABLE files (path TEXT)");
    old.close();
    const c = await core({ settleMs: 40 });
    expect(
      (await c.mutate("vault.open", { path: vault })).error
    ).toBeUndefined();
    await c.indexed();
    expect((await search(c, "text")).map((h) => h.path).sort()).toEqual([
      "a.md",
      "sub/b.md",
    ]);
  });
});
