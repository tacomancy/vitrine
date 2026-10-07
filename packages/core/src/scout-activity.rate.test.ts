import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { ScoutActivity } from "./scout-activity.js";
import { closeCores, core, fixtureCopy } from "./test-core.js";

afterEach(closeCores);

// The accept rate on a row (#515; ADR 0042 decisions 2 and 3): Review-only,
// net of undone rejects, blind to a Retroactive *reject this run*, and honest
// about when it cannot be said. The triage log is seeded directly — what is
// asserted is the figure a row carries, never how the rows came to be.

const NOW = new Date("2026-09-30T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

const arxivScout = (name: string) =>
  `name: ${name}\ncadence: daily\nlane: review\ncreated: 2026-06-01T00:00:00Z\nfilter:\n  query: all:${name}\n`;
const watchedScout = (name: string) =>
  `name: ${name}\ncadence: weekly\nlane: review\ncreated: 2026-06-01T00:00:00Z\nsource:\n  kind: watched\n  url: https://lab.example/${name}\n`;

type Seed = {
  action?: "accept" | "reject";
  /** Triaged this many days ago. */
  ago?: number;
  lane?: "review" | "skim";
  authors?: string[];
  venue?: string | null;
  promoted?: boolean;
  undone?: boolean;
  held?: boolean;
  /** `reject this run` on a run that was (or was not) a backward search. */
  batch?: { retroactive: boolean };
  /** Another Scout found it first. */
  firstBy?: string;
};

async function opened(scouts: Record<string, string>) {
  const vault = await fixtureCopy("obsidian-vault");
  for (const [file, text] of Object.entries(scouts)) {
    const path = join(vault, ".vitrine/scouts", file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  const c = await core({ now: () => NOW });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const db = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"));
  let n = 0;
  const run = (scout: string, retroactive: boolean) =>
    Number(
      db
        .prepare(
          `INSERT INTO scout_runs (scout_id, started, finished, outcome, window_from, window_to, retroactive)
           VALUES (?, ?, ?, 'ok', ?, ?, ?)`
        )
        .run(
          scout,
          daysAgo(1),
          daysAgo(1),
          daysAgo(2),
          daysAgo(1),
          +retroactive
        ).lastInsertRowid
    );
  const rateOf = async (scoutId: string) => {
    const r = await c.query<ScoutActivity>("scouts.activity");
    expect(r.error).toBeUndefined();
    const row = r.result!.data.rows.find(
      (row) => row.kind === "scout" && row.id === scoutId
    );
    if (row?.kind !== "scout") throw new Error("no such row");
    return row.acceptRate;
  };
  return {
    /** One Proposal this Scout placed, and what the researcher did with it. */
    seed(scout: string, s: Seed = {}) {
      n += 1;
      const firstRun = s.firstBy === undefined ? null : run(s.firstBy, false);
      const ordinary = run(scout, false);
      const batchRun =
        s.batch === undefined ? null : run(scout, s.batch.retroactive);
      const proposal = Number(
        db
          .prepare(
            `INSERT INTO proposals (source_key, title, authors, published, venue, abstract, url, lane, state, first_seen)
             VALUES (?, ?, ?, '2026-01-01', ?, '', 'https://x.example', ?, ?, ?)`
          )
          .run(
            `k${n}`,
            `T${n}`,
            JSON.stringify(s.authors ?? ["A. Author"]),
            s.venue === undefined ? "A Journal" : s.venue,
            s.lane ?? "review",
            s.held === true
              ? "held"
              : s.action === undefined
                ? "pending"
                : s.action === "accept"
                  ? "accepted"
                  : "rejected",
            daysAgo(s.ago ?? 3)
          ).lastInsertRowid
      );
      const appear = (by: string, runId: number) =>
        db
          .prepare(
            "INSERT INTO appearances (proposal_id, run_id, scout_id, seen_at, url) VALUES (?, ?, ?, ?, 'https://x.example')"
          )
          .run(proposal, runId, by, daysAgo(s.ago ?? 3));
      if (s.firstBy !== undefined) appear(s.firstBy, firstRun!);
      appear(scout, ordinary);
      const log = (action: string, batch: number | null = null) =>
        db
          .prepare(
            "INSERT INTO triage (proposal_id, action, at, batch) VALUES (?, ?, ?, ?)"
          )
          .run(proposal, action, daysAgo(s.ago ?? 3), batch);
      if (s.promoted === true) log("promote");
      if (s.action !== undefined) log(s.action, batchRun);
      if (s.undone === true) log("undo");
    },
    rate: rateOf,
    /** The line a row opens to; a rate that cannot be said has none, and that is a failure here. */
    series: async (scoutId: string) => {
      const rate = await rateOf(scoutId);
      if (rate.kind !== "rate") throw new Error(`no line: ${rate.kind}`);
      return rate.weeks;
    },
    health: async (scoutId: string) => {
      const r = await c.query<ScoutActivity>("scouts.activity");
      const row = r.result!.data.rows.find(
        (row) => row.kind === "scout" && row.id === scoutId
      );
      if (row?.kind !== "scout") throw new Error("no such row");
      return row.health;
    },
    ids: async () => {
      const r = await c.query<ScoutActivity>("scouts.activity");
      return r.result!.data.rows.map((row) =>
        row.kind === "scout" ? row.id : row.file
      );
    },
  };
}

const times = (n: number, f: () => void) => {
  for (let i = 0; i < n; i++) f();
};

describe("a row's accept rate", () => {
  it("is accepted over triaged, as a fraction", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    times(3, () => f.seed("s", { action: "accept" }));
    f.seed("s", { action: "reject" });

    expect(await f.rate("s")).toEqual({
      kind: "rate",
      accepted: 3,
      triaged: 4,
      rate: 0.75,
      // What the weeks hold is the next describe's; here the key set is pinned.
      weeks: await f.series("s"),
      weekFloor: 5,
    });
  });

  it("says nothing triaged yet for a Scout whose cards nobody has judged, never 0%", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    f.seed("s");

    expect(await f.rate("s")).toEqual({ kind: "nothing triaged" });
  });

  it("is not moved by an accept the researcher promoted from Skim, nor by a Proposal still in Skim", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    f.seed("s", { action: "reject" });
    f.seed("s", { action: "accept", promoted: true });
    f.seed("s", { action: "accept", lane: "skim" });

    expect(await f.rate("s")).toMatchObject({ accepted: 0, triaged: 1 });
  });

  it("is not moved by a Held Proposal, which the researcher already had", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    f.seed("s", { action: "accept" });
    f.seed("s", { held: true });

    expect(await f.rate("s")).toMatchObject({ accepted: 1, triaged: 1 });
  });

  it("is not moved by a reject this run on a Retroactive run, but a reject this run on an ordinary one counts", async () => {
    const f = await opened({
      "back.yaml": arxivScout("back"),
      "now.yaml": arxivScout("now"),
    });
    f.seed("back", { action: "accept" });
    f.seed("back", { action: "reject", batch: { retroactive: true } });
    f.seed("now", { action: "accept" });
    f.seed("now", { action: "reject", batch: { retroactive: false } });

    expect(await f.rate("back")).toMatchObject({ accepted: 1, triaged: 1 });
    expect(await f.rate("now")).toMatchObject({ accepted: 1, triaged: 2 });
  });

  it("is not moved by a reject the researcher took back", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    f.seed("s", { action: "accept" });
    f.seed("s", { action: "reject", undone: true });

    expect(await f.rate("s")).toMatchObject({ accepted: 1, triaged: 1 });
  });

  it("reads the trailing twelve weeks only", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    f.seed("s", { action: "accept", ago: 83 });
    f.seed("s", { action: "reject", ago: 85 });

    expect(await f.rate("s")).toMatchObject({ accepted: 1, triaged: 1 });
  });

  it("credits the Scout whose Appearance came first", async () => {
    const f = await opened({
      "first.yaml": arxivScout("first"),
      "echo.yaml": arxivScout("echo"),
    });
    f.seed("echo", { action: "accept", firstBy: "first" });

    expect(await f.rate("first")).toMatchObject({ accepted: 1, triaged: 1 });
    expect(await f.rate("echo")).toEqual({ kind: "nothing triaged" });
  });
});

describe("a row's accept rate it cannot say", () => {
  it("is still said for an arXiv Scout whose cards carry no venue, since arXiv rarely supplies one", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    times(4, () => f.seed("s", { action: "accept", venue: null }));

    expect(await f.rate("s")).toMatchObject({ kind: "rate", rate: 1 });
  });

  it("says why for an arXiv Scout whose cards lack authors", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    times(3, () => f.seed("s", { action: "accept", authors: [] }));
    f.seed("s", { action: "reject" });

    expect(await f.rate("s")).toEqual({
      kind: "unavailable",
      reason: "Most of this Scout's papers arrive without authors.",
    });
  });

  it("says why for a Watched Scout whose cards lack a venue", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    times(3, () => f.seed("w", { action: "accept", venue: null }));

    expect(await f.rate("w")).toEqual({
      kind: "unavailable",
      reason: "Most of this Scout's papers arrive without venue.",
    });
  });

  it("names both fields for a Watched Scout lacking authors and venue", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    times(2, () => f.seed("w", { action: "accept", venue: null, authors: [] }));

    expect(await f.rate("w")).toEqual({
      kind: "unavailable",
      reason: "Most of this Scout's papers arrive without authors or venue.",
    });
  });

  it("leaves a health of ok: it is a fact about the measure, never a fault", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    times(2, () => f.seed("w", { action: "accept", venue: null }));
    expect(await f.health("w")).toMatchObject({ voice: "claim" });
  });
});

describe("the fleet's order by accept rate", () => {
  it("runs ascending within a Voice, then unavailable, then nothing triaged", async () => {
    const f = await opened({
      "a.yaml": arxivScout("a"),
      "b.yaml": arxivScout("b"),
      "c.yaml": arxivScout("c"),
      "d.yaml": arxivScout("d"),
      "e.yaml": arxivScout("e"),
    });
    // a: 100 %, b: 50 %, c: nothing triaged, d: unavailable, e: 0 %.
    f.seed("a", { action: "accept" });
    f.seed("b", { action: "accept" });
    f.seed("b", { action: "reject" });
    f.seed("c");
    times(2, () => f.seed("d", { action: "accept", authors: [] }));
    f.seed("e", { action: "reject" });

    expect(await f.ids()).toEqual(["e", "b", "a", "d", "c"]);
  });
});

describe("a row's weekly accept rate", () => {
  it("is twelve weeks, oldest first, the newest ending now", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    times(5, () => f.seed("s", { action: "accept", ago: 1 }));

    const weeks = await f.series("s");
    expect(weeks).toHaveLength(12);
    expect(weeks.at(-1)).toEqual({
      start: daysAgo(7),
      triaged: 5,
      rate: 1,
    });
    expect(weeks[0]!.start).toBe(daysAgo(84));
  });

  it("is a gap for a week with four triaged items and a point for one with five", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    times(4, () => f.seed("s", { action: "accept", ago: 10 }));
    times(4, () => f.seed("s", { action: "accept", ago: 3 }));
    f.seed("s", { action: "reject", ago: 3 });

    const weeks = await f.series("s");
    expect(weeks.at(-2)).toMatchObject({ triaged: 4, rate: null });
    expect(weeks.at(-1)).toMatchObject({ triaged: 5, rate: 0.8 });
  });

  it("is a gap, never a zero, for a week nothing was triaged, and a point for a week of five rejects", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    times(5, () => f.seed("s", { action: "reject", ago: 3 }));

    const weeks = await f.series("s");
    expect(weeks[0]).toEqual({ start: daysAgo(84), triaged: 0, rate: null });
    // A real 0 % rests on five items and is drawn; the empty week is not.
    expect(weeks.at(-1)).toMatchObject({ triaged: 5, rate: 0 });
  });

  it("starts each week at its printed start, so an item stamped at that moment is in that week", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    times(5, () => f.seed("s", { action: "accept", ago: 7 }));
    times(5, () => f.seed("s", { action: "accept", ago: 14 }));

    const weeks = await f.series("s");
    expect(weeks.at(-1)).toEqual({ start: daysAgo(7), triaged: 5, rate: 1 });
    expect(weeks.at(-2)).toEqual({ start: daysAgo(14), triaged: 5, rate: 1 });
  });

  it("puts an item stamped after now in the newest week, where the headline counts it too", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    times(5, () => f.seed("s", { action: "accept", ago: -1 }));

    expect((await f.series("s")).at(-1)).toMatchObject({
      triaged: 5,
      rate: 1,
    });
    expect(await f.rate("s")).toMatchObject({ triaged: 5 });
  });

  it("counts what the headline counts: not a Retroactive reject, not an undone one, not a promoted accept", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    times(5, () => f.seed("s", { action: "accept", ago: 3 }));
    f.seed("s", { action: "reject", ago: 3, batch: { retroactive: true } });
    f.seed("s", { action: "reject", ago: 3, undone: true });
    f.seed("s", { action: "accept", ago: 3, promoted: true });

    expect((await f.series("s")).at(-1)).toMatchObject({
      triaged: 5,
      rate: 1,
    });
  });

  it("credits the Scout whose Appearance came first, as the headline does", async () => {
    const f = await opened({
      "first.yaml": arxivScout("first"),
      "echo.yaml": arxivScout("echo"),
    });
    times(5, () => f.seed("echo", { action: "accept", firstBy: "first" }));

    expect((await f.series("first")).at(-1)).toMatchObject({ triaged: 5 });
    expect(await f.rate("echo")).toEqual({ kind: "nothing triaged" });
  });

  it("keeps a triage from exactly twelve weeks ago, as the headline does", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    times(5, () => f.seed("s", { action: "accept", ago: 84 }));

    expect((await f.series("s"))[0]).toMatchObject({ triaged: 5, rate: 1 });
    expect(await f.rate("s")).toMatchObject({ triaged: 5 });
  });

  it("adds up to the headline: the weeks and the rate rest on the same items", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    times(3, () => f.seed("s", { action: "accept", ago: 2 }));
    times(4, () => f.seed("s", { action: "reject", ago: 9 }));
    times(2, () => f.seed("s", { action: "accept", ago: 40 }));

    const rate = await f.rate("s");
    expect(rate).toMatchObject({ kind: "rate", triaged: 9 });
    expect((await f.series("s")).reduce((n, w) => n + w.triaged, 0)).toBe(9);
  });

  it("is withheld with the headline when the rate cannot be said, and a Scout nobody has judged has none", async () => {
    const f = await opened({
      "bare.yaml": arxivScout("bare"),
      "none.yaml": arxivScout("none"),
    });
    times(5, () => f.seed("bare", { action: "accept", authors: [] }));

    expect(await f.rate("bare")).toEqual({
      kind: "unavailable",
      reason: "Most of this Scout's papers arrive without authors.",
    });
    expect(await f.rate("none")).toEqual({ kind: "nothing triaged" });
  });
});
