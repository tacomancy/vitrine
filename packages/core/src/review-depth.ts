import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_REVIEW_DAYS } from "./scout-file.js";
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
  /**
   * How many of the pending ones are older than their Scout's `review_days`.
   * They are inside `pending`, not beside it: the digest collapses them in the
   * stack, but aging decides nothing, so the headline still counts them (ADR
   * 0044 decision 3). Home's *Review depth* reads this to say how much of the
   * stack is old.
   */
  pastWindow: number;
  deferred: number;
  median: StackAge | null;
  oldest: StackAge | null;
};

/** A Scout nothing waits under, and the stack of a vault with no Scouts: the one shape a figure of none takes. */
export const NOTHING_WAITING: ReviewDepth = {
  pending: 0,
  pastWindow: 0,
  deferred: 0,
  median: null,
  oldest: null,
};

type Waiting = { state: string; firstSeen: string; pastWindow: boolean };

/** A Scout's aging window in days; a Scout the vault no longer has gets the default. */
export type WindowOf = (scoutId: string) => number;
const DEFAULT_WINDOW: WindowOf = () => DEFAULT_REVIEW_DAYS;

/** Each Scout's aging window; the default for a Scout the vault no longer has. */
export function windowsOf(
  scouts: Array<{ id: string; reviewDays: number }>
): WindowOf {
  const days = new Map(scouts.map((s) => [s.id, s.reviewDays]));
  return (id) => days.get(id) ?? DEFAULT_REVIEW_DAYS;
}

/**
 * The pending Review Proposals past their window. The Scout that placed a
 * paper (its first Appearance) owns its window, as it owns a Skim line's
 * cutoff, so the Queue's digest and Review depth are drawn from the one
 * answer and cannot disagree about which items are old. Age is `first_seen`,
 * the same clock Review depth's ages use.
 */
export function pastWindowIds(
  queue: DatabaseSync,
  now: Date,
  windowOf: WindowOf = DEFAULT_WINDOW
): Set<number> {
  const rows = queue
    .prepare(
      `SELECT p.id AS id, p.first_seen AS firstSeen,
              (SELECT a.scout_id FROM appearances a WHERE a.proposal_id = p.id
                ORDER BY a.run_id, a.rowid LIMIT 1) AS owner
         FROM proposals p
        WHERE p.lane = 'review' AND p.state = 'pending'`
    )
    .all() as Array<{ id: number; firstSeen: string; owner: string | null }>;
  return new Set(
    rows
      .filter(
        (row) =>
          Date.parse(row.firstSeen) <
          now.getTime() - windowOf(row.owner ?? "") * 86_400_000
      )
      .map((row) => row.id)
  );
}

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
  now: Date,
  /** Proposals a Mute rule holds: they count nowhere here (ADR 0044 decision 4). Required, so a caller cannot forget it. */
  muted: ReadonlySet<number>,
  windowOf: WindowOf = DEFAULT_WINDOW
): { fleet: ReviewDepth; byScout: Map<string, ReviewDepth> } {
  // A Proposal with no Appearance cannot be written (`arrive` always adds
  // one); the LEFT JOIN is so that one could never go missing from the fleet.
  const old = pastWindowIds(queue, now, windowOf);
  const found = queue
    .prepare(
      `SELECT p.id AS id, p.state AS state, p.first_seen AS firstSeen, a.scout_id AS scoutId
         FROM proposals p
         LEFT JOIN (SELECT DISTINCT proposal_id, scout_id FROM appearances) a
                ON a.proposal_id = p.id
        WHERE p.lane = 'review' AND p.state IN ('pending', 'deferred')`
    )
    .all() as Array<
    Omit<Waiting, "pastWindow"> & { id: number; scoutId: string | null }
  >;
  const rows = found
    .filter((row) => !muted.has(row.id))
    .map((row) => ({ ...row, pastWindow: old.has(row.id) }));

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
      pastWindow: stack.filter(
        (row) => row.state === "pending" && row.pastWindow
      ).length,
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
