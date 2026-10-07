import {
  watch as fsWatch,
  type WatchEventType,
  type WatchListener,
} from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { questionText } from "./ingest.js";
import {
  closeCores,
  core,
  fixtures,
  vaultWith,
  LONG_RUN_WINDOW_MS,
  type CoreOptions,
  NEXT_TIMEOUT_MS,
  WIDEST_WAIT_MS,
} from "./test-core.js";
import { FSEVENTS_LATENCY_MS } from "./vault-watcher.js";

afterEach(closeCores);

// Ingest of a returning PDF (#419; spec #416 stories 13–24, 58): an annotated
// PDF that changes on disk is read when it settles, every markup and note
// becomes one block in its Source, and the run says what landed in one line.
// These state what a first return looks like; re-matching is
// `ingest.rematch.test.ts`.

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
  pending?: { kept: number };
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
  /** Replace the PDF as Preview would on a return, and wait for the run it makes. */
  const returned = async (
    bytes: Buffer,
    name = "rasch2013.pdf",
    timeoutMs?: number
  ) => {
    await writeFile(join(vault, "sources/pdf", name), bytes);
    const options = timeoutMs === undefined ? undefined : { timeoutMs };
    return (await events.next("ingestLanded", options)).summary;
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
    // Nothing in the new file is any of the four: they are removed, their
    // blocks leave the note, and what is new takes the next number.
    const text = await source();
    expect(text).toContain('"Another line follows here for a highlight" ^h5');
    expect((await sidecar()).next_block).toBe(6);
    expect(text.match(/\^h\d+/g)).toEqual(["^h5"]);
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

describe("a Source with a PDF and no id", () => {
  const BARE = `---
kind: source
citekey: rasch2013
title: Odor cues during slow-wave sleep
pdf: rasch2013.pdf
---
Notes I typed.
`;

  it("is given an id on its first return, changing that one key and nothing else", async () => {
    const vault = await vaultWith({
      "sources/rasch2013.md": BARE,
      "sources/pdf/rasch2013.pdf": "",
    });
    await writeFile(
      join(vault, "sources/pdf/rasch2013.pdf"),
      await pdf("synthetic-body.pdf")
    );
    const c = await core({ settleMs: 40, newId: () => "src-minted-9" });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    const events = await c.events();
    await writeFile(
      join(vault, "sources/pdf/rasch2013.pdf"),
      await pdf("annotated.pdf")
    );
    await events.next("ingestLanded");
    const text = await readFile(join(vault, "sources/rasch2013.md"), "utf8");
    expect(text.replace("id: src-minted-9\n", "")).toBe(
      BARE + "\n## Annotations\n" + text.split("## Annotations\n")[1]
    );
    expect(text).toContain("id: src-minted-9\n");
    const stored = JSON.parse(
      await readFile(
        join(vault, ".vitrine/annotations/src-minted-9.json"),
        "utf8"
      )
    ) as Sidecar;
    expect(stored.annotations).toHaveLength(6);
  });

  it("keeps the id it minted when the next PDF returns", async () => {
    const vault = await vaultWith({
      "sources/rasch2013.md": BARE,
      "sources/pdf/rasch2013.pdf": "",
    });
    await writeFile(
      join(vault, "sources/pdf/rasch2013.pdf"),
      await pdf("synthetic-body.pdf")
    );
    let n = 0;
    const c = await core({ settleMs: 40, newId: () => `minted-${++n}` });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    const events = await c.events();
    for (const name of ["annotated.pdf", "annotated-again.pdf"]) {
      await writeFile(
        join(vault, "sources/pdf/rasch2013.pdf"),
        await pdf(name)
      );
      await events.next("ingestLanded");
    }
    const text = await readFile(join(vault, "sources/rasch2013.md"), "utf8");
    expect(text.match(/^id: /gm)).toHaveLength(1);
  });
});

describe("an Ingest that could not finish", () => {
  it("is taken up again without adding the same annotations twice", async () => {
    const { c, vault, events, source, sidecar } = await opened();
    // A folder that refuses the note's rename: the counter lands, the blocks cannot.
    await chmod(join(vault, "sources"), 0o555);
    try {
      await writeFile(
        join(vault, "sources/pdf/rasch2013.pdf"),
        await pdf("annotated.pdf")
      );
      // The run is waited for as the counter landing in the sidecar: the PDF
      // settles and is held for the run window first (#553), so a stopwatch
      // would end before the run began and this would restore the folder's
      // permissions in time for it to succeed. Then nothing lands, since the
      // note's rename is refused.
      await vi.waitFor(
        async () =>
          expect((await sidecar()).pending).toEqual({
            kept: 0,
            removed: 0,
            unmatched: 0,
          }),
        { timeout: NEXT_TIMEOUT_MS }
      );
      await expect(
        events.next("ingestLanded", { timeoutMs: 400 })
      ).rejects.toThrow();
    } finally {
      await chmod(join(vault, "sources"), 0o755);
    }
    await c.close();
    const again = await core({ settleMs: 40 });
    await again.mutate("vault.open", { path: vault });
    await again.indexed();
    await (await again.events()).next("ingestLanded");
    const blocks = (await source()).match(/\^h\d+/g);
    expect(blocks).toHaveLength(4);
    expect((await sidecar()).annotations).toHaveLength(6);
  });
});

describe("a PDF returning alone", () => {
  // It always waits (ADR 0013, update for #553): read once it has settled and
  // the run window has gone quiet, never at the settle. Waiting only while the
  // watcher has more pending would be cheaper, and wrong after a stall and
  // between two large files, which is where the window is for. Neither the
  // window nor the ceiling may be asked for less than the floor they are held
  // to (twice the settle window; the window), so asking for 1 ms of either must
  // not read the PDF early.
  //
  // Both are lower bounds, so a loaded machine can only make them pass more
  // easily; and the settle window is a second, not the harness's 40 ms, so that
  // the floor (2 s) is far enough above what a PDF takes with no floor at all
  // (about a second, and noise on top) for the test to tell them apart.
  it.each([
    ["window", { runWindowMs: 1 }],
    ["ceiling", { runCeilingMs: 1 }],
  ])(
    "is read no sooner than the run window, whatever %s the core is asked for",
    async (_, options) => {
      const settleMs = 1000;
      const { returned } = await opened({}, { settleMs, ...options });
      const started = performance.now();
      // A settle window of a second takes about half the harness's bound, so
      // this wait is given its own.
      await returned(
        await pdf("annotated.pdf"),
        undefined,
        2 * NEXT_TIMEOUT_MS
      );
      // Settled, then held for the window: the settle window, and twice it
      // (ADR 0013, update for #553).
      expect(performance.now() - started).toBeGreaterThanOrEqual(3 * settleMs);
    },
    // Each takes about three seconds, and the harness's budget is Vitest's 5 s.
    20_000
  );
});

describe("a vault opened over PDFs that changed while the app was closed", () => {
  // The sweep at open raises one `vaultChanged` per chunk of files (250 in
  // production, one here), and the PDFs in each chunk were a run of their own
  // (#553): four PDFs in four chunks said "6 new" in the footer, not 24. What
  // the sweep ends with reads every Source at once, and does not wait for the
  // run window, which here outlasts the test.
  it("are one run, read at once", async () => {
    const files: Record<string, string> = {};
    for (let n = 1; n <= 4; n++) {
      files[`sources/paper${n}.md`] =
        `---\nkind: source\nid: src-${n}\ncitekey: paper${n}\npdf: paper${n}.pdf\n---\n`;
      files[`sources/pdf/paper${n}.pdf`] = "";
    }
    const vault = await vaultWith(files);
    const bytes = await pdf("annotated.pdf");
    for (let n = 1; n <= 4; n++) {
      await writeFile(join(vault, `sources/pdf/paper${n}.pdf`), bytes);
    }
    const c = await core({
      settleMs: 40,
      chunkSize: 1,
      runWindowMs: LONG_RUN_WINDOW_MS,
    });
    // Before the open: the run is raised during it.
    const events = await c.events();
    await c.mutate("vault.open", { path: vault });
    const landed = await events.next("ingestLanded");
    expect(landed.summary).toEqual({
      new: 24,
      questions: 0,
      removed: 0,
      unmatched: 0,
    });
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

// "Fifty PDFs settling together" (#419; spec #416 story 14) is about what the
// watcher hears, so that is what these tests fix. They used to write the fifty
// one after another and take FSEvents as it came, and that failed on CI as
// `new: 17` and `new: 10` (#550). The watcher closes a Batch when nothing else
// is pending, or when its oldest settled path has waited one more window
// (`vault-watcher.ts`, #189), and the window is never under 200 ms whatever
// `settleMs` asks, so a burst that outlasts it is two Batches or more. Under
// load the fifty writes take that long: #550 traced a loop of 229 ms around one
// `writeFile` of 90. The window's width is `vault-watcher.test.ts`'s to test,
// not this file's.

/** Fifty PDFs returning together, as spec #416 story 14 has it. */
const PDFS = 50;

/**
 * How long a wait that scales with the machine may take before it is called
 * lost: 25 times what fifty PDFs take through the engine alone (about 0.4 s),
 * which beside three whole-suite runs overran the harness's 2 s
 * (`NEXT_TIMEOUT_MS`) and ran this test out (#550). A test gets three of them,
 * for the OS naming the PDFs, the landing and the rest, so a lost event is
 * named before Vitest's own bare timeout can fire. Nothing waits it out when
 * things go right.
 */
const BUDGET_MS = 10_000;

/**
 * The real `fs.watch`, except that from `hold()` on the OS's events for the
 * PDFs are the helper's: the first for each file is kept until `deliver()`
 * hands them to the watcher in the callbacks the test chooses. Real files, real
 * stats and hashes, and the OS's own word that each PDF changed; only *when the
 * watcher hears it* is taken out of the disk's hands. The duplicates FSEvents
 * adds (fifty files came as 50 to 54 events) are dropped, as are stragglers
 * after the delivery: the watcher stats the path whichever event named it. The
 * same seam as `deferring()` in `vault-watcher.test.ts`, for the same reason:
 * on a real machine it depends on what else is writing.
 */
function held() {
  const kept = new Map<string, WatchEventType>();
  let hear: WatchListener<string> | null = null;
  let holding = false;
  let wake: () => void = () => undefined;
  const watch = ((
    folder: string,
    options: { recursive: boolean },
    listener: WatchListener<string>
  ) => {
    hear = listener;
    return fsWatch(folder, options, (kind, filename) => {
      if (holding && filename?.startsWith("sources/pdf/")) {
        if (!kept.has(filename)) kept.set(filename, kind);
        wake();
      } else {
        listener(kind, filename);
      }
    });
  }) as typeof fsWatch;
  return {
    watch,
    hold: () => {
      holding = true;
    },
    /**
     * Once the OS has named every PDF, hands the watcher all of them: the
     * first `groups[0]` in one callback, each group after it `gapMs` later
     * (one FSEvents latency, unless a test wants the watcher to close a Batch
     * between two of them), and what is left in the last. Every callback is
     * timed from now, not from the one before, so a loop that stalls delivers
     * the ones it missed together and in order. Answers with the size of each
     * callback it made.
     */
    deliver: async (groups: number[], gapMs = FSEVENTS_LATENCY_MS) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                `waited ${BUDGET_MS}ms for the OS to name ${PDFS} PDFs: it named ${kept.size}`
              )
            ),
          BUDGET_MS
        );
        wake = () => {
          if (kept.size < PDFS) return;
          clearTimeout(timer);
          resolve();
        };
        wake();
      });
      if (hear === null) throw new Error("the core started no watch");
      const listener = hear;
      const all = [...kept];
      const calls: Array<Promise<number>> = [];
      let from = 0;
      for (const [n, size] of [...groups, all.length].entries()) {
        const group = all.slice(from, from + size);
        from += size;
        calls.push(
          new Promise((resolve) =>
            setTimeout(() => {
              for (const [filename, kind] of group) listener(kind, filename);
              resolve(group.length);
            }, n * gapMs)
          )
        );
      }
      return Promise.all(calls);
    },
  };
}

/**
 * Fifty PDFs written one after another and heard in `groups`' callbacks, `gapMs`
 * apart, by a core built with the run window and ceiling a test asks for (the
 * harness's own when it does not). Answers once the watcher has heard them all;
 * what Ingest does with them is the test's to wait for on `events`.
 */
async function deliveredFifty(
  groups: number[],
  {
    gapMs,
    runWindowMs,
    runCeilingMs,
  }: { gapMs?: number; runWindowMs?: number; runCeilingMs?: number } = {}
) {
  const files: Record<string, string> = {};
  for (let n = 1; n <= PDFS; n++) {
    files[`sources/s${n}.md`] =
      `---\nkind: source\nid: s${n}\ncitekey: s${n}\npdf: s${n}.pdf\n---\n`;
  }
  const vault = await vaultWith(files);
  await mkdir(join(vault, "sources/pdf"), { recursive: true });
  const base = await pdf("annotated-again.pdf");
  const os = held();
  const c = await core({
    settleMs: 40,
    watch: os.watch,
    ...(runWindowMs === undefined ? {} : { runWindowMs }),
    ...(runCeilingMs === undefined ? {} : { runCeilingMs }),
  });
  await c.mutate("vault.open", { path: vault });
  await c.indexed();
  const events = await c.events();
  os.hold();
  for (let n = 1; n <= PDFS; n++) {
    // Distinct bytes: identical files that arrive together would pair as renames.
    await writeFile(
      join(vault, `sources/pdf/s${n}.pdf`),
      Buffer.concat([base, Buffer.from(`\n%${n}\n`)])
    );
  }
  // Said back, so a helper that stopped waiting for the OS, or stopped cutting
  // the burst, fails here by name.
  const left = PDFS - groups.reduce((sum, size) => sum + size, 0);
  expect(await os.deliver(groups, gapMs)).toEqual([...groups, left]);
  return { events };
}

/** Fifty PDFs heard as `deliveredFifty` says: one run, one summary, and no second. */
async function expectOneRun(
  groups: number[],
  options: Parameters<typeof deliveredFifty>[1] = {}
) {
  const { events } = await deliveredFifty(groups, options);
  const landed = await events.next("ingestLanded", { timeoutMs: BUDGET_MS });
  // One markup in the fixture, so a block to each PDF.
  expect(landed.summary).toEqual({
    new: PDFS,
    questions: 0,
    removed: 0,
    unmatched: 0,
  });
  expect(landed.sources).toHaveLength(PDFS);
  await expect(
    events.next("ingestLanded", { timeoutMs: 400 })
  ).rejects.toThrow();
}

describe("a batch of PDFs", () => {
  it(
    "is one run and one summary, and a run with nothing matched opens no panel",
    () => expectOneRun([]),
    3 * BUDGET_MS
  );

  // Under load a burst reaches the watcher as two or three FSEvents callbacks a
  // latency apart (#393 saw a pair of renames do it, #550's traces fifty PDFs).
  // The window has to cover that.
  it(
    "is still one run when FSEvents reports the burst in three callbacks, one latency apart",
    () => expectOneRun([10, 20]),
    3 * BUDGET_MS
  );

  // The watcher closes a Batch as soon as nothing is pending, so callbacks
  // further apart than its settle window are a Batch each, and each of those
  // was a run: the footer said "10 new", not 50 (#553). Five callbacks 350 ms
  // apart are five Batches 350 ms apart. The run window is 800 ms: wide enough
  // that a loaded machine cannot split the delivery, and shorter than the
  // delivery itself (1.4 s of callbacks), so a window that did not start
  // again with each Batch would read the first three and then the rest.
  it(
    "is one run when the watcher hears it as five Batches, each inside the run window of the one before",
    () => expectOneRun([10, 10, 10, 10], { gapMs: 350, runWindowMs: 800 }),
    3 * BUDGET_MS
  );

  // A window that starts again with every Batch can be starved by a stream that
  // never goes quiet: a library syncing for an hour, a PDF rewritten every few
  // seconds. No PDF is held past the ceiling, so that is read in turns instead.
  // The ceiling may be no less than the window, and here it is equal: the
  // first three Batches (30 PDFs) are read at 800 ms and the last two in a turn
  // of their own, where a window with no ceiling would read all fifty at the
  // end.
  it(
    "is read in turns when the stream keeps arriving for longer than the ceiling",
    async () => {
      const { events } = await deliveredFifty([10, 10, 10, 10], {
        gapMs: 350,
        runWindowMs: 800,
        runCeilingMs: 800,
      });
      const runs: Array<{ new: number; sources: string[] }> = [];
      while (runs.reduce((sum, run) => sum + run.new, 0) < PDFS) {
        const landed = await events.next("ingestLanded", {
          timeoutMs: BUDGET_MS,
        });
        runs.push({ new: landed.summary.new, sources: landed.sources });
      }
      expect(runs.length).toBeGreaterThan(1);
      // Every PDF once: none dropped between turns, none read in two.
      expect(runs.reduce((sum, run) => sum + run.new, 0)).toBe(PDFS);
      expect(new Set(runs.flatMap((run) => run.sources)).size).toBe(PDFS);
    },
    3 * BUDGET_MS
  );
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

// The `Q:` convention (#422; spec #416 stories 25–33, ADR 0013 decision 8): a
// markup's or note's current note beginning `Q:` spawns one Question, once.

type Listed = {
  question: string;
  from?: string;
  page?: number;
  annotation?: string;
  context: string;
  captured: string;
};

describe("a note that begins Q:", () => {
  const listed = async (c: Awaited<ReturnType<typeof opened>>["c"]) =>
    (await c.query<{ questions: Listed[] }>("questions.list")).result!.data
      .questions;

  it("becomes one Question with the Source, page and block, and the summary counts it", async () => {
    const { returned, c, vault } = await opened();
    const summary = await returned(await pdf("annotated-questions.pdf"));
    expect(summary).toMatchObject({ new: 5, questions: 3 });
    await c.indexed();
    const questions = await listed(c);
    expect(
      questions
        .map((q) => [q.question, q.context, q.from, q.page, q.annotation])
        .sort()
    ).toEqual([
      ["Are spindles the mechanism", "ingest", "[[rasch2013]]", 1, "h1"],
      ["Does the cue work without sleep?", "ingest", "[[rasch2013]]", 1, "h2"],
      ["Who ran the control?", "ingest", "[[rasch2013]]", 1, "h3"],
    ]);
    const file = await readFile(
      join(vault, "questions", (await readdir(join(vault, "questions")))[0]!),
      "utf8"
    );
    expect(file).toMatch(/^> .+$/m);
  });

  it("carries the quoted passage in the Question's body", async () => {
    const { returned, vault } = await opened();
    await returned(await pdf("annotated-questions.pdf"));
    const bodies = await Promise.all(
      (await readdir(join(vault, "questions"))).map((f) =>
        readFile(join(vault, "questions", f), "utf8")
      )
    );
    expect(
      bodies.some((b) => b.includes("> Participants who heard the odor cue"))
    ).toBe(true);
  });

  it("does not spawn for Q: alone or for Q ; a near miss", async () => {
    const { returned, c } = await opened();
    await returned(await pdf("annotated-questions.pdf"));
    await c.indexed();
    const texts = (await listed(c)).map((q) => q.question);
    expect(texts).toHaveLength(3);
    expect(texts.join("|")).not.toMatch(/near miss/);
  });

  it("never makes a second when the same PDF returns, and records the Question in the sidecar", async () => {
    const { returned, c, events, sidecar, vault } = await opened();
    await returned(await pdf("annotated-questions.pdf"));
    const first = await sidecar();
    expect(
      first.annotations.filter((a) => typeof a["question"] === "string")
    ).toHaveLength(3);
    // The same bytes rewritten, as a sync client does: no change, no Question.
    await writeFile(
      join(vault, "sources/pdf/rasch2013.pdf"),
      await pdf("annotated-questions.pdf")
    );
    // Nothing is read, so there is nothing to wait on but the time a run would
    // take, twice over: the PDF settles, the run window goes quiet, and then the
    // run. `indexed()` answers at once, before any of that, so this test used to
    // read the Questions before an Ingest could have made a second (#553).
    await expect(
      events.next("ingestLanded", { timeoutMs: 2 * WIDEST_WAIT_MS })
    ).rejects.toThrow();
    expect(await listed(c)).toHaveLength(3);
  });

  it("is spawned on the Ingest where a Preview pass added the prefix to an old highlight", async () => {
    const { returned, c } = await opened();
    // Same highlight, no `Q:`; then the same one, matched by its text, with it.
    await returned(await pdf("annotated.pdf"));
    await c.indexed();
    expect(await listed(c)).toHaveLength(0);
    const summary = await returned(await pdf("annotated-questions.pdf"));
    await c.indexed();
    expect(summary.questions).toBeGreaterThanOrEqual(1);
    expect(
      (await listed(c)).filter(
        (q) => q.question === "Does the cue work without sleep?"
      )
    ).toHaveLength(1);
  });

  it("makes no second Question when the PDF comes back changed, and leaves it alone when the prefix goes", async () => {
    const { returned, c } = await opened();
    await returned(await pdf("annotated-questions.pdf"));
    await c.indexed();
    const spawned = (await listed(c)).length;
    // The prefix removed from the highlight's note, matched by its text.
    await returned(await pdf("annotated.pdf"));
    // And restored: the identity already spawned, so it does not again.
    await returned(await pdf("annotated-questions.pdf"));
    await c.indexed();
    const cue = (await listed(c)).filter(
      (q) => q.question === "Does the cue work without sleep?"
    );
    expect(cue).toHaveLength(1);
    expect((await listed(c)).length).toBeGreaterThanOrEqual(spawned);
  });
});

describe("the Q: prefix", () => {
  it.each([
    ["Q: why", "why"],
    ["q: why", "why"],
    [" Q: why", "why"],
    ["\tq:why  ", "why"],
    ["Q:x", "x"],
    ["Q:", null],
    ["Q:   ", null],
    ["Q ;", null],
    ["Q ; why", null],
    ["why Q: not at the start", null],
    ["", null],
  ])("reads %j as %j", (note, expected) => {
    expect(questionText(note)).toBe(expected);
  });
});
