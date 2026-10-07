import { open, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SourcePage } from "./reader.js";
import {
  closeCores,
  core,
  fixtures,
  vaultWith,
  LONG_RUN_WINDOW_MS,
} from "./test-core.js";

afterEach(closeCores);

// Opening a Source in the Reader (#424; spec #416 stories 70–79, 87–89): the
// core answers what the window draws — the Source's fields, the PDF's
// address, the annotations the overlay is made of — serves the PDF's bytes
// under the bearer token, remembers where the reader stopped, and brings an
// evicted PDF down when it is opened.

const pdf = (name: string) => readFile(join(fixtures, "pdf", name));
const SOURCE = `---
kind: source
id: src-1
citekey: rasch2013
title: Odor cues during slow-wave sleep
authors:
  - Rasch
year: 2013
url: https://example.org/rasch
pdf: rasch2013.pdf
---
Notes I typed.
`;
const STUB = `---
kind: source-stub
citekey: rasch2013
title: Odor cues during slow-wave sleep
---
`;

async function opened(
  files: Record<string, string> = {},
  bytes = "annotated.pdf"
) {
  const vault = await vaultWith({
    "sources/rasch2013.md": SOURCE,
    "sources/pdf/rasch2013.pdf": "",
    ...files,
  });
  await writeFile(join(vault, "sources/pdf/rasch2013.pdf"), await pdf(bytes));
  const c = await core({ settleMs: 40 });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const events = await c.events();
  // The open-time sweep ingests a PDF that arrived while the app was closed.
  await events.next("ingestLanded");
  const page = async (path = "sources/rasch2013.md") => {
    const reply = await c.query<SourcePage>("sources.page", { path });
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  return { vault, c, events, page };
}

describe("sources.page", () => {
  it("answers the Source's fields, the PDF's address, and the annotations the overlay draws", async () => {
    const { page } = await opened();
    const read = await page();
    if (!read.readable) throw new Error(read.reason);
    expect(read).toMatchObject({
      path: "sources/rasch2013.md",
      title: "Odor cues during slow-wave sleep",
      authors: ["Rasch"],
      year: "2013",
      url: "https://example.org/rasch",
      pdf: "sources/pdf/rasch2013.pdf",
      evicted: false,
      position: null,
    });
    // Markup and notes only: ink and shapes stay in the page bitmap, so the
    // overlay is never handed one to redraw (story 77).
    expect(read.annotations.map((a) => a.block)).toEqual([
      "h1",
      "h2",
      "h3",
      "h4",
    ]);
    expect(read.annotations[0]).toMatchObject({
      kind: "highlight",
      page: 0,
      quote: "Participants who heard the odor cue",
      note: "Check this against the control group",
      question: false,
    });
    expect(read.annotations[0]!.quads.length).toBeGreaterThan(0);
    expect(read.annotations[0]!.color).toHaveLength(3);
  });

  it("marks a Q: highlight as a question, on its note", async () => {
    const { page } = await opened({}, "annotated-questions.pdf");
    const read = await page();
    if (!read.readable) throw new Error(read.reason);
    expect(read.annotations.some((a) => a.question)).toBe(true);
    for (const a of read.annotations) {
      const words =
        a.kind === "text" || a.kind === "freetext" ? a.quote : a.note;
      expect(a.question).toBe(/^\s*q:\s*\S/i.test(words));
    }
  });

  it("does not draw an annotation that was removed or is gone from the file", async () => {
    const { page, vault, events } = await opened();
    // Preview returns the file with fewer annotations.
    await writeFile(
      join(vault, "sources/pdf/rasch2013.pdf"),
      await pdf("annotated-fewer.pdf")
    );
    await events.next("ingestLanded");
    const read = await page();
    if (!read.readable) throw new Error(read.reason);
    expect(read.annotations.length).toBeLessThan(4);
  });

  it("refuses a stub: it has no Reader", async () => {
    const { page } = await opened({ "sources/stub.md": STUB });
    expect(await page("sources/stub.md")).toEqual({
      readable: false,
      path: "sources/stub.md",
      reason: "not a Source: kind is source-stub",
    });
  });

  it("says a missing file is missing, without a path", async () => {
    const { page } = await opened();
    expect(await page("sources/nowhere.md")).toEqual({
      readable: false,
      path: "sources/nowhere.md",
      reason: "missing from the vault",
    });
  });

  it("answers a Source whose PDF was never read with no annotations", async () => {
    const { page } = await opened(
      {
        "sources/other.md": SOURCE.replace("id: src-1", "id: src-2").replace(
          "rasch2013.pdf",
          "other.pdf"
        ),
        "sources/pdf/other.pdf": "not a pdf",
      },
      "annotated.pdf"
    );
    const read = await page("sources/other.md");
    if (!read.readable) throw new Error(read.reason);
    expect(read.annotations).toEqual([]);
    expect(read.pdf).toBe("sources/pdf/other.pdf");
  });
});

describe("the PDF's bytes", () => {
  it("are served under the bearer token, and to nothing else", async () => {
    const { c } = await opened();
    const path = "/pdf/sources/pdf/rasch2013.pdf";
    expect((await c.raw(path)).status).toBe(401);
    const res = await c.raw(path, {
      headers: { authorization: "Bearer test-token" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(
      await pdf("annotated.pdf")
    );
  });

  it("answer a byte range with 206, for a reader that will not hold a whole large file", async () => {
    const { c } = await opened();
    const whole = await pdf("annotated.pdf");
    const res = await c.raw("/pdf/sources/pdf/rasch2013.pdf", {
      headers: { authorization: "Bearer test-token", range: "bytes=10-19" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(
      `bytes 10-19/${whole.length}`
    );
    expect(Buffer.from(await res.arrayBuffer())).toEqual(
      whole.subarray(10, 20)
    );
    const past = await c.raw("/pdf/sources/pdf/rasch2013.pdf", {
      headers: {
        authorization: "Bearer test-token",
        range: `bytes=${whole.length + 5}-`,
      },
    });
    expect(past.status).toBe(416);
  });

  it("are only a PDF in the PDF folder: not a note, not a dot-folder, not the sidecar", async () => {
    const { c } = await opened();
    for (const path of [
      "sources/rasch2013.md",
      ".vitrine/annotations/src-1.json",
      "questions/x.pdf",
      "sources/pdf/../rasch2013.md",
      "sources/pdf/missing.pdf",
    ]) {
      const res = await c.raw(`/pdf/${path}`, {
        headers: { authorization: "Bearer test-token" },
      });
      expect(res.status, path).toBe(404);
    }
  });
});

describe("the reading position", () => {
  it("is remembered per Source and comes back with the page", async () => {
    const { c, page } = await opened();
    const set = await c.mutate("sources.readingPosition", {
      path: "sources/rasch2013.md",
      page: 2,
      offset: 0.25,
    });
    expect(set.error).toBeUndefined();
    const read = await page();
    if (!read.readable) throw new Error(read.reason);
    expect(read.position).toEqual({ page: 2, offset: 0.25 });
  });

  it("is written through Ingest's queue, so a run that lands after it does not lose it", async () => {
    const { c, page, vault, events } = await opened();
    await c.mutate("sources.readingPosition", {
      path: "sources/rasch2013.md",
      page: 2,
      offset: 0.5,
    });
    await writeFile(
      join(vault, "sources/pdf/rasch2013.pdf"),
      await pdf("annotated-again.pdf")
    );
    await events.next("ingestLanded");
    const read = await page();
    if (!read.readable) throw new Error(read.reason);
    expect(read.position).toEqual({ page: 2, offset: 0.5 });
  });

  it("is refused for a Source with nothing ingested, and says so", async () => {
    const { c } = await opened({
      "sources/other.md": SOURCE.replace("id: src-1", "id: src-2").replace(
        "rasch2013.pdf",
        "other.pdf"
      ),
      "sources/pdf/other.pdf": "not a pdf",
    });
    const set = await c.mutate<{ written: boolean }>(
      "sources.readingPosition",
      {
        path: "sources/other.md",
        page: 1,
        offset: 0,
      }
    );
    expect(set.result!.data).toEqual({ written: false });
  });
});

describe("an evicted PDF", () => {
  // Sparse: a size and no blocks, which is what a sync client's online-only
  // file looks like to `stat` (story 23).
  async function evictedVault() {
    const vault = await vaultWith({
      "sources/rasch2013.md": SOURCE,
      "sources/pdf/.keep": "",
    });
    const handle = await open(join(vault, "sources/pdf/rasch2013.pdf"), "w");
    await handle.truncate(4 * 1024 * 1024);
    await handle.close();
    // A run window no test waits out: what this waits on must not wait for it (#553).
    const c = await core({ settleMs: 40, runWindowMs: LONG_RUN_WINDOW_MS });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    return { vault, c };
  }

  it("is said to be evicted, and is not ingested until it is brought down", async () => {
    const { c } = await evictedVault();
    const reply = await c.query<SourcePage>("sources.page", {
      path: "sources/rasch2013.md",
    });
    const read = reply.result!.data;
    if (!read.readable) throw new Error(read.reason);
    expect(read.evicted).toBe(true);
    expect(read.annotations).toEqual([]);
  });

  it("is brought down on open and then ingested", async () => {
    const { c, vault } = await evictedVault();
    const events = await c.events();
    // The sync client delivers the bytes when they are asked for; here the
    // file is written as the read would have made it arrive.
    await writeFile(
      join(vault, "sources/pdf/rasch2013.pdf"),
      await pdf("annotated.pdf")
    );
    const brought = await c.mutate("sources.bringDown", {
      path: "sources/rasch2013.md",
    });
    expect(brought.error).toBeUndefined();
    // Read at once, before the watcher's settle window could have ingested
    // the write: it is the bringing down that did it, not the change.
    const reply = await c.query<SourcePage>("sources.page", {
      path: "sources/rasch2013.md",
    });
    const read = reply.result!.data;
    if (!read.readable) throw new Error(read.reason);
    expect(read.evicted).toBe(false);
    expect(read.annotations).toHaveLength(4);
    expect((await events.next("ingestLanded")).summary.new).toBe(6);
  });
});

describe("sources.connections", () => {
  const RQ = `---
kind: research-question
id: rq-1
question: Does odor cueing help?
---
Cites [[rasch2013#^h2]] on the control group.
`;
  const NOTE = `Thinking about [[rasch2013#^h1]] and the whole paper [[rasch2013]].
`;
  const ASKED = `---
kind: question
id: q-1
question: Why the control group?
status: open
captured: 2026-09-01T10:00:00
from: "[[rasch2013]]"
page: 2
annotation: h3
context: ingest
---
`;
  const CLOSED = `---
kind: question
id: q-2
question: Old one
status: abandoned
captured: 2026-09-02T10:00:00
from: "[[rasch2013b]]"
context: ingest
---
`;

  async function connections(files: Record<string, string>) {
    const { c } = await opened(files);
    await c.indexed();
    const reply = await c.query<
      Array<{
        path: string;
        kind: string | null;
        block: string | null;
        page: number | null;
        open: boolean;
      }>
    >("sources.connections", { path: "sources/rasch2013.md" });
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  }

  it("lists what links to the Source and its blocks, and Questions whose provenance names it, by page then recency", async () => {
    const found = await connections({
      "questions/rq.md": RQ,
      "notes/idea.md": NOTE,
      "questions/asked.md": ASKED,
      "questions/closed.md": CLOSED,
    });
    // The fixture's h1–h3 all sit on page 1, so they tie on page and are
    // newest-first within it: only the tie's members are asserted, and that
    // the paper-wide link follows every paged one.
    expect(
      found
        .slice(0, 3)
        .map((f) => [f.path, f.kind, f.block, f.page, f.open])
        .sort()
    ).toEqual([
      ["notes/idea.md", null, "h1", 1, false],
      ["questions/asked.md", "question", "h3", 1, true],
      ["questions/rq.md", "research-question", "h2", 1, false],
    ]);
    expect(found).toHaveLength(4);
    expect(found[3]).toMatchObject({ block: null, page: null });
  });

  it("lists a Question whose provenance names the Source even when no note links it", async () => {
    const found = await connections({ "questions/asked.md": ASKED });
    expect(found.map((f) => f.path)).toEqual(["questions/asked.md"]);
  });

  it("lists a Question once when a note-style link and its provenance both name the Source", async () => {
    const found = await connections({
      "questions/asked.md": ASKED.replace("---\n", "---\n").concat(
        "Back to [[rasch2013]].\n"
      ),
    });
    expect(found.map((f) => [f.path, f.block])).toEqual([
      ["questions/asked.md", "h3"],
    ]);
  });

  it("does not list the Source's own note, and does not mistake rasch2013b for it", async () => {
    const found = await connections({ "questions/closed.md": CLOSED });
    expect(found).toEqual([]);
  });
});
