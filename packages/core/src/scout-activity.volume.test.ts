import { afterEach, describe, expect, it } from "vitest";
import type {
  ActivityRow,
  ScoutActivity,
  ScoutRunCost,
} from "./scout-activity.js";
import {
  arxivScout,
  daysAgo,
  openedWithQueue,
  watchedScout,
} from "./scout-queue-seed.js";
import { closeCores } from "./test-core.js";
import { NO_KEY } from "./watched.js";

afterEach(closeCores);

// What a Scout found and what it costs (#517; ADR 0042 decisions 6 and 10).
// The queue is seeded directly — what is asserted is the figure a row carries.

type Spent = {
  model?: string;
  /** Input and output tokens: a run whose model call returned usage. */
  tokens?: readonly [number, number];
  cached?: number;
  usd?: number | null;
  /** A run that ended in a fault rather than clean. */
  failed?: { kind: string; message: string };
};

async function opened(scouts: Record<string, string>) {
  const { c, db, seed } = await openedWithQueue(scouts);
  const row = async (scoutId: string) => {
    const r = await c.query<ScoutActivity>("scouts.activity");
    expect(r.error).toBeUndefined();
    const found = r.result!.data.rows.find(
      (row: ActivityRow) => row.kind === "scout" && row.id === scoutId
    );
    if (found?.kind !== "scout") throw new Error("no such row");
    return found;
  };
  return {
    seed,
    /** A finished run, `ago` days back, and what its model call (if any) spent. */
    run: (scout: string, ago: number, spent: Spent = {}) => {
      db.prepare(
        `INSERT INTO scout_runs (scout_id, started, finished, outcome, error_kind, error_message, window_from, window_to, model, input_tokens, output_tokens, cache_read_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        scout,
        daysAgo(ago),
        daysAgo(ago),
        spent.failed === undefined ? "ok" : "failed",
        spent.failed?.kind ?? null,
        spent.failed?.message ?? null,
        daysAgo(ago + 1),
        daysAgo(ago),
        spent.model ?? null,
        spent.tokens?.[0] ?? null,
        spent.tokens?.[1] ?? null,
        spent.tokens === undefined ? null : (spent.cached ?? 0),
        spent.usd ?? null
      );
    },
    row,
    runs: async (scoutId: string) => {
      const r = await c.query<ScoutRunCost[]>("scouts.runCosts", { scoutId });
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
  };
}

const times = (n: number, f: () => void) => {
  for (let i = 0; i < n; i++) f();
};

describe("a row's volume", () => {
  it("counts new Proposals over the trailing thirty days, and none older", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    times(3, () => f.seed("s", { ago: 5 }));
    f.seed("s", { ago: 40 });

    expect((await f.row("s")).volume).toEqual({
      proposals: 3,
      held: 0,
      alsoFoundElsewhere: 0,
    });
  });

  it("counts a Proposal in Skim, which is still a find, and one already triaged", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    f.seed("s", { lane: "skim" });
    f.seed("s", { action: "reject" });

    expect((await f.row("s")).volume).toMatchObject({ proposals: 2 });
  });

  it("credits a card two Scouts found to the first Appearance, says the other also found it, and counts it once", async () => {
    const f = await opened({
      "first.yaml": arxivScout("first"),
      "second.yaml": arxivScout("second"),
    });
    f.seed("second", { firstBy: "first" });
    f.seed("second");

    expect((await f.row("first")).volume).toEqual({
      proposals: 1,
      held: 0,
      alsoFoundElsewhere: 1,
    });
    expect((await f.row("second")).volume).toEqual({
      proposals: 1,
      held: 0,
      alsoFoundElsewhere: 0,
    });
  });

  it("credits the Scout whose run came first even when its Appearance was written last, as the Accept rate does", async () => {
    const f = await opened({
      "first.yaml": arxivScout("first"),
      "second.yaml": arxivScout("second"),
    });
    // Two runs that overlapped: `first` began first and finished writing last.
    f.seed("second", {
      firstBy: "first",
      recordedLast: true,
      action: "accept",
    });

    const first = await f.row("first");
    const second = await f.row("second");
    expect([first.volume.proposals, second.volume.proposals]).toEqual([1, 0]);
    expect(first.acceptRate).toMatchObject({ kind: "rate", triaged: 1 });
    expect(second.acceptRate).toEqual({ kind: "nothing triaged" });
  });

  it("leaves Held Proposals out of the count and counts them on their own", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    f.seed("s");
    times(2, () => f.seed("s", { held: true }));

    expect((await f.row("s")).volume).toEqual({
      proposals: 1,
      held: 2,
      alsoFoundElsewhere: 0,
    });
  });

  it("credits a Held card two Scouts found to the first, which does not count it as also found elsewhere", async () => {
    const f = await opened({
      "first.yaml": arxivScout("first"),
      "second.yaml": arxivScout("second"),
    });
    f.seed("second", { firstBy: "first", held: true });

    expect((await f.row("first")).volume).toEqual({
      proposals: 0,
      held: 1,
      alsoFoundElsewhere: 0,
    });
    expect((await f.row("second")).volume).toEqual({
      proposals: 0,
      held: 0,
      alsoFoundElsewhere: 0,
    });
  });
});

describe("a row's cost", () => {
  it("says no model call for a Scout whose runs never called one, never $0.00", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    f.run("s", 1);

    expect((await f.row("s")).cost).toEqual({ kind: "no model call" });
  });

  it("is the mean over the thirty days' runs that called a model, ignoring older ones and runs that did not call", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    const sonnet = { model: "claude-sonnet-5-5", tokens: [100, 10] } as const;
    f.run("w", 1, { ...sonnet, usd: 0.02 });
    f.run("w", 2, { ...sonnet, usd: 0.04 });
    f.run("w", 3);
    f.run("w", 45, { ...sonnet, usd: 9 });

    const { cost } = await f.row("w");
    expect(cost).toMatchObject({ kind: "cost", runs: 2, unpriced: 0 });
    expect(cost.kind === "cost" ? cost.perRun : null).toBeCloseTo(0.03, 10);
  });

  it("is unpriced when every run that called a model was on a model with no price, and says how many", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    f.run("w", 1, { model: "odd-model", tokens: [100, 10] });
    f.run("w", 2, { model: "odd-model", tokens: [100, 10] });

    expect((await f.row("w")).cost).toEqual({ kind: "unpriced", runs: 2 });
  });

  it("leaves an unpriced run out of the mean and counts it beside it", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    f.run("w", 1, { model: "claude-sonnet-5-5", tokens: [100, 10], usd: 0.5 });
    f.run("w", 2, { model: "odd-model", tokens: [100, 10] });

    expect((await f.row("w")).cost).toEqual({
      kind: "cost",
      perRun: 0.5,
      runs: 1,
      unpriced: 1,
    });
  });

  it("counts a failed extraction that spent tokens, and not a call a rejected key refused", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    f.run("w", 1, {
      model: "claude-sonnet-5-5",
      tokens: [100, 10],
      usd: 0.02,
      failed: { kind: "extraction", message: "feed unreadable" },
    });
    f.run("w", 2, {
      model: "claude-sonnet-5-5",
      failed: { kind: "credentials", message: "key rejected" },
    });

    expect((await f.row("w")).cost).toMatchObject({ kind: "cost", runs: 1 });
  });

  it("leaves a no key run out of the mean, whatever the row says it spent", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    f.run("w", 1, { model: "claude-sonnet-5-5", tokens: [100, 10], usd: 0.02 });
    // A run that never called a model carries no tokens; these are given it so
    // that only the exclusion of a `no key` run, not an accident of null
    // columns, can keep it out.
    f.run("w", 2, {
      model: "claude-sonnet-5-5",
      tokens: [9000, 9000],
      usd: 9,
      failed: { kind: "credentials", message: NO_KEY },
    });

    expect((await f.row("w")).cost).toMatchObject({
      kind: "cost",
      runs: 1,
      perRun: 0.02,
    });
  });
});

describe("scouts.runCosts — the runs behind a row", () => {
  it("lists the runs the figure is the mean of, newest first, with each run's tokens and cost and no cost where there is no price", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    f.run("w", 3, {
      model: "claude-sonnet-5-5",
      tokens: [100, 10],
      cached: 40,
      usd: 0.02,
    });
    f.run("w", 1, { model: "odd-model", tokens: [50, 5] });
    f.run("w", 2);

    expect(
      (await f.runs("w")).map((r) => [r.ago, r.model, r.tokens, r.costUsd])
    ).toEqual([
      ["1 day ago", "odd-model", { input: 50, output: 5, cacheRead: 0 }, null],
      [
        "3 days ago",
        "claude-sonnet-5-5",
        { input: 100, output: 10, cacheRead: 40 },
        0.02,
      ],
    ]);
  });

  it("is only the thirty days the figure reads, and never a no key run", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    f.run("w", 45, { model: "claude-sonnet-5-5", tokens: [100, 10], usd: 9 });
    f.run("w", 1, {
      model: "claude-sonnet-5-5",
      tokens: [100, 10],
      usd: 9,
      failed: { kind: "credentials", message: NO_KEY },
    });

    expect(await f.runs("w")).toEqual([]);
  });

  it("is empty for a Scout that never called a model", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    f.run("s", 1);

    expect(await f.runs("s")).toEqual([]);
  });
});
