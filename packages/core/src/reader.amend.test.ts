import { watch as fsWatch, type WatchListener } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Highlighted } from "./ingest.js";
import { createPdfEngine } from "./pdf-engine.js";
import { readSidecar } from "./annotation-sidecar.js";
import { closeCores, core, fixtures, tmp, vaultWith } from "./test-core.js";

afterEach(closeCores);

// Recolour, re-note and remove an annotation the researcher made (#428; spec
// #416 stories 104–109). What is observed is the PDF's own annotation, the
// Source's note, the sidecar, the Loose Ends rows at the next Ingest and the
// footer line's counts — never which function ran.

const SOURCE = `---
kind: source
id: src-1
citekey: rasch2013
title: Odor cues during slow-wave sleep
pdf: rasch2013.pdf
---
Notes I typed.
`;
const PDF = "sources/pdf/rasch2013.pdf";
const LINK = { "notes/plan.md": "See [[rasch2013#^h1]] for the effect.\n" };
const LINE_ONE = [60, 696, 560, 714];
const LINE_TWO = [60, 678, 560, 696];

const engine = createPdfEngine();
afterEach(() => engine.close());

type Removal =
  | { outcome: "confirm"; links: Array<{ path: string; title: string }> }
  | { outcome: "gone" | "removed"; block: string };

async function opened(extra: Record<string, string> = {}) {
  const vault = await vaultWith({
    "sources/rasch2013.md": SOURCE,
    [PDF]: "",
    ...extra,
  });
  await writeFile(
    join(vault, PDF),
    await readFile(join(fixtures, "pdf", "synthetic-body.pdf"))
  );
  const c = await core({ settleMs: 40, author: "Sarah Lehman" });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const events = await c.events();
  const highlight = (rects: number[][], note = "") =>
    c.mutate<Highlighted>("sources.highlight", {
      path: "sources/rasch2013.md",
      page: 1,
      rects,
      colour: "green",
      note,
    });
  const edit = (proc: string, annotation: string, extra: object) =>
    c.mutate(`sources.${proc}`, {
      path: "sources/rasch2013.md",
      annotation,
      ...extra,
    });
  const remove = (annotation: string, confirmed = false) =>
    c.mutate<Removal>("sources.removeAnnotation", {
      path: "sources/rasch2013.md",
      annotation,
      confirmed,
    });
  const marks = async () =>
    (await engine.annotations(new Uint8Array(await readFile(join(vault, PDF)))))
      .annotations;
  const note = () => readFile(join(vault, "sources/rasch2013.md"), "utf8");
  return { vault, c, events, highlight, edit, remove, marks, note };
}

describe("recolouring and re-noting", () => {
  it("rewrites the annotation with the new colour and a regenerated appearance, keeping its identity and block", async () => {
    const t = await opened();
    const made = (await t.highlight([LINE_TWO], "first thought")).result!.data;
    const reply = await t.edit("amend", made.id, { colour: "pink" });
    expect(reply.error).toBeUndefined();
    const [mark] = await t.marks();
    expect(mark).toMatchObject({
      color: [255, 128, 187],
      hasAppearance: true,
      nm: made.id,
      note: "first thought",
    });
    const sidecar = await readSidecar(t.vault, "src-1");
    expect(sidecar!.annotations).toHaveLength(1);
    expect(sidecar!.annotations[0]).toMatchObject({
      id: made.id,
      block: made.block,
      color: [255, 128, 187],
    });
  });

  it("changes the note in the PDF and in the block beneath the quote", async () => {
    const t = await opened();
    const made = (await t.highlight([LINE_TWO], "first thought")).result!.data;
    expect(
      (await t.edit("amend", made.id, { note: "second thought" })).error
    ).toBeUndefined();
    expect((await t.marks())[0]!.note).toBe("second thought");
    const note = await t.note();
    expect(note).toContain("second thought");
    expect(note).not.toContain("first thought");
    expect(note).toContain(`^${made.block}`);
  });

  it("clears the note when it is emptied", async () => {
    const t = await opened();
    const made = (await t.highlight([LINE_TWO], "gone soon")).result!.data;
    await t.edit("amend", made.id, { note: "" });
    expect((await t.marks())[0]!.note).toBe("");
    expect(await t.note()).not.toContain("gone soon");
  });

  it("is re-matched by the next Ingest on a fast tier, not made Unmatched or new", async () => {
    const t = await opened();
    const made = (await t.highlight([LINE_TWO])).result!.data;
    await t.edit("amend", made.id, { colour: "blue" });
    const landed = t.events
      .next("ingestLanded", { timeoutMs: 500 })
      .catch(() => null);
    const bytes = await readFile(join(t.vault, PDF));
    await writeFile(
      join(t.vault, PDF),
      Buffer.concat([bytes, Buffer.from("\n%touched\n")])
    );
    expect(await landed).toBeNull();
    const sidecar = await readSidecar(t.vault, "src-1");
    expect(sidecar!.annotations).toHaveLength(1);
    expect(sidecar!.annotations[0]).toMatchObject({
      id: made.id,
      matched_by: "object",
    });
    expect(sidecar!.annotations[0]!.unmatched_since).toBeUndefined();
  });

  it("refuses an annotation that is not a live highlight of that Source", async () => {
    const t = await opened();
    const reply = await t.edit("amend", "no-such-id", { colour: "blue" });
    expect(reply.error?.message).toMatch(/no longer|not one of/i);
  });

  it("leaves the original untouched when the write fails", async () => {
    const t = await opened();
    const made = (await t.highlight([LINE_TWO], "keep")).result!.data;
    const before = await readFile(join(t.vault, PDF));
    await chmod(join(t.vault, "sources/pdf"), 0o555);
    try {
      expect(
        (await t.edit("amend", made.id, { colour: "blue" })).error
      ).toBeDefined();
    } finally {
      await chmod(join(t.vault, "sources/pdf"), 0o755);
    }
    expect(await readFile(join(t.vault, PDF))).toEqual(before);
  });
});

describe("re-noting a Q: note", () => {
  const questions = async (c: {
    query: <T>(p: string) => Promise<{ result?: { data: T } }>;
  }) =>
    (await c.query<{ questions: unknown[] }>("questions.list")).result!.data
      .questions;

  it("spawns a Question once when a note becomes Q:, and not again when it is edited or emptied", async () => {
    const t = await opened();
    const made = (await t.highlight([LINE_TWO], "just a note")).result!.data;
    expect(await questions(t.c)).toHaveLength(0);

    await t.edit("amend", made.id, { note: "Q: why does it fade?" });
    expect(await questions(t.c)).toHaveLength(1);

    // The Question is the researcher's now: editing the note does not
    // rewrite it or make a second (story 31).
    await t.edit("amend", made.id, { note: "Q: a different wording" });
    await t.edit("amend", made.id, { note: "" });
    expect(await questions(t.c)).toHaveLength(1);
    const sidecar = await readSidecar(t.vault, "src-1");
    expect(sidecar!.annotations[0]!.question).toBeDefined();
  });

  it("spawns no second Question for a highlight made with Q: and then re-coloured", async () => {
    const t = await opened();
    const made = (await t.highlight([LINE_TWO], "Q: first?")).result!.data;
    expect(await questions(t.c)).toHaveLength(1);
    await t.edit("amend", made.id, { colour: "blue" });
    expect(await questions(t.c)).toHaveLength(1);
  });
});

describe("removing an annotation", () => {
  it("asks first when things point at it, naming them, and writes nothing", async () => {
    const t = await opened(LINK);
    const made = (await t.highlight([LINE_TWO])).result!.data;
    expect(made.block).toBe("h1");
    const before = await readFile(join(t.vault, PDF));
    const reply = await t.remove(made.id);
    expect(reply.result!.data).toMatchObject({
      outcome: "confirm",
      links: [{ path: "notes/plan.md" }],
    });
    expect(await readFile(join(t.vault, PDF))).toEqual(before);
    expect(await t.note()).not.toContain("(gone)");
  });

  it("once confirmed, removes it from the PDF and leaves a (gone) block, with no Unmatched row at the next Ingest", async () => {
    const t = await opened(LINK);
    const made = (await t.highlight([LINE_TWO])).result!.data;
    const reply = await t.remove(made.id, true);
    expect(reply.result!.data).toMatchObject({
      outcome: "gone",
      block: "h1",
    });
    expect(await t.marks()).toEqual([]);
    expect(await t.note()).toMatch(/"Participants[^"]*" \(gone\) \^h1/);
    const sidecar = await readSidecar(t.vault, "src-1");
    expect(sidecar!.annotations[0]!.gone_at).toBeDefined();
    expect(sidecar!.annotations[0]!.unmatched_since).toBeUndefined();
    // The link still resolves; nothing was rewritten.
    expect(await readFile(join(t.vault, "notes/plan.md"), "utf8")).toBe(
      LINK["notes/plan.md"]
    );
    const rows = await t.c.query("looseEnds.rows");
    expect(JSON.stringify(rows.result?.data)).not.toContain("unmatched");
  });

  it("removes an unlinked annotation without asking, drops its block, never reuses its number and counts it", async () => {
    const t = await opened();
    const made = (await t.highlight([LINE_TWO])).result!.data;
    const landed = t.events.next("ingestLanded");
    const reply = await t.remove(made.id);
    expect(reply.result!.data).toMatchObject({ outcome: "removed" });
    expect((await landed).summary).toEqual({
      new: 0,
      questions: 0,
      removed: 1,
      unmatched: 0,
    });
    expect(await t.marks()).toEqual([]);
    expect(await t.note()).not.toContain("^h1");
    const next = (await t.highlight([LINE_ONE])).result!.data;
    expect(next.block).toBe("h2");
  });

  it("treats a Question that names the block as a link", async () => {
    const t = await opened({
      "questions/why.md":
        "---\nkind: question\nid: q-1\nquestion: Why?\nstatus: open\ncaptured: 2026-09-29T10:00:00Z\nfrom: '[[rasch2013]]'\nannotation: h1\ncontext: reading\n---\n",
    });
    const made = (await t.highlight([LINE_TWO])).result!.data;
    expect((await t.remove(made.id)).result!.data.outcome).toBe("confirm");
  });

  it("treats an annotation as linked while the index cannot be shown to be current", async () => {
    const t = await opened();
    const made = (await t.highlight([LINE_TWO])).result!.data;
    await t.c.close();
    // Reopened with a watch nothing is heard from: nothing can be concluded
    // to be unlinked, so a removal must ask.
    const elsewhere = await tmp("unheard");
    const deaf = ((
      _folder: string,
      options: { recursive: boolean },
      listener: WatchListener<string>
    ) => fsWatch(elsewhere, options, listener)) as typeof fsWatch;
    const c = await core({
      settleMs: 40,
      watch: deaf,
      probeTimeoutMs: 200,
      author: "Sarah Lehman",
    });
    await c.mutate("vault.open", { path: t.vault });
    const reply = await c.mutate<Removal>("sources.removeAnnotation", {
      path: "sources/rasch2013.md",
      annotation: made.id,
      confirmed: false,
    });
    expect(reply.result!.data.outcome).toBe("confirm");
    expect(await t.marks()).toHaveLength(1);
    // Confirmed, it is tombstoned and never counted as removed.
    const done = await c.mutate<Removal>("sources.removeAnnotation", {
      path: "sources/rasch2013.md",
      annotation: made.id,
      confirmed: true,
    });
    expect(done.result!.data.outcome).toBe("gone");
  });

  it("leaves the PDF as it was when the write fails, and the annotation still recorded", async () => {
    const t = await opened();
    const made = (await t.highlight([LINE_TWO])).result!.data;
    const before = await readFile(join(t.vault, PDF));
    await chmod(join(t.vault, "sources/pdf"), 0o555);
    try {
      expect((await t.remove(made.id)).error).toBeDefined();
    } finally {
      await chmod(join(t.vault, "sources/pdf"), 0o755);
    }
    expect(await readFile(join(t.vault, PDF))).toEqual(before);
    const sidecar = await readSidecar(t.vault, "src-1");
    expect(sidecar!.annotations[0]!.removed_at).toBeUndefined();
    expect(sidecar!.annotations[0]!.gone_at).toBeUndefined();
    expect(await t.note()).toContain("^h1");
  });

  it("leaves a linked annotation's block live, not (gone), when the write fails", async () => {
    const t = await opened(LINK);
    const made = (await t.highlight([LINE_TWO])).result!.data;
    await chmod(join(t.vault, "sources/pdf"), 0o555);
    try {
      expect((await t.remove(made.id, true)).error).toBeDefined();
    } finally {
      await chmod(join(t.vault, "sources/pdf"), 0o755);
    }
    expect(await t.note()).not.toContain("(gone)");
    const sidecar = await readSidecar(t.vault, "src-1");
    expect(sidecar!.annotations[0]!.gone_at).toBeUndefined();
    expect(await t.marks()).toHaveLength(1);
  });

  it("does not come back as a question when the PDF returns", async () => {
    const t = await opened(LINK);
    const made = (await t.highlight([LINE_TWO])).result!.data;
    await t.remove(made.id, true);
    const bytes = await readFile(join(t.vault, PDF));
    await writeFile(
      join(t.vault, PDF),
      Buffer.concat([bytes, Buffer.from("\n%touched\n")])
    );
    await t.c.indexed();
    const sidecar = await readSidecar(t.vault, "src-1");
    expect(sidecar!.annotations).toHaveLength(1);
    expect(sidecar!.annotations[0]!.unmatched_since).toBeUndefined();
  });
});
