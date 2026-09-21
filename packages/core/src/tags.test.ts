import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, fixtureCopy, tmp } from "./test-core.js";
import type { TagNode, TagTree } from "./vault-tags.js";

// Golden tests for `vault.tags` over the Obsidian-written corpus (#191, the
// half #120 re-scoped here): the README's Observed column is the oracle for
// identity and counts; display casing is the app's own divergence.

afterEach(closeCores);

async function openedCorpus() {
  const c = await core({ settleMs: 40 });
  const path = await fixtureCopy("obsidian-corpus");
  const reply = await c.mutate("vault.open", { path });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  return { c, path };
}

const treeOf = async (c: Awaited<ReturnType<typeof core>>) => {
  const reply = await c.query<TagTree>("vault.tags");
  expect(reply.error).toBeUndefined();
  return reply.result?.data as TagTree;
};

/** Every node in the tree, depth first, so a test can find one by canonical form. */
function flatten(nodes: TagNode[]): TagNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}
const node = (tree: TagTree, canonical: string) => {
  const found = flatten(tree.tags).find((n) => n.canonical === canonical);
  if (!found) throw new Error(`no node ${canonical}`);
  return found;
};

describe("vault.tags over the corpus", () => {
  it("is a tree: roots are the first segments, children nest by slash, siblings sorted by canonical form", async () => {
    const { c } = await openedCorpus();
    const tree = await treeOf(c);
    expect(tree.tags.map((n) => n.canonical)).toEqual([
      "a",
      "afterfence",
      "alpha",
      "beta",
      "comparison",
      "control",
      "gamma",
      "incomment",
      "insidehtml",
      "ml",
      "nested",
      "other",
      "simple",
      "tag",
      "with-dash",
      "with_underscore",
      "y1984",
      "émoji🙂",
    ]);
    expect(node(tree, "nested").children.map((n) => n.canonical)).toEqual([
      "nested/two",
    ]);
    expect(node(tree, "nested/two").children.map((n) => n.canonical)).toEqual([
      "nested/two/levels",
    ]);
    expect(node(tree, "nested/two/levels").children).toEqual([]);
  });

  it("T1b, T1c — #ML/Probing, #ml/probing, and the frontmatter ml/probing are one node, displayed by majority casing per segment", async () => {
    const { c } = await openedCorpus();
    const probing = node(await treeOf(c), "ml/probing");
    expect(probing.display).toBe("ml/probing");
    expect(probing.name).toBe("probing");
    expect(probing.occurrences).toEqual([
      {
        path: "props-list-tags.md",
        written: "ml/probing",
        source: "frontmatter",
      },
      { path: "tags-valid.md", written: "ML/Probing", source: "inline" },
      { path: "tags-valid.md", written: "ml/probing", source: "inline" },
    ]);
    expect(probing.count).toEqual({ inclusive: 3, exclusive: 3 });
  });

  it("an implicit parent is present with the union of its children's files and no occurrence of its own", async () => {
    const { c } = await openedCorpus();
    const tree = await treeOf(c);
    const ml = node(tree, "ml");
    expect(ml.implicit).toBe(true);
    expect(ml.occurrences).toEqual([]);
    expect(ml.count).toEqual({ inclusive: 3, exclusive: 0 });
    expect(ml.files).toEqual(["props-list-tags.md", "tags-valid.md"]);
    expect(node(tree, "ml/probing").implicit).toBe(false);
    // T2c: `#a//b` keeps its empty segment — `a` → (empty) → `b`.
    expect(node(tree, "a").children.map((n) => [n.canonical, n.name])).toEqual([
      ["a/", ""],
    ]);
    expect(node(tree, "a/").children.map((n) => n.canonical)).toEqual(["a//b"]);
  });

  it("counts are occurrences, inclusive with descendants and exclusive at this level, and files is the inclusive union", async () => {
    const { c } = await openedCorpus();
    const tree = await treeOf(c);
    expect(node(tree, "nested").count).toEqual({ inclusive: 1, exclusive: 0 });
    expect(node(tree, "nested/two/levels").count).toEqual({
      inclusive: 1,
      exclusive: 1,
    });
    // `alpha` is in three files' frontmatter, once (F2b) as the surviving
    // piece of `- alpha, beta`.
    expect(node(tree, "alpha")).toMatchObject({
      count: { inclusive: 3, exclusive: 3 },
      files: [
        "props-comma-tags.md",
        "props-comment-and-order.md",
        "props-list-tags.md",
      ],
    });
    expect(node(tree, "beta")).toMatchObject({
      implicit: true,
      count: { inclusive: 1, exclusive: 0 },
      children: [expect.objectContaining({ canonical: "beta/nested" })],
    });
  });

  it("records each occurrence's source — a frontmatter `tags:` entry or an inline #tag", async () => {
    const { c } = await openedCorpus();
    const tree = await treeOf(c);
    expect(node(tree, "alpha").occurrences.map((o) => o.source)).toEqual([
      "frontmatter",
      "frontmatter",
      "frontmatter",
    ]);
    expect(node(tree, "simple").occurrences).toEqual([
      { path: "tags-valid.md", written: "simple", source: "inline" },
    ]);
  });

  it("F2b, F8 — invalid `tags:` entries are listed with their file, never dropped", async () => {
    const { c } = await openedCorpus();
    const tree = await treeOf(c);
    expect(tree.invalid).toEqual([
      {
        path: "props-comma-tags.md",
        written: " beta",
        reason: "contains whitespace",
        source: "frontmatter",
      },
      {
        path: "props-tag-with-space.md",
        written: "machine learning",
        reason: "contains whitespace",
        source: "frontmatter",
      },
    ]);
  });

  it("T2b — `#tag/` is the node `tag`, its display form without the slash", async () => {
    const { c } = await openedCorpus();
    const tag = node(await treeOf(c), "tag");
    expect(tag.display).toBe("tag");
    expect(tag.occurrences).toEqual([
      { path: "tags-invalid.md", written: "tag/", source: "inline" },
    ]);
  });
});

describe("display casing ties", () => {
  it("go to the canonical form when it was written, else to the form that sorts first", async () => {
    const vault = await tmp("ties");
    await writeFile(join(vault, "One.md"), "#Foo and #foo\n");
    await writeFile(join(vault, "Two.md"), "#Bar and #BAR\n");
    const c = await core();
    const reply = await c.mutate("vault.open", { path: vault });
    expect(reply.error).toBeUndefined();
    await c.indexed();
    const tree = await treeOf(c);
    expect(node(tree, "foo").display).toBe("foo");
    expect(node(tree, "bar").display).toBe("BAR");
  });
});

describe("vault.tags under change", () => {
  it("a tag edit that changes the majority casing updates the display form after vaultChanged", async () => {
    const { c, path } = await openedCorpus();
    expect(node(await treeOf(c), "ml/probing").display).toBe("ml/probing");

    // Two more `ML/Probing` outvote the two lowercase forms.
    const events = await c.events();
    await writeFile(
      join(path, "Casing.md"),
      "A note tagged #ML/Probing twice: #ML/Probing\n"
    );
    await events.next("vaultChanged");
    const tree = await treeOf(c);
    expect(node(tree, "ml/probing").display).toBe("ML/Probing");
    expect(node(tree, "ml").display).toBe("ML");
    expect(node(tree, "ml/probing").count).toEqual({
      inclusive: 5,
      exclusive: 5,
    });
    events.close();
  });
});
