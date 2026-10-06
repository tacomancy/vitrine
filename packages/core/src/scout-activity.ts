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
       * first. A check refused for want of a key read nothing (ADR 0040
       * decision 1) and is not one, so a Scout waiting on a key never shows a
       * time it did not look (ADR 0042 decision 6). `ago` is the phrase a
       * Quiet field's Warrant uses for its own newest run, so one row never
       * gives that moment two wordings.
       */
      lastRun: { finished: string; ago: string } | null;
      health: Health;
    }
  /** A Scout file that does not parse is still a row, by its file name: it is a Scout the researcher made, and a table that left it out would hide the one that needs a look (ADR 0039 decision 7). */
  | { kind: "unreadable"; file: string; health: Health };

export type ScoutActivity = { rows: ActivityRow[] };

/** A check refused for want of a key read nothing (ADR 0040 decision 1): it is not a time the Scout looked. */
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
  return {
    // Readable Scouts, then the files that would not parse — the rail's own
    // order, which holds until the fleet table sorts by need.
    rows: [
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
    ],
  };
}
