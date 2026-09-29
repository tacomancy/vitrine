import {
  open,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LooseEnds } from "./loose-ends.js";
import type { Candidates } from "./picker.js";
import { closeCores, core, vaultWith } from "./test-core.js";
import type { OutlineResponse } from "./vault-files.js";

afterEach(closeCores);

// Attaching a PDF makes a Source (#417; spec #416 stories 4, 5, 10–12, 69;
// amends ADR 0006 decision 7): a PDF no Source names is a row, and the row's
// one write sets `pdf:`, flips `kind` and mints `id:` — nothing else moves.

const PDF = "%PDF-1.4 a paper\n";
const STUB = `---
kind: source-stub
citekey: rasch2013
title: Odor cues during slow-wave sleep
year: 2013
---
`;
const RQ = `---
id: rq-1
kind: research-question
question: "Is it consolidation?"
status: open
context: other
---

## Working answer

## Supporting sources
- [[rasch2013]]

## Opposing sources

## Related questions

## Open threads

## Position history
`;

async function opened(files: Record<string, string>) {
  const vault = await vaultWith(files);
  const c = await core({ settleMs: 40, newId: () => "src-minted-1" });
  const reply = await c.mutate("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  const rows = async () => {
    const r = await c.query<LooseEnds>("looseEnds.rows");
    expect(r.error).toBeUndefined();
    return r.result!.data;
  };
  const attach = (pdf: string, stub: string) =>
    c.mutate<{ path: string; id: string }>("sources.attachToStub", {
      pdf,
      stub,
    });
  return { vault, c, rows, attach };
}

describe("the no-Source row", () => {
  it("lists a PDF that no Source names, under Unfinished reading, and counts it", async () => {
    const { rows } = await opened({
      "sources/pdf/mystery.pdf": PDF,
      "sources/pdf/named.pdf": PDF,
      "sources/rasch2013.md":
        "---\nkind: source\ncitekey: rasch2013\npdf: named.pdf\n---\n",
    });
    const ends = await rows();
    expect(ends.groups).toEqual([
      {
        group: "Unfinished reading",
        rows: [
          {
            kind: "no-source",
            subject: "sources/pdf/mystery.pdf",
            path: "sources/pdf/mystery.pdf",
            title: "mystery.pdf",
          },
        ],
      },
    ]);
  });

  it("reads a name as the picker does — case-insensitively, and a stub's counts too", async () => {
    const { rows } = await opened({
      "sources/pdf/Named.PDF": PDF,
      "sources/pdf/sub/deep.pdf": PDF,
      "sources/a.md":
        "---\nkind: source-stub\ncitekey: a\npdf: named.pdf\n---\n",
      "sources/b.md": "---\nkind: source\ncitekey: b\npdf: sub/deep.pdf\n---\n",
    });
    expect((await rows()).groups).toEqual([]);
  });

  it("shows no group when every PDF is named", async () => {
    const { rows } = await opened({ "questions/x.md": "# x\n" });
    expect((await rows()).groups).toEqual([]);
  });

  it("never lists an evicted PDF: its bytes are not on disk, so it is not judged", async () => {
    const vault = await vaultWith({ "sources/pdf/keep.pdf": PDF });
    // Sparse: a size and no blocks, which is what a sync client's
    // online-only file looks like to `stat`.
    const handle = await open(join(vault, "sources/pdf/online-only.pdf"), "w");
    await handle.truncate(4 * 1024 * 1024);
    await handle.close();
    const c = await core();
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    const reply = await c.query<LooseEnds>("looseEnds.rows");
    const titles = reply.result!.data.groups.flatMap((g) =>
      g.rows.map((r) => r.title)
    );
    expect(titles).toEqual(["keep.pdf"]);
  });

  it("is silenced for good by mark deliberate, and comes back on undo", async () => {
    const { c, rows } = await opened({ "sources/pdf/mystery.pdf": PDF });
    const key = { subject: "sources/pdf/mystery.pdf", kind: "no-source" };
    expect((await c.mutate("looseEnds.dismiss", key)).error).toBeUndefined();
    expect((await rows()).groups).toEqual([]);
    expect((await c.mutate("looseEnds.undismiss", key)).error).toBeUndefined();
    expect((await rows()).groups).toHaveLength(1);
  });
});

describe("sources.attachToStub", () => {
  it("sets pdf, flips kind and mints an id in one write, leaving every other byte", async () => {
    const { vault, c, attach } = await opened({
      "sources/pdf/Rasch 2013 (final).pdf": PDF,
      "sources/rasch2013.md": STUB,
      "questions/x (RQ).md": RQ,
    });
    const reply = await attach(
      "sources/pdf/Rasch 2013 (final).pdf",
      "sources/rasch2013.md"
    );
    expect(reply.error).toBeUndefined();
    expect(reply.result!.data).toEqual({
      path: "sources/rasch2013.md",
      id: "src-minted-1",
    });
    const text = await readFile(join(vault, "sources/rasch2013.md"), "utf8");
    expect(text).toBe(`---
kind: source
citekey: rasch2013
title: Odor cues during slow-wave sleep
year: 2013
pdf: Rasch 2013 (final).pdf
id: src-minted-1
---
`);
    await c.indexed();
  });

  it("keeps a Research Question that cites the stub resolving it, and the row goes", async () => {
    const { c, rows, attach } = await opened({
      "sources/pdf/r.pdf": PDF,
      "sources/rasch2013.md": STUB,
      "questions/x (RQ).md": RQ,
    });
    expect((await rows()).groups).toHaveLength(1);
    expect(
      (await attach("sources/pdf/r.pdf", "sources/rasch2013.md")).error
    ).toBeUndefined();
    const outline = await c.query<OutlineResponse>("vault.outline", {
      path: "questions/x (RQ).md",
    });
    const found = outline.result!.data;
    if (!found.readable) throw new Error("unreadable");
    expect(
      (
        found.outline.links as unknown as Array<{ resolvedPath: string | null }>
      ).map((l) => l.resolvedPath)
    ).toEqual(["sources/rasch2013.md"]);
    expect((await rows()).groups).toEqual([]);
  });

  it("makes the stub answer as a Source with a PDF, wherever kind is read", async () => {
    const { c, attach } = await opened({
      "sources/pdf/r.pdf": PDF,
      "sources/rasch2013.md": STUB,
    });
    await attach("sources/pdf/r.pdf", "sources/rasch2013.md");
    const reply = await c.query<Candidates>("picker.candidates", {
      query: "rasch",
      kinds: ["source"],
    });
    expect(reply.result!.data.rows).toEqual([
      {
        path: "sources/rasch2013.md",
        name: "rasch2013",
        kind: "source",
        title: "Odor cues during slow-wave sleep",
        pdf: true,
      },
    ]);
  });

  it("never renames, moves or copies the PDF", async () => {
    const { vault, attach } = await opened({
      "sources/pdf/r.pdf": PDF,
      "sources/rasch2013.md": STUB,
    });
    await attach("sources/pdf/r.pdf", "sources/rasch2013.md");
    expect(await readdir(join(vault, "sources/pdf"))).toEqual(["r.pdf"]);
    expect(await readFile(join(vault, "sources/pdf/r.pdf"), "utf8")).toBe(PDF);
  });

  it("writes a nested PDF's name relative to the PDF folder", async () => {
    const { vault, attach } = await opened({
      "sources/pdf/2013/r.pdf": PDF,
      "sources/rasch2013.md": STUB,
    });
    await attach("sources/pdf/2013/r.pdf", "sources/rasch2013.md");
    expect(
      await readFile(join(vault, "sources/rasch2013.md"), "utf8")
    ).toContain("pdf: 2013/r.pdf\n");
  });

  it.each([
    [
      "something that is already a Source",
      {
        "sources/s.md":
          "---\nkind: source\ncitekey: s\npdf: other.pdf\nid: x\n---\n",
      },
      "sources/s.md",
      "sources/pdf/r.pdf",
      /not a source stub/,
    ],
    [
      "a Note",
      { "sources/n.md": "# n\n" },
      "sources/n.md",
      "sources/pdf/r.pdf",
      /not a source stub/,
    ],
    [
      "a PDF some Source already names",
      {
        "sources/rasch2013.md": STUB,
        "sources/s.md":
          "---\nkind: source\ncitekey: s\npdf: r.pdf\nid: x\n---\n",
      },
      "sources/rasch2013.md",
      "sources/pdf/r.pdf",
      /already names/,
    ],
    [
      "a file that is not a PDF in the PDF folder",
      { "sources/rasch2013.md": STUB, "notes/a.pdf": PDF },
      "sources/rasch2013.md",
      "notes/a.pdf",
      /PDF folder/,
    ],
    [
      "a PDF that is not there",
      { "sources/rasch2013.md": STUB },
      "sources/rasch2013.md",
      "sources/pdf/gone.pdf",
      /no PDF/,
    ],
  ])("refuses %s, and writes nothing", async (_name, files, stub, pdf, why) => {
    const { vault, c, attach } = await opened({
      "sources/pdf/r.pdf": PDF,
      ...files,
    });
    const before = await readFile(join(vault, stub), "utf8");
    const reply = await attach(pdf, stub);
    expect(reply.error?.message).toMatch(why);
    expect(await readFile(join(vault, stub), "utf8")).toBe(before);
    await c.indexed();
  });

  it("gives a stub with no PDF no id and no sidecar", async () => {
    const { vault } = await opened({ "sources/rasch2013.md": STUB });
    expect(
      await readFile(join(vault, "sources/rasch2013.md"), "utf8")
    ).not.toMatch(/^id:/m);
    await expect(
      stat(join(vault, "sources/rasch2013.pdf"))
    ).rejects.toBeDefined();
  });
});

describe("a PDF renamed in Finder", () => {
  it("is followed: pdf: takes the new name and no row appears", async () => {
    const { vault, rows } = await opened({
      "sources/pdf/old name.pdf": PDF,
      "sources/rasch2013.md":
        "---\nkind: source\ncitekey: rasch2013\npdf: old name.pdf\nid: s1\n---\n",
    });
    await rename(
      join(vault, "sources/pdf/old name.pdf"),
      join(vault, "sources/pdf/Rasch 2013.pdf")
    );
    await vi.waitFor(
      async () =>
        expect(
          await readFile(join(vault, "sources/rasch2013.md"), "utf8")
        ).toContain("pdf: Rasch 2013.pdf\n"),
      { timeout: 4000 }
    );
    expect((await rows()).groups).toEqual([]);
  });

  it("moves a dismissal with it, since the row is keyed by the path", async () => {
    const { vault, c, rows } = await opened({ "sources/pdf/a.pdf": PDF });
    await c.mutate("looseEnds.dismiss", {
      subject: "sources/pdf/a.pdf",
      kind: "no-source",
    });
    await rename(
      join(vault, "sources/pdf/a.pdf"),
      join(vault, "sources/pdf/b.pdf")
    );
    await vi.waitFor(
      async () =>
        expect(
          await readFile(join(vault, ".vitrine/dismissals.json"), "utf8")
        ).toContain("b.pdf"),
      { timeout: 4000 }
    );
    expect((await rows()).groups).toEqual([]);
  });
});

describe("a rename paired before the Source is read", () => {
  // The sweep's first chunk can pair a rename (the PDF moved while the app
  // was closed) before the Source that names it has been indexed; acting
  // then would follow nothing and forget it had to.
  it("still rewrites pdf: once the opening sweep is done", async () => {
    const vault = await vaultWith({ "sources/pdf/old.pdf": PDF });
    const first = await core({ settleMs: 40 });
    await first.mutate("vault.open", { path: vault });
    await first.indexed();
    await first.close();
    // While the app is closed: the PDF is renamed, and a Source that named
    // it by its old name arrives (a sync client delivering both).
    await rename(
      join(vault, "sources/pdf/old.pdf"),
      join(vault, "sources/pdf/new.pdf")
    );
    await writeFile(
      join(vault, "sources/rasch2013.md"),
      "---\nkind: source\ncitekey: rasch2013\npdf: old.pdf\nid: s1\n---\n"
    );

    // A chunk of one file puts the rename in the first chunk and the Source
    // in the second, so acting on the first chunk's status would find no
    // paper naming the old file.
    const c = await core({ settleMs: 40, chunkSize: 1 });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    await vi.waitFor(
      async () =>
        expect(
          await readFile(join(vault, "sources/rasch2013.md"), "utf8")
        ).toContain("pdf: new.pdf\n"),
      { timeout: 4000 }
    );
  });
});
