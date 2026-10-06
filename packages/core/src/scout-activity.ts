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

/** The window the headline rate reads: twelve weeks, the same the chart draws (ADR 0042 decision 2). */
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
  const triaged = (counts?.accepted ?? 0) + (counts?.rejected ?? 0);
  if (counts === undefined || triaged === 0) return { kind: "nothing triaged" };
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
