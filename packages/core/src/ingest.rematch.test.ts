import { createHash } from "node:crypto";
import { watch as fsWatch, type WatchListener } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeCores,
  core,
  fixtures,
  tmp,
  vaultWith,
  type CoreOptions,
} from "./test-core.js";

afterEach(closeCores);

// Re-matching, end to end (#420; spec #416 stories 34–44, 112, 115): a PDF that
// Preview re-saved, edited or replaced returns, and what the researcher can
// observe — the blocks in the Source's note, the sidecar, the footer line's
// counts, the document-changed event — says which identity found which
// annotation. `annotation-matcher.test.ts` proves the same tiers on their
// own; a threshold or tier order that changes fails there and here.

const pdf = (name: string) => readFile(join(fixtures, "pdf", name));
const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

const SOURCE = `---
kind: source
id: src-1
citekey: rasch2013
title: Odor cues during slow-wave sleep
pdf: rasch2013.pdf
---
Notes I typed.
`;

type Entry = {
  id: string;
  block?: string;
  kind: string;
  page: number;
  quads: number[][];
  quote: string;
  matched_by?: string;
  previous_quote?: string;
  changed_at?: string;
  removed_at?: string;
  unmatched_since?: string;
  document_changed_at?: string;
};
type Sidecar = {
  file: { hash: string };
  next_block: number;
  annotations: Entry[];
  held?: Array<{ quote: string; page: number }>;
};

/** A link from a Note to a block, and a Question that names one. */
const LINK = { "notes/plan.md": "See [[rasch2013#^h2]] for the effect.\n" };
const QUESTION = {
  "questions/why.md":
    "---\nkind: question\nid: q-1\nquestion: Why?\nstatus: open\ncaptured: 2026-09-29T10:00:00Z\nfrom: '[[rasch2013]]'\nannotation: h2\ncontext: reading\n---\n",
};

async function opened(
  extra: Record<string, string> = {},
  options: CoreOptions = {}
) {
  const vault = await vaultWith({
    "sources/rasch2013.md": SOURCE,
    "sources/pdf/rasch2013.pdf": "",
    ...extra,
  });
  await writeFile(
    join(vault, "sources/pdf/rasch2013.pdf"),
    await pdf("synthetic-body.pdf")
  );
  const c = await core({ settleMs: 40, ...options });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const events = await c.events();
  const source = () => readFile(join(vault, "sources/rasch2013.md"), "utf8");
  const sidecar = async () =>
    JSON.parse(
      await readFile(join(vault, ".vitrine/annotations/src-1.json"), "utf8")
    ) as Sidecar;
  /**
   * Put a PDF where Preview would and wait for the run it makes to finish —
   * which a clean run does not announce, so what is waited on is the sidecar
   * saying it has read exactly these bytes.
   */
  const returned = async (name: string) => {
    const bytes = await pdf(name);
    await writeFile(join(vault, "sources/pdf/rasch2013.pdf"), bytes);
    await vi.waitFor(
      async () => {
        expect((await sidecar()).file.hash).toBe(sha256(bytes));
      },
      { timeout: 4000, interval: 25 }
    );
    return sidecar();
  };
  /** The first return: its own footer line is drained, so a later wait is for a later run. */
  const first = async (name: string) => {
    const landed = events.next("ingestLanded");
    const stored = await returned(name);
    await landed;
    return stored;
  };
  const byBlock = (s: Sidecar, block: string) =>
    s.annotations.find((a) => a.block === block)!;
  /** Nothing of this kind arrives, and has not. */
  const never = (type: "documentChanged" | "ingestLanded") =>
    expect(events.next(type, { timeoutMs: 300 })).rejects.toThrow();
  return {
    vault,
    c,
    events,
    source,
    sidecar,
    returned,
    first,
    byBlock,
    never,
  };
}

describe("a PDF Preview re-saved", () => {
  it("keeps every identity and every block, and says nothing", async () => {
    const t = await opened();
    const firstRun = await t.first("annotated.pdf");
    const note = await t.source();
    const again = await t.returned("resaved.pdf");
    expect(await t.source()).toBe(note);
    expect(again.annotations.map((a) => [a.id, a.block])).toEqual(
      firstRun.annotations.map((a) => [a.id, a.block])
    );
    expect(again.next_block).toBe(firstRun.next_block);
    // Text finds what has text; the stroke has only its box.
    expect(again.annotations.map((a) => a.matched_by).sort()).toEqual([
      "geometry",
      "geometry",
      "text",
      "text",
      "text",
      "text",
    ]);
  });

  it("does not take a save for a replaced document", async () => {
    const t = await opened();
    await t.returned("annotated.pdf");
    // The save replaced the file's id; the words on every page are the same.
    await t.returned("resaved.pdf");
    await t.never("documentChanged");
  });
});

describe("an annotation edited in Preview", () => {
  it("is found by its text when nudged, quads as Preview now has them", async () => {
    const t = await opened();
    const firstRun = await t.first("annotated.pdf");
    const after = await t.returned("annotated-nudged.pdf");
    const kept = t.byBlock(after, "h1");
    expect(kept.id).toBe(t.byBlock(firstRun, "h1").id);
    expect(kept.matched_by).toBe("text");
    expect(kept.quads[0]![0]).toBeCloseTo(73.5, 1);
    expect(kept.previous_quote).toBeUndefined();
  });

  it.each([
    [
      "extended",
      "annotated-extended.pdf",
      "Participants who heard the odor cue recalled more",
    ],
    ["trimmed", "annotated-trimmed.pdf", "Participants who heard the"],
  ])(
    "is found by geometry when %s, and the earlier quote is kept one level back",
    async (_, file, quote) => {
      const t = await opened();
      const firstRun = await t.first("annotated.pdf");
      const after = await t.returned(file);
      const kept = t.byBlock(after, "h1");
      expect(kept.id).toBe(t.byBlock(firstRun, "h1").id);
      expect(kept).toMatchObject({
        matched_by: "geometry",
        quote,
        previous_quote: "Participants who heard the odor cue",
      });
      expect(kept.changed_at).toBeDefined();
      expect(await t.source()).toContain(`"${quote}" ^h1`);
      expect(after.annotations.filter((a) => a.removed_at)).toEqual([]);
    }
  );

  it("is found by geometry while it keeps 0.4 of its box, and is a different highlight below that", async () => {
    // Measured on these files: half the words keep 0.46 of the box, one word
    // 0.33. The threshold sits between; where it moves, one of these changes.
    const halved = await opened();
    const before = await halved.first("annotated.pdf");
    const kept = halved.byBlock(
      await halved.returned("annotated-halved.pdf"),
      "h1"
    );
    expect(kept).toMatchObject({
      id: halved.byBlock(before, "h1").id,
      matched_by: "geometry",
      quote: "Participants who",
    });

    const sliver = await opened();
    await sliver.first("annotated.pdf");
    const after = await sliver.returned("annotated-sliver.pdf");
    expect(sliver.byBlock(after, "h1").removed_at).toBeDefined();
    expect(sliver.byBlock(after, "h5")).toMatchObject({
      quote: "Participants",
    });
  });

  it("is found by its text when its line moved: the highlight follows the words", async () => {
    const t = await opened();
    const firstRun = await t.first("annotated.pdf");
    const landed = t.events.next("ingestLanded");
    const after = await t.returned("annotated-shifted.pdf");
    for (const block of ["h1", "h2", "h4"]) {
      expect(byId(after, t.byBlock(firstRun, block).id)).toMatchObject({
        block,
        matched_by: "text",
      });
    }
    expect(t.byBlock(after, "h1").quads[0]![1]).toBeCloseTo(673.2, 1);
    // What the shifted file no longer holds — the note, the stroke, the stamp —
    // nothing linked to, so it is only counted.
    expect((await landed).summary).toEqual({
      new: 0,
      questions: 0,
      removed: 3,
      unmatched: 0,
    });
    await t.never("documentChanged");
  });

  it("is found again on another page when a re-export moved it, under one document-changed event", async () => {
    const t = await opened(LINK);
    const firstRun = await t.first("annotated.pdf");
    const changed = t.events.next("documentChanged");
    const after = await t.returned("annotated-swapped.pdf");
    expect(await changed).toMatchObject({ source: "sources/rasch2013.md" });
    expect(byId(after, t.byBlock(firstRun, "h1").id)).toMatchObject({
      matched_by: "text-moved",
      page: 1,
    });
    expect(byId(after, t.byBlock(firstRun, "h4").id)).toMatchObject({
      matched_by: "text-moved",
      page: 0,
    });
    await t.never("documentChanged");
  });
});

describe("two identical short highlights on one page", () => {
  it("stay two identities when both survive: geometry tells them apart", async () => {
    const t = await opened();
    const firstRun = await t.first("twins.pdf");
    const after = await t.returned("twins-resaved.pdf");
    expect(after.annotations.map((a) => [a.id, a.block, a.matched_by])).toEqual(
      firstRun.annotations.map((a) => [a.id, a.block, "text"])
    );
    expect(
      after.annotations.every((a) => a.unmatched_since === undefined)
    ).toBe(true);
  });

  it("are Unmatched, and their candidates held and not new, when nothing can break the tie", async () => {
    const t = await opened();
    await t.first("twins.pdf");
    const landed = t.events.next("ingestLanded");
    // Both highlights now sit on the two *other* identical lines: each old
    // identity's text is on both, its geometry on neither.
    const after = await t.returned("twins-moved.pdf");
    expect((await landed).summary).toEqual({
      new: 0,
      questions: 0,
      removed: 0,
      unmatched: 2,
    });
    expect(
      after.annotations.map((a) => a.unmatched_since !== undefined)
    ).toEqual([true, true]);
    expect(after.held).toHaveLength(2);
    expect(after.annotations).toHaveLength(2);
    expect(await t.source()).toMatch(
      /"Twin sentence here\." \(unmatched\) \^h1/
    );
    expect(await t.source()).toMatch(
      /"Twin sentence here\." \(unmatched\) \^h2/
    );
  });
});

describe("an annotation deleted in Preview", () => {
  it("is removed when nothing linked to it: its block leaves, its number is never reused, the summary counts it", async () => {
    const t = await opened();
    await t.first("annotated.pdf");
    const landed = t.events.next("ingestLanded");
    const after = await t.returned("annotated-fewer.pdf");
    expect((await landed).summary).toMatchObject({ removed: 1, unmatched: 0 });
    expect(await t.source()).not.toContain("^h2");
    expect(t.byBlock(after, "h2").removed_at).toBeDefined();
    // The same highlight put back is a new one, on the next number.
    const again = await t.returned("annotated.pdf");
    expect(again.next_block).toBe(6);
    expect(await t.source()).toContain(
      '"difference was reliable across the downstream analyses" ^h5'
    );
    expect(await t.source()).not.toMatch(/\^h2\b/);
  });

  it.each([
    ["a note links to its block", LINK],
    ["a Question names its block in its provenance", QUESTION],
  ])(
    "is Unmatched, its block reading (unmatched), when %s",
    async (_, links) => {
      const t = await opened(links);
      await t.first("annotated.pdf");
      const landed = t.events.next("ingestLanded");
      const after = await t.returned("annotated-fewer.pdf");
      expect((await landed).summary).toMatchObject({
        removed: 0,
        unmatched: 1,
      });
      expect(t.byBlock(after, "h2").unmatched_since).toBeDefined();
      expect(t.byBlock(after, "h2").removed_at).toBeUndefined();
      expect(await t.source()).toContain(
        '"difference was reliable across the downstream analyses" (unmatched) ^h2'
      );
    }
  );

  it("is Unmatched while its Source's Ingest cannot show nothing links to it", async () => {
    const t = await opened();
    await t.returned("annotated.pdf");
    await t.c.close();
    // Reopened with a watch nothing is heard from: the index is not current,
    // so the open-time Ingest cannot conclude the highlight was unlinked.
    const elsewhere = await tmp("unheard");
    const deaf = ((
      _folder: string,
      options: { recursive: boolean },
      listener: WatchListener<string>
    ) => fsWatch(elsewhere, options, listener)) as typeof fsWatch;
    const bytes = await pdf("annotated-fewer.pdf");
    await writeFile(join(t.vault, "sources/pdf/rasch2013.pdf"), bytes);
    const c = await core({
      settleMs: 40,
      watch: deaf,
      probeTimeoutMs: 200,
    });
    await c.mutate("vault.open", { path: t.vault });
    const read = async () =>
      JSON.parse(
        await readFile(join(t.vault, ".vitrine/annotations/src-1.json"), "utf8")
      ) as Sidecar;
    await vi.waitFor(async () => {
      expect((await read()).file.hash).toBe(sha256(bytes));
    });
    const stored = await read();
    expect(stored.annotations.find((a) => a.block === "h2")).toMatchObject({
      unmatched_since: expect.any(String) as string,
    });
    expect(stored.annotations.filter((a) => a.removed_at)).toEqual([]);
  });
});

describe("a document replaced", () => {
  it("raises one event, and its Unmatched annotations are grouped under it", async () => {
    const t = await opened({ ...LINK, ...QUESTION });
    const firstRun = await t.first("annotated.pdf");
    const changed = t.events.next("documentChanged");
    const landed = t.events.next("ingestLanded");
    const after = await t.returned("replaced.pdf");
    expect(await changed).toMatchObject({ source: "sources/rasch2013.md" });
    await t.never("documentChanged");
    const grouped = after.annotations.filter((a) => a.document_changed_at);
    // Only h2 is linked to; the other five are gone and nothing said so.
    expect(grouped.map((a) => a.block)).toEqual(["h2"]);
    expect(new Set(grouped.map((a) => a.document_changed_at)).size).toBe(1);
    expect((await landed).summary).toEqual({
      new: 2,
      questions: 0,
      removed: 5,
      unmatched: 1,
    });
    expect(t.byBlock(after, "h2").id).toBe(t.byBlock(firstRun, "h2").id);
  });
});

function byId(s: Sidecar, id: string) {
  return s.annotations.find((a) => a.id === id)!;
}
