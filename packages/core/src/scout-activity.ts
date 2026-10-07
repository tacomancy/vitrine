import type { DatabaseSync } from "node:sqlite";
import { readScouts, type DroppedScout, type Scout } from "./scout-file.js";
import {
  ago,
  finishedRuns,
  healthOf,
  isNoKeyRun,
  unreadableHealth,
  type Health,
  type RunRow,
} from "./scout-health.js";
import {
  NOTHING_WAITING,
  reviewDepth,
  type ReviewDepth,
} from "./review-depth.js";
import {
  acceptCounts,
  acceptSince,
  acceptWeeks,
  firstAppearanceScout,
  MIN_WEEK_ITEMS,
  type AcceptCounts,
  type AcceptWeek,
} from "./triage.js";

/** The window every figure that says *30 days* reads: a count of finds and the mean cost of a run (ADR 0042 decisions 6 and 10). */
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
 * give and says so — never `$0.00`, which would read as spend. A model the
 * price table does not know is *unpriced*: the tokens are real and the dollars
 * would be invented, so such a run is left out of the mean and counted beside
 * it. `runs` is how many runs the mean rests on, as a rate says what it rests
 * on.
 */
export type Cost =
  | { kind: "no model call" }
  | { kind: "unpriced"; runs: number }
  | { kind: "cost"; perRun: number; runs: number; unpriced: number };

/**
 * What a row says about how often its Scout's Review items are accepted. A
 * Scout nobody has judged is *nothing triaged yet*, never 0%: not having
 * judged is not having rejected. A rate that rests on fields the source
 * arrives without is *unavailable*, stated as why (ADR 0042 decision 3).
 *
 * The weekly line belongs to a rate that can be said: the weeks rest on the
 * same items as the headline, so when the guard withholds one it withholds
 * the other, and no surface has to remember to.
 */
export type AcceptRate =
  | {
      kind: "rate";
      accepted: number;
      triaged: number;
      rate: number;
      /** Twelve weeks, oldest first; a week under `weekFloor` items is a gap (ADR 0042 decision 2). */
      weeks: AcceptWeek[];
      weekFloor: number;
    }
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
  counts: AcceptCounts | undefined,
  weeks: AcceptWeek[]
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
    weeks,
    weekFloor: MIN_WEEK_ITEMS,
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
      /**
       * What waits in Review under this Scout's name: the stack the row links
       * to in the Queue. Figures only; whether *nothing pending* may be said
       * as a claim depends on the Voice beside it, which the page reads from
       * `health` as the Queue does.
       */
      review: ReviewDepth;
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

/**
 * A Scout the researcher retired (ADR 0042 decisions 1 and 9): not a row, since
 * it is not looking, but named so the one line at the foot of the table can
 * open to it and bring it back. Its figures are not here because nothing about
 * it is being read; its runs and Proposals are where they were.
 */
export type DroppedRow = { id: string; name: string };

export type ScoutActivity = {
  rows: ActivityRow[];
  fleet: FleetSource;
  /** Review depth fleet-wide, each Proposal once: `reviewDepth`'s own result, which Home (beat 12) reads rather than summing the rows. A dropped Scout's Proposals stay in Review, so they are in it. */
  review: ReviewDepth;
  /** The dropped, by name; empty when none, which is when the page draws no line at all. */
  dropped: DroppedRow[];
};

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

const droppedRows = (dropped: DroppedScout[]): DroppedRow[] =>
  dropped
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

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

/**
 * Finished runs that looked. A `no key` run fetched nothing (ADR 0040 decision
 * 1), so it is neither a time the Scout looked nor a run in any count or mean
 * (ADR 0042 decision 6).
 */
const lookedRuns = (queue: DatabaseSync, scoutId: string) =>
  finishedRuns(queue, scoutId).filter((run) => !isNoKeyRun(run));

type ModelRun = RunRow & { input_tokens: number };

/**
 * The runs a Scout's cost is read over, and the list behind its row: looked,
 * finished in the trailing thirty days, and whose model call returned usage —
 * so the list is exactly the runs the figure is over. Usage and not a model
 * id: a rejected key names the model and spent nothing, while a failed
 * extraction still spent its tokens (`record` in `scouts.ts` writes both).
 * An arXiv run, a feed read and a page unchanged since the last look make no
 * call and leave the tokens null.
 */
function modelRunsSince(
  queue: DatabaseSync,
  scoutId: string,
  since: string
): ModelRun[] {
  return lookedRuns(queue, scoutId).filter(
    (run): run is ModelRun => run.finished >= since && run.input_tokens !== null
  );
}

const thirtyDaysBefore = (now: Date) =>
  new Date(now.getTime() - THIRTY_DAYS_MS).toISOString();

function volumes(queue: DatabaseSync, since: string): Map<string, Volume> {
  // A Proposal is only ever written together with its first Appearance
  // (`arrive` in `scouts.ts`), so every row here is credited to a Scout.
  const credited = queue
    .prepare(
      `SELECT c.scoutId AS scoutId,
              c.state = 'held' AS held,
              EXISTS (SELECT 1 FROM appearances a
                       WHERE a.proposal_id = c.id AND a.scout_id <> c.scoutId) AS elsewhere
         FROM (SELECT p.id, p.state, ${firstAppearanceScout("p.id")} AS scoutId
                 FROM proposals p WHERE p.first_seen >= ?) c`
    )
    .all(since) as Array<{ scoutId: string; held: number; elsewhere: number }>;
  const byScout = new Map<string, Volume>();
  for (const row of credited) {
    const volume = byScout.get(row.scoutId) ?? {
      proposals: 0,
      held: 0,
      alsoFoundElsewhere: 0,
    };
    if (row.held === 1) volume.held += 1;
    else {
      volume.proposals += 1;
      volume.alsoFoundElsewhere += row.elsewhere;
    }
    byScout.set(row.scoutId, volume);
  }
  return byScout;
}

function costOf(runs: ModelRun[]): Cost {
  if (runs.length === 0) return { kind: "no model call" };
  const priced = runs.flatMap((run) =>
    run.cost_usd === null ? [] : [run.cost_usd]
  );
  if (priced.length === 0) return { kind: "unpriced", runs: runs.length };
  return {
    kind: "cost",
    perRun: priced.reduce((sum, usd) => sum + usd, 0) / priced.length,
    runs: priced.length,
    unpriced: runs.length - priced.length,
  };
}

/** One run behind a row's figure: what its model call spent and, where the model is priced, what that cost. */
export type ScoutRunCost = {
  runId: number;
  finished: string;
  /** The phrase a row's *last run* uses, so one moment is never worded two ways. */
  ago: string;
  model: string | null;
  tokens: { input: number; output: number; cacheRead: number };
  /** Null for a model the price table does not know: a figure here would be invented. */
  costUsd: number | null;
};

/** The runs a row's *cost / run* is the mean of, newest first: the second read behind the row (ADR 0042 decision 6). */
export function readRunCosts(
  deps: { queue: DatabaseSync; now: () => Date },
  scoutId: string
): ScoutRunCost[] {
  const now = deps.now();
  return modelRunsSince(deps.queue, scoutId, thirtyDaysBefore(now))
    .sort((a, b) => b.finished.localeCompare(a.finished) || b.id - a.id)
    .map((run) => ({
      runId: run.id,
      finished: run.finished,
      ago: ago(now.getTime() - Date.parse(run.finished)),
      model: run.model,
      tokens: {
        input: run.input_tokens,
        // Written with the input, from one usage: null only where it is.
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
  const { scouts, dropped, unreadable } = await readScouts(deps.vaultPath);
  const now = deps.now();
  const counts = acceptCounts(deps.queue, acceptSince(now));
  const depth = reviewDepth(deps.queue, now);
  const since = thirtyDaysBefore(now);
  const volumeByScout = volumes(deps.queue, since);
  const rows = [
    ...scouts.map((scout): ActivityRow => {
      const newest = lookedRuns(deps.queue, scout.id).at(-1);
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
          counts.find((c) => c.scoutId === scout.id),
          acceptWeeks(deps.queue, scout.id, now)
        ),
        review: depth.byScout.get(scout.id) ?? NOTHING_WAITING,
        volume: volumeByScout.get(scout.id) ?? {
          proposals: 0,
          held: 0,
          alsoFoundElsewhere: 0,
        },
        cost: costOf(modelRunsSince(deps.queue, scout.id, since)),
      };
    }),
    ...unreadable.map((file): ActivityRow => ({
      kind: "unreadable",
      file: file.file,
      health: unreadableHealth(file),
    })),
  ].sort(byNeed);
  return {
    rows,
    fleet: sourceHealth(rows),
    review: depth.fleet,
    dropped: droppedRows(dropped),
  };
}
