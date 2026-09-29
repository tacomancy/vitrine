import { mkdir, open, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, fixtures, vaultWith } from "./test-core.js";

afterEach(closeCores);

// Ingest of a returning PDF (#419; spec #416 stories 13–24, 58): an annotated
// PDF that changes on disk is read when it settles, every markup and note
// becomes one block in its Source, and the run says what landed in one line.
// Matching is not here — every annotation is new — so these tests state only
// what a first return looks like.

const pdf = (name: string) => readFile(join(fixtures, "pdf", name));
const SOURCE = `---
kind: source
id: src-1
citekey: rasch2013
title: Odor cues during slow-wave sleep
pdf: rasch2013.pdf
---
Notes I typed.
`;

type Sidecar = {
  pdf: string;
  file: { size: number; mtime: number; hash: string };
  next_block: number;
  annotations: Array<Record<string, unknown>>;
};

async function opened(extra: Record<string, string> = {}) {
  const vault = await vaultWith({
    "sources/rasch2013.md": SOURCE,
    "sources/pdf/rasch2013.pdf": "",
    ...extra,
  });
  await writeFile(
    join(vault, "sources/pdf/rasch2013.pdf"),
    await pdf("synthetic-body.pdf")
  );
  const c = await core({ settleMs: 40 });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const events = await c.events();
  const source = () => readFile(join(vault, "sources/rasch2013.md"), "utf8");
  const sidecar = async () =>
    JSON.parse(
      await readFile(join(vault, ".vitrine/annotations/src-1.json"), "utf8")
    ) as Sidecar;
  /** Replace the PDF as Preview would on a return, and wait for the run it makes. */
  const returned = async (bytes: Buffer, name = "rasch2013.pdf") => {
    await writeFile(join(vault, "sources/pdf", name), bytes);
    return (await events.next("ingestLanded")).summary;
  };
  return { vault, c, events, source, sidecar, returned };
}

describe("an annotated PDF returning", () => {
  it("adds one block per markup and note, in page order, with the quote and then the note", async () => {
    const { source, returned } = await opened();
    expect(await returned(await pdf("annotated.pdf"))).toEqual({
      new: 6,
      questions: 0,
      removed: 0,
      unmatched: 0,
    });
    expect(await source()).toBe(`---
kind: source
id: src-1
citekey: rasch2013
title: Odor cues during slow-wave sleep
pdf: rasch2013.pdf
---
Notes I typed.

## Annotations

- p.1 · "Participants who heard the odor cue" ^h1

  Check this against the control group

- p.1 · "difference was reliable across the downstream analyses" ^h2

- p.1 · "Ask Ana about this" ^h3

- p.2 · "different sentence about memory" ^h4
`);
  });

  it("makes every block a target a link resolves to", async () => {
    const { returned, c } = await opened({
      "questions/does it hold.md":
        "---\nkind: question\nquestion: Does it hold?\nstatus: open\ncaptured: 2026-09-29T10:00:00Z\ncontext: other\nrelated: []\n---\nSee [[rasch2013#^h2]] and [[rasch2013#^h9]].\n",
    });
    await returned(await pdf("annotated.pdf"));
    await c.indexed();
    const outline = await c.query<{
      outline: { links: Array<{ blockId: string; resolution: string }> };
    }>("vault.outline", { path: "questions/does it hold.md" });
    expect(
      outline.result!.data.outline.links.map((l) => [l.blockId, l.resolution])
    ).toEqual([
      ["h2", "resolved"],
      ["h9", "unresolved"],
    ]);
  });

  it("keeps the raw values the tiers will compare, and no normalised quote", async () => {
    const { returned, sidecar } = await opened();
    await returned(await pdf("annotated.pdf"));
    const stored = await sidecar();
    expect(stored.pdf).toBe("rasch2013.pdf");
    expect(stored.next_block).toBe(5);
    const first = stored.annotations.find((a) => a["block"] === "h1")!;
    expect(first).toMatchObject({
      block: "h1",
      kind: "highlight",
      page: 0,
      quote: "Participants who heard the odor cue",
      note: "Check this against the control group",
    });
    expect(first["quads"]).toHaveLength(1);
    expect(Object.keys(first).sort()).not.toContain("normalised_quote");
    // The across-lines highlight keeps its raw case and both quads.
    const across = stored.annotations.find((a) => a["block"] === "h2")!;
    expect(across["quads"]).toHaveLength(2);
  });

  it("counts ink and a stamp and gives neither a block or a link target", async () => {
    const { returned, source, sidecar } = await opened();
    await returned(await pdf("annotated.pdf"));
    const stored = await sidecar();
    const kept = stored.annotations.filter((a) =>
      ["ink", "stamp"].includes(a["kind"] as string)
    );
    expect(kept.map((a) => a["kind"]).sort()).toEqual(["ink", "stamp"]);
    expect(kept.every((a) => a["block"] === undefined)).toBe(true);
    expect(await source()).not.toMatch(/ink|stamp/);
  });

  it("never reuses a block number, even after everything before it is gone", async () => {
    const { returned, source, sidecar } = await opened();
    await returned(await pdf("annotated.pdf"));
    expect((await sidecar()).next_block).toBe(5);
    await returned(await pdf("annotated-again.pdf"));
    // Matching is a later ticket: what is new is new, and takes the next number.
    const text = await source();
    expect(text).toContain('"Another line follows here for a highlight" ^h5');
    expect((await sidecar()).next_block).toBe(6);
    expect(text.match(/\^h\d+/g)).toEqual(["^h1", "^h2", "^h3", "^h4", "^h5"]);
  });

  it("writes nothing to the PDF", async () => {
    const { vault, returned } = await opened();
    const bytes = await pdf("annotated.pdf");
    await returned(bytes);
    expect(
      Buffer.compare(
        await readFile(join(vault, "sources/pdf/rasch2013.pdf")),
        bytes
      )
    ).toBe(0);
  });

  it("says nothing when the file has not changed since it was read", async () => {
    const { returned, events, vault } = await opened();
    await returned(await pdf("annotated.pdf"));
    // The same bytes again, touched: a sync client's rewrite is no change.
    await writeFile(
      join(vault, "sources/pdf/rasch2013.pdf"),
      await pdf("annotated.pdf")
    );
    await expect(
      events.next("ingestLanded", { timeoutMs: 400 })
    ).rejects.toThrow();
  });
});

describe("a vault opened again", () => {
  it("reads a PDF that changed while the app was closed, and only that one", async () => {
    const { c, vault, returned, source } = await opened();
    await returned(await pdf("annotated.pdf"));
    await c.close();
    // Nothing changed: the sweep at open finds each PDF as its sidecar
    // recorded it, and Ingest has nothing to do — not a second copy of h1–h4.
    const again = await core({ settleMs: 40 });
    await again.mutate("vault.open", { path: vault });
    await again.indexed();
    const events = await again.events();
    await expect(
      events.next("ingestLanded", { timeoutMs: 400 })
    ).rejects.toThrow();
    expect((await source()).match(/\^h\d+/g)).toHaveLength(4);
  });
});

describe("a batch of PDFs", () => {
  it("is one run and one summary, and a run with nothing matched opens no panel", async () => {
    const files: Record<string, string> = {};
    for (let n = 1; n <= 50; n++) {
      files[`sources/s${n}.md`] =
        `---\nkind: source\nid: s${n}\ncitekey: s${n}\npdf: s${n}.pdf\n---\n`;
    }
    const vault = await vaultWith(files);
    await mkdir(join(vault, "sources/pdf"), { recursive: true });
    const base = await pdf("annotated-again.pdf");
    const c = await core({ settleMs: 40 });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    const events = await c.events();
    for (let n = 1; n <= 50; n++) {
      // Distinct bytes: identical files that arrive together would pair as renames.
      await writeFile(
        join(vault, `sources/pdf/s${n}.pdf`),
        Buffer.concat([base, Buffer.from(`\n%${n}\n`)])
      );
    }
    const landed = await events.next("ingestLanded");
    expect(landed.summary).toEqual({
      new: 50,
      questions: 0,
      removed: 0,
      unmatched: 0,
    });
    expect(landed.sources).toHaveLength(50);
    await expect(
      events.next("ingestLanded", { timeoutMs: 400 })
    ).rejects.toThrow();
  });
});

describe("a PDF that is not on this Mac yet", () => {
  it("is never read until it is, and is read once it is", async () => {
    const vault = await vaultWith({ "sources/rasch2013.md": SOURCE });
    await mkdir(join(vault, "sources/pdf"), { recursive: true });
    // Sparse: a size and no blocks, which is what an online-only file looks like.
    const handle = await open(join(vault, "sources/pdf/rasch2013.pdf"), "w");
    await handle.truncate(4 * 1024 * 1024);
    await handle.close();
    const c = await core({ settleMs: 40 });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    const events = await c.events();
    await expect(
      events.next("ingestLanded", { timeoutMs: 400 })
    ).rejects.toThrow();
    expect(await readdir(join(vault, ".vitrine"))).not.toContain("annotations");
    await writeFile(
      join(vault, "sources/pdf/rasch2013.pdf"),
      await pdf("annotated.pdf")
    );
    expect((await events.next("ingestLanded")).summary.new).toBe(6);
  });
});

describe("a PDF that cannot be read", () => {
  it("leaves the Source alone and does not stop the next file", async () => {
    const { returned, source, vault } = await opened({
      "sources/other.md":
        "---\nkind: source\nid: src-2\ncitekey: other\npdf: other.pdf\n---\n",
    });
    await writeFile(join(vault, "sources/pdf/other.pdf"), "not a pdf at all");
    const summary = await returned(await pdf("annotated.pdf"));
    expect(summary.new).toBe(6);
    expect(await source()).toContain("## Annotations");
    expect(
      await readFile(join(vault, "sources/other.md"), "utf8")
    ).not.toContain("Annotations");
  });
});
