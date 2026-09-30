import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Highlighted } from "./ingest.js";
import { createPdfEngine } from "./pdf-engine.js";
import { readSidecar } from "./annotation-sidecar.js";
import { closeCores, core, fixtures, vaultWith } from "./test-core.js";

afterEach(closeCores);

// Highlighting from the Reader (#426; spec #416 stories 90–96, 110, 113–114):
// the window sends where and what colour, and the core decides the rest — the
// characters, the quote, what is written into the PDF, the identity and the
// block — and never leaves a half-written file.

const SOURCE = `---
kind: source
id: src-1
citekey: rasch2013
title: Odor cues during slow-wave sleep
pdf: rasch2013.pdf
---
Notes I typed.
`;
const NAME = "Sarah Lehman";
const PDF = "sources/pdf/rasch2013.pdf";

const fixture = (name: string) => readFile(join(fixtures, "pdf", name));
const engine = createPdfEngine();
afterEach(() => engine.close());

/** The second line of page 1 of the fixture body, whole. */
const LINE_TWO = [60, 678, 560, 696];
const LINE_TWO_TEXT =
  "Participants who heard the odor cue recalled more of the invented word pairs";

async function opened(bytes = "synthetic-body.pdf") {
  const vault = await vaultWith({
    "sources/rasch2013.md": SOURCE,
    [PDF]: "",
  });
  await writeFile(join(vault, PDF), await fixture(bytes));
  const c = await core({ settleMs: 40, author: NAME });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const events = await c.events();
  // Only a PDF that arrives annotated has a run to wait for.
  if (bytes !== "synthetic-body.pdf") await events.next("ingestLanded");
  const highlight = (input: {
    page?: number;
    rects?: number[][];
    colour?: string;
    note?: string;
  }) =>
    c.mutate<Highlighted>("sources.highlight", {
      path: "sources/rasch2013.md",
      page: 1,
      rects: [LINE_TWO],
      colour: "green",
      ...input,
    });
  const onDisk = async () => new Uint8Array(await readFile(join(vault, PDF)));
  return { vault, c, highlight, onDisk };
}

describe("sources.highlight", () => {
  it("writes a standard annotation with the user's name, the note, a colour and an appearance, and a block in the note", async () => {
    const { vault, highlight, onDisk } = await opened();
    const reply = await highlight({
      note: "Compare with the 2014 replication",
    });
    expect(reply.error).toBeUndefined();
    expect(reply.result!.data).toMatchObject({
      block: "h1",
      quote: LINE_TWO_TEXT,
    });

    const read = await engine.annotations(await onDisk());
    expect(read.annotations).toHaveLength(1);
    const [mark] = read.annotations;
    expect(mark).toMatchObject({
      kind: "highlight",
      page: 0,
      quote: LINE_TWO_TEXT,
      note: "Compare with the 2014 replication",
      author: NAME,
      hasAppearance: true,
      nm: reply.result!.data.id,
      color: [126, 217, 87],
    });

    const note = await readFile(join(vault, "sources/rasch2013.md"), "utf8");
    expect(note).toContain(`- p.1 · "${LINE_TWO_TEXT}" ^h1`);
    expect(note).toContain("Compare with the 2014 replication");
    expect(note.startsWith(SOURCE.split("Notes")[0]!)).toBe(true);
  });

  it("puts nothing of the app's in /Contents: the note as typed, and empty when there is none", async () => {
    const { highlight, onDisk } = await opened();
    await highlight({});
    const [mark] = (await engine.annotations(await onDisk())).annotations;
    expect(mark!.note).toBe("");
  });

  it("derives the quote from the PDF's characters and snaps the quads to the text, not to the drag", async () => {
    const { highlight, vault } = await opened();
    // A sloppy drag: only the middle of the line, starting mid-glyph and
    // ending in the margin below.
    const reply = await highlight({ rects: [[150, 675, 260, 690]] });
    const { quote } = reply.result!.data;
    expect(quote).not.toBe("");
    expect(LINE_TWO_TEXT).toContain(quote);
    const sidecar = await readSidecar(vault, "src-1");
    const [entry] = sidecar!.annotations;
    // One quad, and the line's own height rather than the drag's.
    expect(entry!.quads).toHaveLength(1);
    const ys = entry!.quads[0]!.filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(12);
    expect(entry!.quote).toBe(quote);
  });

  it("makes one quad per line for a selection across lines, and joins a hyphenated break", async () => {
    const { highlight, vault } = await opened();
    const reply = await highlight({ rects: [[60, 640, 560, 700]] });
    expect(reply.result!.data.quote).toContain("downstream analyses");
    const sidecar = await readSidecar(vault, "src-1");
    expect(sidecar!.annotations[0]!.quads.length).toBeGreaterThan(1);
  });

  it("refuses a selection with no text under it in plain words, and writes nothing", async () => {
    const { highlight, onDisk, vault } = await opened();
    const before = await onDisk();
    const reply = await highlight({ rects: [[60, 100, 560, 200]] });
    expect(reply.error?.message).toMatch(/no text under that selection/);
    expect(reply.error?.message).toMatch(/scanned/);
    expect(await onDisk()).toEqual(before);
    const note = await readFile(join(vault, "sources/rasch2013.md"), "utf8");
    expect(note).not.toContain("^h");
  });

  it("leaves the original bytes untouched when the write fails", async () => {
    const { highlight, onDisk, vault } = await opened();
    const before = await onDisk();
    // A folder that cannot take the temporary file: the write fails after the
    // engine has produced the new bytes.
    await chmod(join(vault, "sources/pdf"), 0o555);
    try {
      const reply = await highlight({});
      expect(reply.error).toBeDefined();
    } finally {
      await chmod(join(vault, "sources/pdf"), 0o755);
    }
    expect(await onDisk()).toEqual(before);
  });

  it("is matched by the next Ingest through its identity, and is not counted as new", async () => {
    const { highlight, onDisk, vault } = await opened();
    const reply = await highlight({ note: "kept" });
    const before = await readSidecar(vault, "src-1");
    // The PDF is saved again with the same content (a sync client's rewrite):
    // different bytes, so Ingest reads it.
    await writeFile(
      join(vault, PDF),
      Buffer.concat([Buffer.from(await onDisk()), Buffer.from("\n%touched\n")])
    );
    await vi.waitFor(async () => {
      const after = await readSidecar(vault, "src-1");
      expect(after!.file.hash).not.toBe(before!.file.hash);
    });
    const after = await readSidecar(vault, "src-1");
    expect(after!.annotations).toHaveLength(1);
    expect(after!.annotations[0]).toMatchObject({
      id: reply.result!.data.id,
      block: "h1",
      matched_by: "object",
    });
  });

  it("numbers the next highlight's block after the ones already there", async () => {
    const { highlight } = await opened("annotated.pdf");
    const first = await highlight({});
    expect(first.result!.data.block).toBe("h5");
    const second = await highlight({ rects: [[60, 660, 560, 678]] });
    expect(second.result!.data.block).toBe("h6");
  });

  it("keeps every annotation a PDFKit save left, and reopens cleanly after the write", async () => {
    const { highlight, onDisk } = await opened("annotated.pdf");
    const before = await engine.annotations(await fixture("annotated.pdf"));
    await highlight({ note: "mine" });
    const after = await engine.annotations(await onDisk());
    expect(after.annotations).toHaveLength(before.annotations.length + 1);
    const key = (a: { kind: string; page: number; quote: string }) =>
      `${a.kind}/${a.page}/${a.quote}`;
    for (const a of before.annotations) {
      expect(after.annotations.map(key)).toContain(key(a));
    }
    // A full rewrite keeps the document's own id (ADR 0007 decision 12).
    expect(after.fileId).toBe(before.fileId);
    expect(after.pageText).toEqual(before.pageText);
  });

  it("says so when the Source names no PDF the vault holds", async () => {
    const { c } = await opened();
    const reply = await c.mutate("sources.highlight", {
      path: "sources/missing.md",
      page: 1,
      rects: [LINE_TWO],
      colour: "green",
    });
    expect(reply.error).toBeDefined();
  });
});
