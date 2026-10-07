import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { ScoutActivity, ScoutRunCost } from "./scout-activity.js";
import { closeCores, core, fixtureCopy } from "./test-core.js";

afterEach(closeCores);

// What a Scout found and what it costs (#517; ADR 0042 decisions 6 and 10).
// The queue is seeded directly — what is asserted is the figure a row carries.

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
  const row = async (scoutId: string) => {
    const r = await c.query<ScoutActivity>("scouts.activity");
    expect(r.error).toBeUndefined();
    const found = r.result!.data.rows.find(
      (row) => row.kind === "scout" && row.id === scoutId
    );
    if (found?.kind !== "scout") throw new Error("no such row");
    return found;
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
    /** A finished run, `ago` days back, with what the model call (if any) spent. */
    cost(
      scout: string,
      ago: number,
      spent: {
        model?: string;
        tokens?: [number, number];
        usd?: number | null;
        error?: "no key";
      } = {}
    ) {
      db.prepare(
        `INSERT INTO scout_runs (scout_id, started, finished, outcome, error_kind, error_message, window_from, window_to, model, input_tokens, output_tokens, cache_read_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        scout,
        daysAgo(ago),
        daysAgo(ago),
        spent.error === undefined ? "ok" : "failed",
        spent.error === undefined ? null : "credentials",
        spent.error ?? null,
        daysAgo(ago + 1),
        daysAgo(ago),
        spent.model ?? null,
        spent.tokens?.[0] ?? null,
        spent.tokens?.[1] ?? null,
        spent.tokens === undefined ? null : 0,
        spent.usd ?? null
      );
    },
    volume: async (scoutId: string) => (await row(scoutId)).volume,
    spend: async (scoutId: string) => (await row(scoutId)).cost,
    runs: async (scoutId: string) => {
      const r = await c.query<ScoutRunCost[]>("scouts.runCosts", { scoutId });
      expect(r.error).toBeUndefined();
      return r.result!.data;
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

describe("a row's volume", () => {
  it("counts new Proposals over the trailing thirty days, and none older", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    times(3, () => f.seed("s", { ago: 5 }));
    f.seed("s", { ago: 40 });

    expect(await f.volume("s")).toEqual({
      proposals: 3,
      held: 0,
      alsoFoundElsewhere: 0,
    });
  });

  it("credits a card two Scouts found to the first Appearance, and says the other also found it, counting once", async () => {
    const f = await opened({
      "first.yaml": arxivScout("first"),
      "second.yaml": arxivScout("second"),
    });
    f.seed("second", { firstBy: "first" });
    f.seed("second");

    expect(await f.volume("first")).toEqual({
      proposals: 1,
      held: 0,
      alsoFoundElsewhere: 1,
    });
    expect(await f.volume("second")).toEqual({
      proposals: 1,
      held: 0,
      alsoFoundElsewhere: 0,
    });
  });

  it("leaves Held Proposals out of the count and counts them on their own", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    f.seed("s");
    times(2, () => f.seed("s", { held: true }));

    expect(await f.volume("s")).toMatchObject({ proposals: 1, held: 2 });
  });
});

describe("a row's cost", () => {
  it("says no model call for a Scout whose runs never called one, never $0.00", async () => {
    const f = await opened({ "s.yaml": arxivScout("s") });
    f.cost("s", 1);

    expect(await f.spend("s")).toEqual({ kind: "no model call" });
  });

  it("is the mean over the thirty days' runs that called a model, ignoring older ones and runs that did not", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    f.cost("w", 1, {
      model: "claude-sonnet-5-5",
      tokens: [100, 10],
      usd: 0.02,
    });
    f.cost("w", 2, {
      model: "claude-sonnet-5-5",
      tokens: [100, 10],
      usd: 0.04,
    });
    f.cost("w", 3);
    f.cost("w", 45, { model: "claude-sonnet-5-5", tokens: [100, 10], usd: 9 });

    const spend = await f.spend("w");
    expect(spend).toMatchObject({ kind: "cost", runs: 2, unpriced: 0 });
    expect(spend.kind === "cost" ? spend.perRun : null).toBeCloseTo(0.03, 10);
  });

  it("is unpriced, with no figure, when every model run has tokens and no price", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    f.cost("w", 1, { model: "odd-model", tokens: [100, 10], usd: null });

    expect(await f.spend("w")).toEqual({
      kind: "cost",
      perRun: null,
      runs: 1,
      unpriced: 1,
    });
  });

  it("leaves a no key run out of every count", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    f.cost("w", 1, { error: "no key" });

    expect(await f.spend("w")).toEqual({ kind: "no model call" });
    expect(await f.runs("w")).toEqual([]);
  });
});

describe("scouts.runCosts — the list behind a row", () => {
  it("is newest first, with each run's tokens and cost, and unpriced where there is no price", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    f.cost("w", 3, {
      model: "claude-sonnet-5-5",
      tokens: [100, 10],
      usd: 0.02,
    });
    f.cost("w", 1, { model: "odd-model", tokens: [50, 5], usd: null });
    f.cost("w", 2);

    expect(
      (await f.runs("w")).map((r) => [r.model, r.tokens, r.costUsd])
    ).toEqual([
      ["odd-model", { input: 50, output: 5, cacheRead: 0 }, null],
      [null, null, null],
      ["claude-sonnet-5-5", { input: 100, output: 10, cacheRead: 0 }, 0.02],
    ]);
  });
});
