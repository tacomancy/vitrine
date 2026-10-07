import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSidecar } from "./annotation-sidecar.js";
import { createPdfEngine } from "./pdf-engine.js";
import {
  closeCores,
  core,
  fixtures,
  vaultWith,
  LONG_RUN_WINDOW_MS,
  type CoreOptions,
  NEXT_TIMEOUT_MS,
} from "./test-core.js";

afterEach(closeCores);

// A Question made from the page (#427; spec #416 stories 97–103, decisions
// *A Reader-made Question writes `Q:`* and *Capture in the Reader*): with a
// selection it is a `Q:` highlight and a Question made together; without
// one it is a Question alone and the PDF is not touched.

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
const LINE_TWO = [60, 678, 560, 696];
const LINE_TWO_TEXT =
  "Participants who heard the odor cue recalled more of the invented word pairs";

const engine = createPdfEngine();
afterEach(() => engine.close());

type Listed = {
  question: string;
  context: string;
  from?: string;
  page?: number;
  annotation?: string;
};

async function opened(options: CoreOptions = {}) {
  const vault = await vaultWith({
    "sources/rasch2013.md": SOURCE,
    [PDF]: "",
  });
  await writeFile(
    join(vault, PDF),
    await readFile(join(fixtures, "pdf", "synthetic-body.pdf"))
  );
  // A window no test waits out (`LONG_RUN_WINDOW_MS`, #553).
  const c = await core({
    settleMs: 40,
    runWindowMs: LONG_RUN_WINDOW_MS,
    author: "Sarah Lehman",
    ...options,
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const listed = async () => {
    await c.indexed();
    return (await c.query<{ questions: Listed[] }>("questions.list")).result!
      .data.questions;
  };
  const make = (input: Record<string, unknown> = {}) =>
    c.mutate<{ question: { id: string }; block: string }>("sources.question", {
      path: "sources/rasch2013.md",
      page: 1,
      rects: [LINE_TWO],
      text: "Does the odor cue work without sleep?",
      ...input,
    });
  const onDisk = async () => new Uint8Array(await readFile(join(vault, PDF)));
  return { vault, c, listed, make, onDisk };
}

describe("sources.question, with a selection", () => {
  it("writes a Q: highlight and a Question with reading provenance and the block", async () => {
    const { make, listed, onDisk, vault } = await opened();
    const reply = await make();
    expect(reply.error).toBeUndefined();
    expect(reply.result!.data.block).toBe("h1");

    const [mark] = (await engine.annotations(await onDisk())).annotations;
    expect(mark).toMatchObject({
      kind: "highlight",
      quote: LINE_TWO_TEXT,
      note: "Q: Does the odor cue work without sleep?",
      author: "Sarah Lehman",
    });

    expect(await listed()).toEqual([
      expect.objectContaining({
        question: "Does the odor cue work without sleep?",
        context: "reading",
        from: "[[rasch2013]]",
        page: 1,
        annotation: "h1",
      }),
    ]);
    const files = await readdir(join(vault, "questions"));
    expect(await readFile(join(vault, "questions", files[0]!), "utf8")).toMatch(
      /^> Participants who heard/m
    );
  });

  it("sets the once-only flag at write time, so the next Ingest spawns no second", async () => {
    // The harness's window, not a long one: this saves the PDF as a sync client
    // would and waits for the Ingest that makes, which a long window would hold.
    const { make, listed, onDisk, vault, c } = await opened({
      runWindowMs: 0,
    });
    const reply = await make();
    const sidecar = await readSidecar(vault, "src-1");
    expect(sidecar!.annotations[0]!.question).toBe(
      reply.result!.data.question.id
    );
    const events = await c.events();
    const before = await readSidecar(vault, "src-1");
    await writeFile(
      join(vault, PDF),
      Buffer.concat([Buffer.from(await onDisk()), Buffer.from("\n%touched\n")])
    );
    await vi.waitFor(
      async () => {
        const after = await readSidecar(vault, "src-1");
        expect(after!.file.hash).not.toBe(before!.file.hash);
      },
      { timeout: NEXT_TIMEOUT_MS }
    );
    void events;
    expect(await listed()).toHaveLength(1);
  });

  it("refuses a selection with no text under it, and makes no Question", async () => {
    const { make, listed, onDisk } = await opened();
    const before = await onDisk();
    const reply = await make({ rects: [[60, 100, 560, 200]] });
    expect(reply.error?.message).toMatch(/no text under that selection/);
    expect(await onDisk()).toEqual(before);
    expect(await listed()).toEqual([]);
  });
});

describe("questions.capture from the Reader, with no selection", () => {
  it("carries the Source and the page, has no annotation, and leaves the PDF's bytes alone", async () => {
    const { c, listed, onDisk } = await opened();
    const before = await onDisk();
    const reply = await c.mutate("questions.capture", {
      text: "What would falsify this?",
      provenance: {
        context: "reading",
        source: "sources/rasch2013.md",
        page: 4,
      },
    });
    expect(reply.error).toBeUndefined();
    expect(await listed()).toEqual([
      expect.objectContaining({
        question: "What would falsify this?",
        context: "reading",
        from: "[[rasch2013]]",
        page: 4,
      }),
    ]);
    expect((await listed())[0]!.annotation).toBeUndefined();
    expect(await onDisk()).toEqual(before);
  });

  it("refuses a page that is not a Source", async () => {
    const { c } = await opened();
    const reply = await c.mutate("questions.capture", {
      text: "x",
      provenance: {
        context: "reading",
        source: "questions/none.md",
        page: 1,
      },
    });
    expect(reply.error).toBeDefined();
  });

  it("does not accept an annotation from the window: that path is sources.question's", async () => {
    const { c } = await opened();
    const reply = await c.mutate("questions.capture", {
      text: "x",
      provenance: {
        context: "reading",
        source: "sources/rasch2013.md",
        page: 1,
        annotation: "h1",
      },
    });
    expect(reply.error).toBeDefined();
  });
});

describe("a Question made beside a PDF the run window is holding", () => {
  // The Reader's writes never wait on the run window (#553): a PDF held for a
  // window this test does not outlast must not delay the Question. The held PDF
  // is another file in the folder, so the Reader's own is never the one in flight.
  it("is made at once", async () => {
    const { make, listed, c, vault } = await opened();
    // Held once the watcher has settled it and the index has said so.
    await writeFile(
      join(vault, "sources/pdf/other.pdf"),
      await readFile(join(fixtures, "pdf", "synthetic-body.pdf"))
    );
    await vi.waitFor(
      () =>
        expect(
          c.changes.some((e) => e.changed.includes("sources/pdf/other.pdf"))
        ).toBe(true),
      { timeout: NEXT_TIMEOUT_MS }
    );
    const reply = await make();
    expect(reply.error).toBeUndefined();
    expect(await listed()).toHaveLength(1);
  });
});
