import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeCores,
  core,
  fixtureCopy,
  tmp,
  type CoreOptions,
} from "./test-core.js";
import type { IndexedOutlineResponse } from "./vault-outline.js";
import type { TagTree, TagNode } from "./vault-tags.js";

// Link resolution across the vault (#191; `docs/architecture.md` § Markdown,
// link grammar; § Index, Refresh): a derived column on the index, read
// through `vault.outline`. The corpus README's Links and Block ids rows are
// the oracle; the divergence (ambiguous resolves to nothing) is by design.

afterEach(closeCores);

type Core = Awaited<ReturnType<typeof core>>;
const SETTLE_MS = 40;

async function opened(vault: string, opts: CoreOptions = {}) {
  const c = await core({ settleMs: SETTLE_MS, ...opts });
  const reply = await c.mutate("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  return c;
}

const outlineOf = async (c: Core, path: string) => {
  const reply = await c.query<IndexedOutlineResponse>("vault.outline", {
    path,
  });
  expect(reply.error).toBeUndefined();
  return reply.result?.data as IndexedOutlineResponse;
};

const readable = async (c: Core, path: string) => {
  const r = await outlineOf(c, path);
  if (!r.readable) throw new Error(`unreadable: ${r.reason}`);
  return r;
};

/** `[target, resolution, resolvedPath]` per link, in document order. */
const resolutions = async (c: Core, path: string) =>
  (await readable(c, path)).outline.links.map((l) => [
    l.target,
    l.resolution,
    l.resolvedPath,
  ]);

const resolved = (path: string) => ["resolved", path] as const;

describe("README rows: links, resolved", () => {
  it("L1a–l — every form in links-all-forms.md resolves; the own-heading link to the file itself, the image to image.png", async () => {
    const c = await opened(await fixtureCopy("obsidian-corpus"));
    const sleep = "Sleep and consolidation.md";
    expect(await resolutions(c, "links-all-forms.md")).toEqual([
      ["Sleep and consolidation", ...resolved(sleep)],
      ["Sleep and consolidation", ...resolved(sleep)],
      ["Sleep and consolidation", ...resolved(sleep)],
      ["Sleep and consolidation", ...resolved(sleep)],
      ["Sleep and consolidation", ...resolved(sleep)],
      ["", ...resolved("links-all-forms.md")],
      ["Sleep and consolidation", ...resolved(sleep)],
      ["image.png", ...resolved("image.png")],
      ["Sleep and consolidation.md", ...resolved(sleep)],
      ["Sleep and consolidation.md", ...resolved(sleep)],
      ["Sleep and consolidation", ...resolved(sleep)],
    ]);
  });

  it("L2a — a bare name matching a/ and b/ is ambiguous and resolves to nothing", async () => {
    const c = await opened(await fixtureCopy("obsidian-corpus"));
    expect(await resolutions(c, "links-same-name.md")).toEqual([
      ["Klinzing 2019", "ambiguous", null],
    ]);
  });

  it("L3 — basename resolution is case-insensitive", async () => {
    const c = await opened(await fixtureCopy("obsidian-corpus"));
    expect(await resolutions(c, "links-case.md")).toEqual([
      ["sleep AND consolidation", ...resolved("Sleep and consolidation.md")],
    ]);
  });

  it("L4a–c — #heading, # Heading , and #HEADING all reach # Heading", async () => {
    const c = await opened(await fixtureCopy("obsidian-corpus"));
    expect(
      (await readable(c, "links-heading-fragment.md")).outline.links.map(
        (l) => [l.heading, l.resolution]
      )
    ).toEqual([
      [["heading"], "resolved"],
      [[" Heading "], "resolved"],
      [["HEADING"], "resolved"],
    ]);
  });

  it("L5a–i — a Markdown link beginning ./ or ../ resolves relative to the linking file; one that escapes the vault, and a ../ wikilink, do not (#203)", async () => {
    const c = await opened(await fixtureCopy("obsidian-corpus"));
    const sleep = "Sleep and consolidation.md";
    expect(await resolutions(c, "nested/deep/links-relative.md")).toEqual([
      ["../../Sleep and consolidation.md", ...resolved(sleep)],
      ["../../links-case.md", ...resolved("links-case.md")],
      ["../../a/Klinzing 2019.md", ...resolved("a/Klinzing 2019.md")],
      ["./Relative sibling.md", ...resolved("nested/deep/Relative sibling.md")],
      ["../Relative parent.md", ...resolved("nested/Relative parent.md")],
      ["../../Sleep and consolidation.md", ...resolved(sleep)],
      ["../../Sleep and consolidation.md", "unresolved", null],
      ["../../../Sleep and consolidation.md", "unresolved", null],
      ["../../Sleep and consolidation", "unresolved", null],
    ]);
  });

  it("B2, B3a–c, B1 — #^id resolves to the block, a ^c1 on a ### line included", async () => {
    const c = await opened(await fixtureCopy("obsidian-corpus"));
    expect(await resolutions(c, "blocks-on-heading-link.md")).toEqual([
      ["blocks-on-heading", ...resolved("blocks-on-heading.md")],
    ]);
    expect(
      (await readable(c, "blocks-generated-links.md")).outline.links.map(
        (l) => l.resolution
      )
    ).toEqual(Array<string>(7).fill("resolved"));
  });
});

describe("resolution rules the corpus leaves open", () => {
  it("a name no file has, a heading the file lacks, and a block id it lacks are each unresolved", async () => {
    const vault = await fixtureCopy("obsidian-corpus");
    await writeFile(
      join(vault, "Dangling.md"),
      [
        "[[Nowhere]]",
        "[[Sleep and consolidation#Missing heading]]",
        "[[Sleep and consolidation#H2#H1]]",
        "[[Sleep and consolidation#^nope]]",
        "[[#Not here either]]",
        "[[folder/Nowhere]]",
      ].join("\n") + "\n"
    );
    const c = await opened(vault);
    expect(
      (await readable(c, "Dangling.md")).outline.links.map((l) => [
        l.resolution,
        l.resolvedPath,
      ])
    ).toEqual(Array<unknown>(6).fill(["unresolved", null]));
  });

  it("a target with a slash resolves by vault-relative path, so a/ and b/ are each reachable", async () => {
    const vault = await fixtureCopy("obsidian-corpus");
    await writeFile(
      join(vault, "Qualified.md"),
      "[[a/Klinzing 2019]] [[B/klinzing 2019]] [md](b/Klinzing%202019.md)\n"
    );
    const c = await opened(vault);
    expect(await resolutions(c, "Qualified.md")).toEqual([
      ["a/Klinzing 2019", ...resolved("a/Klinzing 2019.md")],
      ["B/klinzing 2019", ...resolved("b/Klinzing 2019.md")],
      ["b/Klinzing 2019.md", ...resolved("b/Klinzing 2019.md")],
    ]);
  });

  it("an embed of a .png and a link to a .pdf resolve; a link to a dot-entry does not", async () => {
    const vault = await tmp("non-markdown");
    await mkdir(join(vault, "sources", "pdf"), { recursive: true });
    await mkdir(join(vault, ".obsidian"));
    await writeFile(join(vault, "plot.png"), "png bytes");
    await writeFile(join(vault, "sources", "pdf", "klinzing2019.pdf"), "%PDF");
    await writeFile(join(vault, ".obsidian", "workspace.md"), "hidden\n");
    await writeFile(
      join(vault, "Note.md"),
      "![[plot.png]] [[klinzing2019.pdf]] [[klinzing2019.pdf#page=3]] [[workspace]] [[.obsidian/workspace]]\n"
    );
    const c = await opened(vault);
    expect(await resolutions(c, "Note.md")).toEqual([
      ["plot.png", ...resolved("plot.png")],
      ["klinzing2019.pdf", ...resolved("sources/pdf/klinzing2019.pdf")],
      ["klinzing2019.pdf", ...resolved("sources/pdf/klinzing2019.pdf")],
      ["workspace", "unresolved", null],
      [".obsidian/workspace", "unresolved", null],
    ]);
  });
});

describe("resolution follows the vault without re-outlining the linking file", () => {
  it("a second same-named file created with fs turns a resolved link ambiguous; deleting it turns it back", async () => {
    const vault = await fixtureCopy("obsidian-corpus");
    // The linking file carries a Kind so a `positionsOf` stand-in logs every
    // time it is outlined — the proof that a rename elsewhere never re-reads it.
    await writeFile(
      join(vault, "Linker.md"),
      "---\nkind: linker\n---\n[[Sleep and consolidation]]\n"
    );
    const outlined: string[] = [];
    const c = await opened(vault, {
      positionsOf: { linker: (outline) => (outlined.push(outline.path), []) },
    });
    const before = await readable(c, "Linker.md");
    expect(before.outline.links[0]).toMatchObject({
      resolution: "resolved",
      resolvedPath: "Sleep and consolidation.md",
    });
    expect(outlined).toEqual(["Linker.md"]);

    const events = await c.events();
    await mkdir(join(vault, "twin"));
    await writeFile(
      join(vault, "twin", "Sleep and consolidation.md"),
      "twin\n"
    );
    await events.next("vaultChanged");
    const during = await readable(c, "Linker.md");
    expect(during.outline.links[0]).toMatchObject({
      resolution: "ambiguous",
      resolvedPath: null,
    });
    expect(during.hash).toBe(before.hash);
    expect(outlined).toEqual(["Linker.md"]);

    await rm(join(vault, "twin", "Sleep and consolidation.md"));
    await events.next("vaultChanged");
    const after = await readable(c, "Linker.md");
    expect(after.outline.links[0]).toMatchObject({
      resolution: "resolved",
      resolvedPath: "Sleep and consolidation.md",
    });
    expect(after.hash).toBe(before.hash);
    expect(outlined).toEqual(["Linker.md"]);
    events.close();
  });

  it("a file renamed in Obsidian (paired by hash, #189) loses the links that named it, gains the ones that name it now, and its own [[#Heading]] follows", async () => {
    const vault = await fixtureCopy("obsidian-corpus");
    await writeFile(join(vault, "Ahead.md"), "[[Consolidation]]\n");
    const c = await opened(vault);
    expect(await resolutions(c, "Ahead.md")).toEqual([
      ["Consolidation", "unresolved", null],
    ]);
    const events = await c.events();
    await rename(
      join(vault, "Sleep and consolidation.md"),
      join(vault, "Consolidation.md")
    );
    await rename(join(vault, "links-all-forms.md"), join(vault, "Forms.md"));
    const event = await events.next("vaultChanged");
    expect(event.renamed).toHaveLength(2);
    expect(await resolutions(c, "Ahead.md")).toEqual([
      ["Consolidation", ...resolved("Consolidation.md")],
    ]);
    expect(await resolutions(c, "links-case.md")).toEqual([
      ["sleep AND consolidation", "unresolved", null],
    ]);
    expect((await resolutions(c, "Forms.md"))[5]).toEqual([
      "",
      ...resolved("Forms.md"),
    ]);
    events.close();
  });

  it("from a root-level file, ./ names the root and ../ escapes it (#203)", async () => {
    const vault = await fixtureCopy("obsidian-corpus");
    await writeFile(
      join(vault, "Root.md"),
      "[here](./links-case.md) [above](../links-case.md)\n"
    );
    const c = await opened(vault);
    expect(await resolutions(c, "Root.md")).toEqual([
      ["./links-case.md", ...resolved("links-case.md")],
      ["../links-case.md", "unresolved", null],
    ]);
  });

  it("a relative Markdown link follows its target's creation, rename, and removal (#203)", async () => {
    const vault = await fixtureCopy("obsidian-corpus");
    await mkdir(join(vault, "nested", "deep"), { recursive: true });
    await writeFile(
      join(vault, "nested", "deep", "Rel.md"),
      "[later](../../Later.md) [moved](../Moved.md)\n"
    );
    await writeFile(join(vault, "nested", "Moved.md"), "moved\n");
    const c = await opened(vault);
    expect(await resolutions(c, "nested/deep/Rel.md")).toEqual([
      ["../../Later.md", "unresolved", null],
      ["../Moved.md", ...resolved("nested/Moved.md")],
    ]);
    const events = await c.events();
    await writeFile(join(vault, "Later.md"), "later\n");
    await events.next("vaultChanged");
    expect(await resolutions(c, "nested/deep/Rel.md")).toEqual([
      ["../../Later.md", ...resolved("Later.md")],
      ["../Moved.md", ...resolved("nested/Moved.md")],
    ]);
    await rename(join(vault, "nested", "Moved.md"), join(vault, "Moved.md"));
    await events.next("vaultChanged");
    expect(await resolutions(c, "nested/deep/Rel.md")).toEqual([
      ["../../Later.md", ...resolved("Later.md")],
      ["../Moved.md", "unresolved", null],
    ]);
    await rm(join(vault, "Later.md"));
    await events.next("vaultChanged");
    expect(await resolutions(c, "nested/deep/Rel.md")).toEqual([
      ["../../Later.md", "unresolved", null],
      ["../Moved.md", "unresolved", null],
    ]);
    events.close();
  });

  it("a heading renamed in the target re-resolves the links that pointed at it", async () => {
    const vault = await fixtureCopy("obsidian-corpus");
    const c = await opened(vault);
    expect(
      (await readable(c, "links-heading-fragment.md")).outline.links.map(
        (l) => l.resolution
      )
    ).toEqual(["resolved", "resolved", "resolved"]);
    const events = await c.events();
    await writeFile(
      join(vault, "Sleep and consolidation.md"),
      "# Renamed\n\nA paragraph. ^blockid\n"
    );
    await events.next("vaultChanged");
    expect(
      (await readable(c, "links-heading-fragment.md")).outline.links.map(
        (l) => l.resolution
      )
    ).toEqual(["unresolved", "unresolved", "unresolved"]);
    events.close();
  });
});

describe("vault.outline is assembled from the index", () => {
  it("a path the index has not reached during a background build answers not-indexed, never a fresh outline", async () => {
    const vault = await tmp("building");
    for (let n = 1; n <= 12; n++) {
      await writeFile(join(vault, `Note ${n}.md`), `# Note ${n}\n`);
    }
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let chunks = 0;
    const c = await core({
      chunkSize: 10,
      // Hold the build after its first chunk so the second is observably
      // not there yet.
      onVaultChanged: async () => {
        if (++chunks === 1) await held;
      },
    });
    const reply = await c.mutate("vault.open", { path: vault });
    expect(reply.error).toBeUndefined();
    await new Promise<void>((resolve) => {
      const tick = () => (chunks >= 1 ? resolve() : setImmediate(tick));
      tick();
    });

    const answers = await Promise.all(
      Array.from({ length: 12 }, (_, i) => outlineOf(c, `Note ${i + 1}.md`))
    );
    const pending = answers.filter((a) => !a.readable);
    expect(pending).toHaveLength(2);
    for (const a of pending) {
      expect(a).toMatchObject({
        readable: false,
        reason: expect.stringMatching(/index/) as string,
      });
    }
    release();
    await c.indexed();
    for (const a of pending) {
      expect((await outlineOf(c, a.path)).readable).toBe(true);
    }
  });

  it("stores a kind: the app does not know verbatim, with no problem row", async () => {
    const vault = await tmp("unknown-kind");
    await writeFile(
      join(vault, "Mine.md"),
      "---\nkind: recipe\n---\n## Steps\n"
    );
    const c = await opened(vault);
    expect(await readable(c, "Mine.md")).toMatchObject({
      kind: "recipe",
      shape: [],
      criteria: [],
    });
  });

  it("agrees with vault.tags about every corpus file's tags", async () => {
    const vault = await fixtureCopy("obsidian-corpus");
    const c = await opened(vault);
    const tree = (await c.query<TagTree>("vault.tags")).result?.data as TagTree;
    const flatten = (nodes: TagNode[]): TagNode[] =>
      nodes.flatMap((n) => [n, ...flatten(n.children)]);
    const byFile = new Map<string, string[]>();
    for (const n of flatten(tree.tags)) {
      for (const o of n.occurrences) {
        byFile.set(o.path, [...(byFile.get(o.path) ?? []), n.canonical]);
      }
    }
    for (const [path, tags] of byFile) {
      const r = await readable(c, path);
      expect(
        r.outline.tags
          .filter((t) => t.valid)
          .map((t) => t.canonical)
          .sort(),
        path
      ).toEqual(tags.sort());
    }
  });
});
