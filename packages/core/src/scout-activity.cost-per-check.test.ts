import { afterEach, describe, expect, it } from "vitest";
import type {
  ActivityRow,
  ScoutActivity,
  ScoutCheckCost,
} from "./scout-activity.js";
import { daysAgo, openedWithQueue, watchedScout } from "./scout-queue-seed.js";
import { closeCores } from "./test-core.js";
import { NO_KEY } from "./watched.js";

afterEach(closeCores);

// Cost per run for a Scout of several pages (#915; ADR 0056 decision 9): a
// check's cost is its rows' sum, the figure is the mean over checks, and the
// opened row gives each page's mean. The queue is seeded directly.

const RESEARCH = "https://lab.example/research";
const NEWS = "https://lab.example/news";
const BLOG = "https://lab.example/blog";

const severalPages = (...pages: string[]) =>
  `name: Lab\ncadence: weekly\nlane: review\ncreated: 2026-06-01T00:00:00Z\nsource:\n  kind: watched\n  urls:\n${pages.map((p) => `    - ${p}`).join("\n")}\n`;

type Row = {
  /** The page the run asked; null for a row from before the column. */
  page: string | null;
  usd?: number | null;
  model?: string;
  /** A run whose model call returned usage. Off for a feed read. */
  called?: boolean;
  noKey?: boolean;
};

const SONNET = "claude-sonnet-5-5";

async function opened(scouts: Record<string, string>) {
  const { c, db } = await openedWithQueue(scouts);
  const insert = (
    scout: string,
    ago: number,
    row: Row,
    checkId: number | null
  ) => {
    const called = row.called ?? true;
    const result = db
      .prepare(
        `INSERT INTO scout_runs (scout_id, started, finished, outcome, error_kind, error_message, window_from, window_to, query, model, input_tokens, output_tokens, cache_read_tokens, cost_usd, check_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        scout,
        daysAgo(ago),
        daysAgo(ago),
        row.noKey === true ? "failed" : "ok",
        row.noKey === true ? "credentials" : null,
        row.noKey === true ? NO_KEY : null,
        daysAgo(ago + 1),
        daysAgo(ago),
        row.page,
        called ? (row.model ?? SONNET) : null,
        called ? 100 : null,
        called ? 10 : null,
        called ? 0 : null,
        row.usd ?? null,
        checkId
      );
    return Number(result.lastInsertRowid);
  };
  return {
    /** One check, `ago` days back: one row per page, sharing a `check_id`. */
    check: (scout: string, ago: number, rows: Row[]) => {
      const first = insert(scout, ago, rows[0]!, null);
      db.prepare("UPDATE scout_runs SET check_id = id WHERE id = ?").run(first);
      for (const row of rows.slice(1)) insert(scout, ago, row, first);
    },
    /** A row from before `check_id`, which stands as a check of its own. */
    legacy: (scout: string, ago: number, row: Row) =>
      insert(scout, ago, row, null),
    row: async (scoutId: string) => {
      const r = await c.query<ScoutActivity>("scouts.activity");
      expect(r.error).toBeUndefined();
      const found = r.result!.data.rows.find(
        (row: ActivityRow) => row.kind === "scout" && row.id === scoutId
      );
      if (found?.kind !== "scout") throw new Error("no such row");
      return found;
    },
    checks: async (scoutId: string) => {
      const r = await c.query<ScoutCheckCost[]>("scouts.runCosts", { scoutId });
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
  };
}

describe("a Scout of several pages: cost per run is per check", () => {
  it("is the mean over checks of each check's summed rows, not the mean of its rows", async () => {
    const f = await opened({ "lab.yaml": severalPages(RESEARCH, NEWS) });
    f.check("lab", 1, [
      { page: RESEARCH, usd: 0.02 },
      { page: NEWS, usd: 0.04 },
    ]);
    f.check("lab", 8, [
      { page: RESEARCH, usd: 0.04 },
      { page: NEWS, usd: 0.06 },
    ]);

    // Checks of 0.06 and 0.10: a mean of rows would say 0.04 over 4 runs.
    const { cost } = await f.row("lab");
    expect(cost).toMatchObject({ kind: "cost", runs: 2, unpriced: 0 });
    expect(cost.kind === "cost" ? cost.perRun : null).toBeCloseTo(0.08, 10);
  });

  it("counts a check whose feed page called no model at its other pages' cost, and leaves out a check where no page called one", async () => {
    const f = await opened({ "lab.yaml": severalPages(RESEARCH, BLOG) });
    f.check("lab", 1, [
      { page: RESEARCH, usd: 0.03 },
      { page: BLOG, called: false },
    ]);
    f.check("lab", 8, [
      { page: RESEARCH, called: false },
      { page: BLOG, called: false },
    ]);

    expect((await f.row("lab")).cost).toEqual({
      kind: "cost",
      perRun: 0.03,
      runs: 1,
      unpriced: 0,
    });
  });

  it("says no model call when every page of every check is a feed", async () => {
    const f = await opened({ "lab.yaml": severalPages(RESEARCH, BLOG) });
    f.check("lab", 1, [
      { page: RESEARCH, called: false },
      { page: BLOG, called: false },
    ]);

    expect((await f.row("lab")).cost).toEqual({ kind: "no model call" });
  });

  it("treats an unpriced row as now, row by row: out of its check's sum, counted beside the mean", async () => {
    const f = await opened({ "lab.yaml": severalPages(RESEARCH, NEWS) });
    f.check("lab", 1, [
      { page: RESEARCH, usd: 0.05 },
      { page: NEWS, model: "odd-model" },
    ]);

    expect((await f.row("lab")).cost).toEqual({
      kind: "cost",
      perRun: 0.05,
      runs: 1,
      unpriced: 1,
    });
  });

  it("is unpriced when no check has a priced row, counting the checks", async () => {
    const f = await opened({ "lab.yaml": severalPages(RESEARCH, NEWS) });
    f.check("lab", 1, [
      { page: RESEARCH, model: "odd-model" },
      { page: NEWS, model: "odd-model" },
    ]);

    expect((await f.row("lab")).cost).toEqual({ kind: "unpriced", runs: 1 });
  });

  it("leaves a no key row out of its check's sum, whatever it says it spent", async () => {
    const f = await opened({ "lab.yaml": severalPages(RESEARCH, NEWS) });
    f.check("lab", 1, [
      { page: RESEARCH, usd: 0.02 },
      { page: NEWS, usd: 9, noKey: true },
    ]);

    expect((await f.row("lab")).cost).toEqual({
      kind: "cost",
      perRun: 0.02,
      runs: 1,
      unpriced: 0,
    });
  });

  it("stands a row from before check_id as a check of its own, so a one-page Scout's figure is unchanged", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    f.legacy("w", 1, { page: null, usd: 0.02 });
    f.legacy("w", 2, { page: null, usd: 0.04 });

    const { cost } = await f.row("w");
    expect(cost).toMatchObject({ kind: "cost", runs: 2, unpriced: 0 });
    expect(cost.kind === "cost" ? cost.perRun : null).toBeCloseTo(0.03, 10);
  });
});

describe("the opened row's mean per page", () => {
  it("gives each current page its own mean, in file order, so the costly page can be found", async () => {
    const f = await opened({ "lab.yaml": severalPages(RESEARCH, NEWS, BLOG) });
    f.check("lab", 1, [
      { page: RESEARCH, usd: 0.02 },
      { page: NEWS, usd: 0.3 },
      { page: BLOG, called: false },
    ]);
    f.check("lab", 8, [
      { page: RESEARCH, usd: 0.04 },
      { page: NEWS, usd: 0.5 },
      { page: BLOG, called: false },
    ]);

    const { pageCosts } = await f.row("lab");
    expect(pageCosts.map((p) => p.page)).toEqual([RESEARCH, NEWS, BLOG]);
    const [research, news, blog] = pageCosts.map((p) => p.cost);
    expect(research).toMatchObject({ kind: "cost", runs: 2, unpriced: 0 });
    expect(research?.kind === "cost" ? research.perRun : null).toBeCloseTo(
      0.03,
      10
    );
    expect(news).toMatchObject({ kind: "cost", runs: 2, unpriced: 0 });
    expect(news?.kind === "cost" ? news.perRun : null).toBeCloseTo(0.4, 10);
    expect(blog).toEqual({ kind: "no model call" });
  });

  it("draws no line for a removed page, whose spend still counts in the Scout's figure", async () => {
    const f = await opened({ "lab.yaml": severalPages(RESEARCH, NEWS) });
    f.check("lab", 1, [
      { page: RESEARCH, usd: 0.02 },
      { page: NEWS, usd: 0.02 },
      { page: BLOG, usd: 0.06 },
    ]);

    const row = await f.row("lab");
    expect(row.pageCosts.map((p) => p.page)).toEqual([RESEARCH, NEWS]);
    expect(row.cost.kind === "cost" ? row.cost.perRun : null).toBeCloseTo(
      0.1,
      10
    );
  });

  it("is empty for a Structured source, which has no pages", async () => {
    const { arxivScout } = await import("./scout-queue-seed.js");
    const f = await opened({ "s.yaml": arxivScout("s") });

    expect((await f.row("s")).pageCosts).toEqual([]);
  });
});

describe("scouts.runCosts — checks, each with its pages beneath", () => {
  it("lists checks newest first, each with its sum and the rows the sum is of", async () => {
    const f = await opened({ "lab.yaml": severalPages(RESEARCH, NEWS, BLOG) });
    f.check("lab", 8, [
      { page: RESEARCH, usd: 0.04 },
      { page: NEWS, usd: 0.06 },
    ]);
    f.check("lab", 1, [
      { page: RESEARCH, usd: 0.02 },
      { page: NEWS, model: "odd-model" },
      { page: BLOG, called: false },
    ]);

    const checks = await f.checks("lab");
    expect(
      checks.map((c) => [
        c.ago,
        c.costUsd,
        c.runs.map((r) => [r.page, r.costUsd]),
      ])
    ).toEqual([
      [
        "1 day ago",
        0.02,
        [
          [RESEARCH, 0.02],
          [NEWS, null],
        ],
      ],
      [
        "8 days ago",
        expect.closeTo(0.1, 10),
        [
          [RESEARCH, 0.04],
          [NEWS, 0.06],
        ],
      ],
    ]);
  });

  it("has no sum for a check whose every row is unpriced: a figure there would be invented", async () => {
    const f = await opened({ "lab.yaml": severalPages(RESEARCH, NEWS) });
    f.check("lab", 1, [
      { page: RESEARCH, model: "odd-model" },
      { page: NEWS, model: "odd-model" },
    ]);

    expect((await f.checks("lab")).map((c) => c.costUsd)).toEqual([null]);
  });

  it("lists each row from before check_id as a check of one run", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    f.legacy("w", 2, { page: null, usd: 0.04 });
    f.legacy("w", 1, { page: null, usd: 0.02 });

    expect(
      (await f.checks("w")).map((c) => [c.ago, c.costUsd, c.runs.length])
    ).toEqual([
      ["1 day ago", 0.02, 1],
      ["2 days ago", 0.04, 1],
    ]);
  });
});
