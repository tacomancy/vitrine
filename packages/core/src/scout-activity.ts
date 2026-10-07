import type { DatabaseSync } from "node:sqlite";
import { readScouts, type Scout } from "./scout-file.js";
import {
  ago,
  finishedRuns,
  healthOf,
  unreadableHealth,
  type Health,
} from "./scout-health.js";
import { acceptCounts, type AcceptCounts } from "./triage.js";
import { NO_KEY } from "./watched.js";

const THIRTY_DAYS_MS = 30 * 86_400_000;

/**
 * What a Scout found in the trailing thirty days (ADR 0042 decision 10).
 * Credited to the Scout of a Proposal's first Appearance, the credit
 * `acceptCounts` uses, so volume and Accept rate cannot disagree. A Held
 * Proposal is work the vault already had, so it is counted on its own and not
 * as a find.
 */
export type Volume = {
  proposals: number;
  held: number;
  /** Of `proposals`, how many another Scout also found — a Scout that only echoes another. */
  alsoFoundElsewhere: number;
};

/**
 * *cost / run*: one figure, the mean over the trailing thirty days' runs that
 * called a model (ADR 0042 decision 6). A Scout with none has no figure to
 * give and says so — never `$0.00`, which would read as spend. `perRun` is
 * null when every such run was on a model the price table does not know: the
 * tokens are real and the dollars would be invented.
 */
export type Cost =
  | { kind: "no model call" }
  | { kind: "cost"; perRun: number | null; runs: number; unpriced: number };

/** The window the headline rate reads: twelve weeks, the one the weekly chart will draw (ADR 0042 decision 2). */
const WINDOW_MS = 12 * 7 * 86_400_000;

/**
 * What a row says about how often its Scout's Review items are accepted. A
 * Scout nobody has judged is *nothing triaged yet*, never 0%: not having
 * judged is not having rejected. A rate that rests on fields the source
 * arrives without is *unavailable*, stated as why (ADR 0042 decision 3).
 */
export type AcceptRate =
  | { kind: "rate"; accepted: number; triaged: number; rate: number }
  | { kind: "nothing triaged" }
  | { kind: "unavailable"; reason: string };

/**
 * The guard tests only the fields the source is expected to supply: arXiv
 * carries a venue only when a paper has a `journal_ref`, so counting it missing
 * would have withheld every arXiv Scout's rate (ADR 0042 decision 3). It is a
 * fact about the measure, never a health state: the items verified.
 */
function acceptRateOf(
  scout: Scout,
  counts: AcceptCounts | undefined
): AcceptRate {
  // `acceptCounts` groups only the rows it counts, so a Scout it names has at least one.
  if (counts === undefined) return { kind: "nothing triaged" };
  const triaged = counts.accepted + counts.rejected;
  const missing = [
    ...(counts.noAuthors * 2 >= triaged ? ["authors"] : []),
    ...(scout.source.kind === "watched" && counts.noVenue * 2 >= triaged
      ? ["venue"]
      : []),
  ];
  if (missing.length > 0) {
    return {
      kind: "unavailable",
      reason: `Most of this Scout's papers arrive without ${missing.join(" or ")}.`,
    };
  }
  return {
    kind: "rate",
    accepted: counts.accepted,
    triaged,
    rate: counts.accepted / triaged,
  };
}

/**
 * What Scout Activity draws, in one read (ADR 0042; `docs/architecture.md`
 * § Scout Activity). Every row's `health` is `healthOf`'s — the derivation the
 * Queue's rail and Loose Ends read — handed over whole, so the screen renders
 * a Scout's Voice, Warrant and fault sentence and never words one of its own:
 * the three surfaces cannot describe a Scout three ways (ADR 0032 decision 7).
 */
export type ActivityRow =
  | {
      kind: "scout";
      id: string;
      name: string;
      /** What it watches: an arXiv Query, or the one page a Watched source reads. */
      source:
        { kind: "arxiv"; query: string } | { kind: "watched"; url: string };
      cadence: Scout["cadence"];
      /**
       * The newest check that looked, whatever came of it; null before the
       * first. A check refused for want of a key read nothing, so it is not
       * one: a Scout waiting on a key must not show a time it did not look
       * (ADR 0040, Consequences; ADR 0042 decision 6). `ago` is the phrase a
       * Quiet field's Warrant uses for its own newest run, so one row never
       * gives that moment two wordings.
       */
      lastRun: { finished: string; ago: string } | null;
      health: Health;
      acceptRate: AcceptRate;
      volume: Volume;
      cost: Cost;
    }
  /** A Scout file that does not parse is still a row, by its file name: it is a Scout the researcher made, and a table that left it out would hide the one that needs a look (ADR 0039 decision 7). */
  | { kind: "unreadable"; file: string; health: Health };

/**
 * The fleet's source health, counted by fault only (ADR 0042 decision 8, and
 * the brief's *no badges*): *10 parsing cleanly · 1 not parsing · 1 no key*.
 * A Scout that is paused or has not run yet is in none of them — it has said
 * nothing about its source — and a quiet one is *parsing cleanly*, never a
 * count of its own, so a field of working Scouts that found nothing is not a
 * number to feel bad about.
 */
export type FleetSource = {
  parsingCleanly: number;
  /** The source answered and its answer would not read: a parse or extraction fault, or a Scout file that will not parse. */
  notParsing: number;
  /** The check never got an answer to read: the network, an HTTP error, a rate limit, a model fault or an interrupted run. */
  notReached: number;
  keyRejected: number;
  noKey: number;
};

export type ScoutActivity = { rows: ActivityRow[]; fleet: FleetSource };

/**
 * Where a row sits by need (ADR 0042 decision 8): faults, then Scouts that are
 * not looking, then everything else. It reads the Voice the row already
 * carries, so the order and the words beside it cannot disagree about a Scout.
 */
const NEED = { wrong: 0, "not yet": 1, claim: 2 } as const;

/** After every rate: a Scout whose rate cannot be said, then one nobody has judged. */
const RATE_TAIL = { rate: 0, unavailable: 1, "nothing triaged": 2 } as const;

/** A file that will not parse has judged nothing, so it sorts with the Scouts nobody has. */
const rateOrder = (row: ActivityRow) =>
  RATE_TAIL[row.kind === "scout" ? row.acceptRate.kind : "nothing triaged"];
/** Only meaningful among `kind: "rate"` rows: `byNeed` compares `rateOrder` first. */
const rateOf = (row: ActivityRow) =>
  row.kind === "scout" && row.acceptRate.kind === "rate"
    ? row.acceptRate.rate
    : 0;

const labelOf = (row: ActivityRow) =>
  row.kind === "scout" ? row.name : row.file;

/** Stable on name: `localeCompare` for people's names, then the file or id, so two Scouts named alike keep one order. */
const byNeed = (a: ActivityRow, b: ActivityRow) =>
  NEED[a.health.voice] - NEED[b.health.voice] ||
  rateOrder(a) - rateOrder(b) ||
  rateOf(a) - rateOf(b) ||
  labelOf(a).localeCompare(labelOf(b)) ||
  (a.kind === "scout" && b.kind === "scout" ? a.id.localeCompare(b.id) : 0);

function sourceHealth(rows: ActivityRow[]): FleetSource {
  const count = (keep: (health: Health) => boolean) =>
    rows.filter((row) => keep(row.health)).length;
  return {
    parsingCleanly: count((h) => h.voice === "claim"),
    // A fault is named for what failed: calling a rejected key or a dropped
    // connection "not parsing" would say the page was bad when it was not.
    notParsing: count(
      (h) =>
        h.voice === "wrong" &&
        (h.kind === null || h.kind === "parse" || h.kind === "extraction")
    ),
    notReached: count(
      (h) =>
        h.voice === "wrong" &&
        (h.kind === "network" ||
          h.kind === "http" ||
          h.kind === "rate_limited" ||
          h.kind === "interrupted" ||
          h.kind === "model")
    ),
    keyRejected: count((h) => h.voice === "wrong" && h.kind === "credentials"),
    // `kind: "credentials"` is set on a *not yet* Health only for a Scout
    // waiting on a key (scout-health.ts), so it is the no-key test.
    noKey: count((h) => h.voice === "not yet" && h.kind === "credentials"),
  };
}

/** The run `healthOf` answers *not yet* for (ADR 0040 decision 1): it fetched nothing, so it is not a time the Scout looked. */
const looked = (run: {
  error_kind: string | null;
  error_message: string | null;
}) => !(run.error_kind === "credentials" && run.error_message === NO_KEY);

function volumes(queue: DatabaseSync, since: string): Map<string, Volume> {
  // The first Appearance by run id then rowid, as `acceptCounts` reads it.
  const found = queue
    .prepare(
      `SELECT (SELECT scout_id FROM appearances WHERE proposal_id = p.id
                ORDER BY run_id, rowid LIMIT 1) AS scoutId,
              p.state = 'held' AS held,
              EXISTS (SELECT 1 FROM appearances a WHERE a.proposal_id = p.id
                       AND a.scout_id <> (SELECT scout_id FROM appearances
                                           WHERE proposal_id = p.id
                                           ORDER BY run_id, rowid LIMIT 1)) AS elsewhere
         FROM proposals p
        WHERE p.first_seen >= ?`
    )
    .all(since) as Array<{
    scoutId: string | null;
    held: number;
    elsewhere: number;
  }>;
  const byScout = new Map<string, Volume>();
  for (const f of found) {
    if (f.scoutId === null) continue;
    const v = byScout.get(f.scoutId) ?? {
      proposals: 0,
      held: 0,
      alsoFoundElsewhere: 0,
    };
    if (f.held === 1) v.held += 1;
    else {
      v.proposals += 1;
      v.alsoFoundElsewhere += f.elsewhere;
    }
    byScout.set(f.scoutId, v);
  }
  return byScout;
}

type SpentRow = { input_tokens: number | null; cost_usd: number | null };

function costOf(runs: SpentRow[]): Cost {
  const modelRuns = runs.filter((run) => run.input_tokens !== null);
  if (modelRuns.length === 0) return { kind: "no model call" };
  const priced = modelRuns.flatMap((run) =>
    run.cost_usd === null ? [] : [run.cost_usd]
  );
  return {
    kind: "cost",
    perRun:
      priced.length === 0
        ? null
        : priced.reduce((sum, usd) => sum + usd, 0) / priced.length,
    runs: modelRuns.length,
    unpriced: modelRuns.length - priced.length,
  };
}

/** Finished runs in the window that looked: a `no key` run fetched nothing and is no run (ADR 0042 decision 6). */
function spentRuns(queue: DatabaseSync, scoutId: string, since: string) {
  return finishedRuns(queue, scoutId).filter(
    (run) => looked(run) && run.finished >= since
  );
}

/** One run in the list behind a row; `tokens` null is a run that made no model call. */
export type ScoutRunCost = {
  runId: number;
  finished: string;
  model: string | null;
  tokens: { input: number; output: number; cacheRead: number } | null;
  costUsd: number | null;
};

export function readRunCosts(
  queue: DatabaseSync,
  scoutId: string
): ScoutRunCost[] {
  return finishedRuns(queue, scoutId)
    .filter(looked)
    .sort((a, b) => b.finished.localeCompare(a.finished) || b.id - a.id)
    .map((run) => ({
      runId: run.id,
      finished: run.finished,
      model: run.model,
      tokens:
        run.input_tokens === null
          ? null
          : {
              input: run.input_tokens,
              output: run.output_tokens ?? 0,
              cacheRead: run.cache_read_tokens ?? 0,
            },
      costUsd: run.cost_usd,
    }));
}

export async function readActivity(deps: {
  vaultPath: string;
  queue: DatabaseSync;
  now: () => Date;
}): Promise<ScoutActivity> {
  const { scouts, unreadable } = await readScouts(deps.vaultPath);
  const now = deps.now();
  const counts = acceptCounts(
    deps.queue,
    new Date(now.getTime() - WINDOW_MS).toISOString()
  );
  const since = new Date(now.getTime() - THIRTY_DAYS_MS).toISOString();
  const found = volumes(deps.queue, since);
  const rows = [
    ...scouts.map((scout): ActivityRow => {
      const newest = finishedRuns(deps.queue, scout.id).filter(looked).at(-1);
      return {
        kind: "scout",
        id: scout.id,
        name: scout.name,
        source:
          scout.source.kind === "watched"
            ? { kind: "watched", url: scout.source.url }
            : { kind: "arxiv", query: scout.query },
        cadence: scout.cadence,
        lastRun:
          newest === undefined
            ? null
            : {
                finished: newest.finished,
                ago: ago(now.getTime() - Date.parse(newest.finished)),
              },
        health: healthOf(deps.queue, scout, now),
        acceptRate: acceptRateOf(
          scout,
          counts.find((c) => c.scoutId === scout.id)
        ),
        volume: found.get(scout.id) ?? {
          proposals: 0,
          held: 0,
          alsoFoundElsewhere: 0,
        },
        cost: costOf(spentRuns(deps.queue, scout.id, since)),
      };
    }),
    ...unreadable.map((file): ActivityRow => ({
      kind: "unreadable",
      file: file.file,
      health: unreadableHealth(file),
    })),
  ].sort(byNeed);
  return { rows, fleet: sourceHealth(rows) };
}
