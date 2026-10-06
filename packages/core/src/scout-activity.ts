import type { DatabaseSync } from "node:sqlite";
import { readScouts, type Scout } from "./scout-file.js";
import {
  ago,
  finishedRuns,
  healthOf,
  unreadableHealth,
  type Health,
} from "./scout-health.js";
import { NO_KEY } from "./watched.js";

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
  notParsing: number;
  noKey: number;
};

export type ScoutActivity = { rows: ActivityRow[]; fleet: FleetSource };

/**
 * Where a row sits by need (ADR 0042 decision 8): faults, then Scouts that are
 * not looking, then everything else. It reads the Voice the row already
 * carries, so the order and the words beside it cannot disagree about a Scout.
 */
const NEED = { wrong: 0, "not yet": 1, claim: 2 } as const;

const labelOf = (row: ActivityRow) =>
  row.kind === "scout" ? row.name : row.file;

/** Stable on name: `localeCompare` for people's names, then the file or id, so two Scouts named alike keep one order. */
const byNeed = (a: ActivityRow, b: ActivityRow) =>
  NEED[a.health.voice] - NEED[b.health.voice] ||
  labelOf(a).localeCompare(labelOf(b)) ||
  (a.kind === "scout" && b.kind === "scout" ? a.id.localeCompare(b.id) : 0);

function sourceHealth(rows: ActivityRow[]): FleetSource {
  const count = (keep: (health: Health) => boolean) =>
    rows.filter((row) => keep(row.health)).length;
  return {
    parsingCleanly: count((h) => h.voice === "claim"),
    notParsing: count((h) => h.voice === "wrong"),
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
