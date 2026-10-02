import type { DatabaseSync } from "node:sqlite";
import { readScouts, type Scout } from "./scout-file.js";
import { CADENCE_MS, finishedRuns } from "./scout-health.js";
import { runScout, type ScoutDeps } from "./scouts.js";
import { serialised } from "./serialise.js";

/**
 * When a Scout runs without being asked (ADR 0016 decision 3, ADR 0039
 * decision 3; `docs/architecture.md` § Scouts, *Scheduler*). *Run now* never
 * comes through here — it queues one regardless.
 */

/**
 * Due is read off *completed* runs, and a failed run is not one, so read
 * literally every failure would be due at every hourly check. By kind: a
 * transient fault (`network`, `http`, `interrupted`) is asked again at the
 * next check; `rate_limited` and `parse` wait a full cadence from the
 * attempt, since asking sooner gets the same answer and, for the first, is
 * the wrong direction against a ToU that asks for restraint. Editing the
 * Query overrides that wait: the new text has not been tried.
 */
export function isDue(queue: DatabaseSync, scout: Scout, now: Date): boolean {
  if (scout.paused) return false;
  const allRuns = queue
    .prepare(
      "SELECT finished FROM scout_runs WHERE scout_id = ? ORDER BY id DESC LIMIT 1"
    )
    .get(scout.id) as { finished: string | null } | undefined;
  // A run in flight (Run now, or the previous check still going) is the
  // answer to being due; asking again would search the same window twice.
  if (allRuns !== undefined && allRuns.finished === null) return false;

  const runs = finishedRuns(queue, scout.id);
  const newest = runs.at(-1);
  if (newest === undefined) return true;
  const cadence = CADENCE_MS[scout.cadence];
  const lastClean = runs.findLast((r) => r.outcome === "ok");
  const elapsedSinceClean =
    lastClean === undefined
      ? true
      : now.getTime() - Date.parse(lastClean.finished) >= cadence;

  if (newest.outcome === "ok") return elapsedSinceClean;
  // A run from before the Query was recorded cannot be told apart from an
  // edit, so it is not taken for one.
  if (newest.query !== null && newest.query !== scout.query) return true;
  // No key is asked again by the key being set or *Run now*, never by the
  // hour: nothing about the Scout has changed since it last said so.
  if (newest.error_kind === "credentials") return false;
  if (
    newest.error_kind === "rate_limited" ||
    newest.error_kind === "parse" ||
    newest.error_kind === "model" ||
    newest.error_kind === "extraction"
  ) {
    return (
      elapsedSinceClean && now.getTime() - Date.parse(newest.started) >= cadence
    );
  }
  return true;
}

// A check is a read of what is due followed by runs that take minutes on one
// 3 s-gapped client; an hourly tick landing in the middle of one must wait for
// it, and then find those Scouts no longer due. The queue is here, in the
// function, and not in the timer that calls it.
const checking = serialised();

/**
 * Run every due Scout, in creation order, one after another on the one
 * arXiv client. Each is re-checked just before it runs, so a Scout that
 * *Run now* or the previous check already took is not asked twice. Returns
 * the ids it ran.
 */
export function checkDue(deps: ScoutDeps): Promise<string[]> {
  return checking(async () => {
    const { scouts } = await readScouts(deps.vaultPath);
    const ran: string[] = [];
    for (const scout of [...scouts].sort(
      (a, b) =>
        a.created.getTime() - b.created.getTime() || a.id.localeCompare(b.id)
    )) {
      if (!isDue(deps.queue, scout, deps.now())) continue;
      try {
        await runScout(deps, scout.id);
        ran.push(scout.id);
      } catch (cause) {
        // A bug in a run must not stop the Scouts behind it; it reaches the
        // core's log, which is where a fault with no surface goes.
        console.error(
          `vitrine-core: Scout ${scout.id} failed to run: ${cause instanceof Error ? cause.message : String(cause)}`
        );
      }
    }
    return ran;
  });
}
