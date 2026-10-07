import type { DatabaseSync } from "node:sqlite";
import { ago } from "./scout-health.js";

/** A moment on the stack's clock: the timestamp and the phrase a Warrant uses for it, so one row never words an age two ways. */
export type StackAge = { at: string; ago: string };

/**
 * What waits in Review (ADR 0042 decision 7): pending Proposals are the
 * headline depth; deferred ones are counted apart, because *look again with
 * the next run* is not a debt and must not inflate the stack. Age is the
 * median and the oldest `first_seen` of the pending ones, stated as facts —
 * `null` while nothing is pending. Skim has no depth: it is a feed.
 */
export type ReviewDepth = {
  pending: number;
  deferred: number;
  median: StackAge | null;
  oldest: StackAge | null;
};

/** A Scout nothing waits under, and the stack of a vault with no Scouts: the one shape a figure of none takes. */
export const NOTHING_WAITING: ReviewDepth = {
  pending: 0,
  deferred: 0,
  median: null,
  oldest: null,
};

type Waiting = { state: string; firstSeen: string };

/**
 * Review depth, fleet-wide and per Scout, derived once in the core so Scout
 * Activity and Home (beat 12) read the same figures.
 *
 * A Scout's stack is every Proposal it found, the rule the Queue's rail and
 * its cards use (`Card.scouts`), so the figure on a row is the stack the row
 * links to: a paper two Scouts found waits under both names, and counting it
 * for the first alone would show a Scout with nothing pending beside a stack
 * that holds the card. The fleet counts each Proposal once, so the Scouts'
 * figures may sum to more than it does. A dropped Scout's rows stay under its
 * id. Held rows are already in the vault and wait for nothing.
 *
 * Age is read from `first_seen`, which a deferral's return keeps and a Skim
 * line promoted into Review carries with it: it is how long the paper has
 * been known, not how long it has sat in Review.
 */
export function reviewDepth(
  queue: DatabaseSync,
  now: Date
): { fleet: ReviewDepth; byScout: Map<string, ReviewDepth> } {
  // A Proposal with no Appearance cannot be written (`arrive` always adds
  // one); the LEFT JOIN is so that one could never go missing from the fleet.
  const rows = queue
    .prepare(
      `SELECT p.id AS id, p.state AS state, p.first_seen AS firstSeen, a.scout_id AS scoutId
         FROM proposals p
         LEFT JOIN (SELECT DISTINCT proposal_id, scout_id FROM appearances) a
                ON a.proposal_id = p.id
        WHERE p.lane = 'review' AND p.state IN ('pending', 'deferred')`
    )
    .all() as Array<Waiting & { id: number; scoutId: string | null }>;

  const depthOf = (stack: Waiting[]): ReviewDepth => {
    const pending = stack
      .filter((row) => row.state === "pending")
      .map((row) => Date.parse(row.firstSeen))
      .sort((a, b) => a - b);
    const aged = (ms: number | undefined): StackAge | null =>
      ms === undefined
        ? null
        : { at: new Date(ms).toISOString(), ago: ago(now.getTime() - ms) };
    // For an odd count the two middle rows are one row; for an even count the
    // median falls halfway between them.
    const low = pending[Math.ceil(pending.length / 2) - 1];
    const high = pending[Math.floor(pending.length / 2)];
    return {
      pending: pending.length,
      deferred: stack.length - pending.length,
      median:
        low === undefined || high === undefined
          ? null
          : aged(Math.floor((low + high) / 2)),
      oldest: aged(pending[0]),
    };
  };

  const stacks = new Map<string, Waiting[]>();
  for (const row of rows) {
    if (row.scoutId === null) continue;
    stacks.set(row.scoutId, [...(stacks.get(row.scoutId) ?? []), row]);
  }
  return {
    fleet: depthOf([...new Map(rows.map((row) => [row.id, row])).values()]),
    byScout: new Map(
      [...stacks].map(([scoutId, stack]) => [scoutId, depthOf(stack)])
    ),
  };
}
