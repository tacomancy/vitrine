import type { DatabaseSync } from "node:sqlite";
import { VaultError } from "./errors.js";
import { readMuteState } from "./mutes.js";
import { readScouts, type Scout } from "./scout-file.js";

/**
 * What the researcher does to a Proposal in Review besides accept (ADR 0016
 * decisions 6 and 8 and its update of 2026-09-26; ADR 0039 decisions 5 and
 * 6). Every act is a `triage` row, and the log is append-only: an undo is a
 * compensating `undo` row, never an edit, so Accept rate and anything built
 * on the log reads what happened rather than what is left. *Open* and *pass*
 * record nothing and so are not here.
 */

/** What triage needs of `ScoutDeps`, restated so `scouts.ts` can call `returnDeferred` without a cycle. */
type ScoutDeps = {
  vaultPath: string;
  queue: DatabaseSync;
  now: () => Date;
};

/** One transaction, rolled back whole if anything in it throws. */
export function inTransaction<T>(queue: DatabaseSync, work: () => T): T {
  queue.exec("BEGIN");
  try {
    const result = work();
    queue.exec("COMMIT");
    return result;
  } catch (cause) {
    queue.exec("ROLLBACK");
    throw cause;
  }
}

const stamp = (deps: ScoutDeps) => deps.now().toISOString();

function stateOf(deps: ScoutDeps, proposalId: number): string {
  const row = deps.queue
    .prepare("SELECT state FROM proposals WHERE id = ?")
    .get(proposalId) as { state: string } | undefined;
  if (row === undefined) {
    throw new VaultError("refused", "That Proposal is gone.");
  }
  return row.state;
}

/**
 * `R`: never proposed again. The state is what keeps it out — a revised
 * version of the same paper arrives as an Appearance on this rejected row
 * (ADR 0016 decision 7), so the verdict follows the work and not a version.
 */
export function rejectProposal(deps: ScoutDeps, proposalId: number): void {
  decide(deps, proposalId, "reject", "rejected");
}

/** How many standing defers drop a card to Skim (ADR 0044 decision 8). */
const DEFERS_BEFORE_DEMOTE = 3;

/**
 * `D`: out of the stack until that Scout's next run finishes `ok` (see
 * `returnDeferred`). The third defer that stands drops the card to Skim
 * instead (ADR 0044 decision 8): a card the researcher keeps putting off is
 * not owed attention, and Skim is still one `T` from Review.
 */
export function deferProposal(deps: ScoutDeps, proposalId: number): void {
  decide(deps, proposalId, "defer", "deferred", () => {
    if (standingDefers(deps.queue, proposalId) < DEFERS_BEFORE_DEMOTE) return;
    // Pending, not deferred: it is in Skim now, and a deferral would hide it
    // there until a run brought it back.
    deps.queue
      .prepare(
        "UPDATE proposals SET lane = 'skim', state = 'pending' WHERE id = ?"
      )
      .run(proposalId);
    deps.queue
      .prepare(
        "INSERT INTO triage (proposal_id, action, at) VALUES (?, 'demote', ?)"
      )
      .run(proposalId, stamp(deps));
  });
}

/**
 * Defers that have not been taken back. An `undo` compensates the act before
 * it, so replaying the log in order and popping on `undo` leaves exactly the
 * acts still standing; a slip the researcher undid is not one of the three.
 */
function standingDefers(queue: DatabaseSync, proposalId: number): number {
  const acts: string[] = [];
  const log = queue
    .prepare("SELECT action FROM triage WHERE proposal_id = ? ORDER BY rowid")
    .all(proposalId) as Array<{ action: string }>;
  for (const { action } of log) {
    if (action === "defer" || action === "reject") acts.push(action);
    else if (action === "undo") acts.pop();
    // A hand promotion is a fresh start: the researcher has looked again, so
    // the one defer after it must not demote a card that was already dropped once.
    else if (action === "promote") acts.length = 0;
  }
  return acts.filter((a) => a === "defer").length;
}

function decide(
  deps: ScoutDeps,
  proposalId: number,
  action: "reject" | "defer",
  state: "rejected" | "deferred",
  /** Runs inside the act's own transaction, so a move it makes is never half-written. */
  also: () => void = () => undefined
): void {
  const { queue } = deps;
  // Only a card in the stack can be decided: a held or accepted Proposal was
  // never a card, and deciding one would put a verdict in the log for a paper
  // the researcher was not shown.
  // Nor a Skim line: nothing there is owed, so there is nothing to refuse it.
  const lane = queue
    .prepare("SELECT lane FROM proposals WHERE id = ?")
    .get(proposalId) as { lane: string } | undefined;
  if (stateOf(deps, proposalId) !== "pending" || lane?.lane !== "review") {
    throw new VaultError("refused", "That card is not in the stack.");
  }
  inTransaction(queue, () => {
    queue
      .prepare("UPDATE proposals SET state = ? WHERE id = ?")
      .run(state, proposalId);
    queue
      .prepare("INSERT INTO triage (proposal_id, action, at) VALUES (?, ?, ?)")
      .run(proposalId, action, stamp(deps));
    also();
  });
}

/**
 * `T` on a Skim line: *to Review*. The `promote` row is what keeps the paper
 * out of Accept rate however it ends — the researcher picked it, the Scout's
 * brief did not (ADR 0039 decision 4) — and the lane is rewritten so that
 * Review's own reads and the R/D/undo guards treat it as any other card.
 * Skim itself offers no reject or defer: nothing there is owed.
 */
export function promoteProposal(deps: ScoutDeps, proposalId: number): void {
  const row = deps.queue
    .prepare("SELECT state, lane FROM proposals WHERE id = ?")
    .get(proposalId) as { state: string; lane: string } | undefined;
  if (row === undefined) {
    throw new VaultError("refused", "That Proposal is gone.");
  }
  if (row.state !== "pending" || row.lane !== "skim") {
    throw new VaultError("refused", "That line is not in Skim.");
  }
  inTransaction(deps.queue, () => {
    deps.queue
      .prepare("UPDATE proposals SET lane = 'review' WHERE id = ?")
      .run(proposalId);
    deps.queue
      .prepare(
        "INSERT INTO triage (proposal_id, action, at) VALUES (?, 'promote', ?)"
      )
      .run(proposalId, stamp(deps));
  });
}

/**
 * The Scout a Proposal is credited to: the one whose Appearance came first, by
 * run and then by the order the rows were written, since two runs can overlap
 * (a *run now* beside a scheduled check) and `rowid` alone would then credit
 * whichever finished writing first. A deferral's return, the Accept rate,
 * Scout Activity's volume, a group's deferred count and the fleet's last new
 * proposal all read it here, so a card is one Scout's in all of them and the
 * figures beside each other cannot disagree (ADR 0042 decision 10). `proposal`
 * is the SQL column that names the Proposal, never a value.
 */
export const firstAppearanceScout = (proposal: string) =>
  `(SELECT scout_id FROM appearances WHERE proposal_id = ${proposal}
     ORDER BY run_id, rowid LIMIT 1)`;

/** Accepts and rejects that count toward each Scout's Accept rate (beat 9 reads this; ADR 0039 decisions 4 and 6). */
export type AcceptCounts = {
  scoutId: string;
  accepted: number;
  rejected: number;
  /** Of those counted, how many arrived with no authors, and with no venue: the guard on the rate reads these (ADR 0042 decision 3). */
  noAuthors: number;
  noVenue: number;
};

/** Which triage rows count toward an Accept rate (a `promote` or a `raise` leaves the Proposal out: the Scout did not place it, ADR 0044 decision 8), for the headline and the weekly line alike. Reads `t` (triage) and `p` (proposals) and binds one `?`, the window's `since`. */
const COUNTED = `t.action IN ('accept', 'reject')
          AND t.at >= ?
          AND p.lane = 'review'
          AND NOT EXISTS (SELECT 1 FROM scout_runs r WHERE r.id = t.batch
                           AND r.retroactive = 1)
          AND NOT EXISTS (SELECT 1 FROM triage x WHERE x.proposal_id = t.proposal_id
                           AND x.action IN ('promote', 'raise'))
          AND NOT EXISTS (SELECT 1 FROM triage u WHERE u.proposal_id = t.proposal_id
                           AND u.action = 'undo' AND u.rowid > t.rowid)`;

/**
 * Only what the Scout placed in Review counts: a Proposal with a `promote`
 * row was moved by hand, and one still in the Skim lane was never put to the
 * brief's test, so neither earns or costs the Scout anything — accepted or
 * not. A reject taken back by a later `undo` is not a reject. Credit goes to
 * the Scout whose Appearance came first, as a deferral's does.
 *
 * A *reject this run* on a Retroactive run is no reject either: it clears a
 * backward search nobody wanted and says nothing about the brief (ADR 0042
 * decision 2). The same act on an ordinary run is *this run was junk*, a
 * real judgement, and counts. `since` limits the read to acts at or after
 * that time, for the trailing window the row draws; the default `""` sorts
 * before any ISO timestamp, so it means no lower bound.
 */
export function acceptCounts(queue: DatabaseSync, since = ""): AcceptCounts[] {
  return queue
    .prepare(
      `SELECT ${firstAppearanceScout("t.proposal_id")} AS scoutId,
              SUM(t.action = 'accept') AS accepted,
              SUM(t.action = 'reject') AS rejected,
              SUM(p.authors = '[]') AS noAuthors,
              SUM(p.venue IS NULL) AS noVenue
         FROM triage t JOIN proposals p ON p.id = t.proposal_id
        WHERE ${COUNTED}
        GROUP BY scoutId ORDER BY scoutId`
    )
    .all(since) as AcceptCounts[];
}

/** A week's Accept rate needs at least this many triaged Review items to be a point; a thinner week is a gap, never a zero (ADR 0042 decision 2). */
export const MIN_WEEK_ITEMS = 5;

const WEEK_MS = 7 * 86_400_000;
const WEEKS = 12;

/** Where the twelve weeks an Accept rate reads begin. The headline and the weekly line both start here, so they read the same rows. */
export const acceptSince = (now: Date) =>
  new Date(now.getTime() - WEEKS * WEEK_MS).toISOString();

/** One week of a Scout's accept-rate line: `rate` is null for a gap, and `triaged` is what the week rests on either way. */
export type AcceptWeek = {
  /** ISO time the week begins, inclusive; it ends a week later, exclusive. */
  start: string;
  triaged: number;
  rate: number | null;
};

/**
 * One Scout's trailing twelve weeks, oldest first, the newest ending at
 * `now`. The weeks roll with `now` rather than follow the calendar, as the
 * headline's window does. It reads the rows `acceptCounts` counts (one
 * `COUNTED` filter, one `acceptSince`), so a point can never rest on an item
 * the headline leaves out. The buckets are cut here and not in SQL so the
 * week's edge is one expression, the one `start` is printed from.
 */
export function acceptWeeks(
  queue: DatabaseSync,
  scoutId: string,
  now: Date
): AcceptWeek[] {
  const since = acceptSince(now);
  const rows = queue
    .prepare(
      `SELECT t.action AS action, t.at AS at
         FROM triage t JOIN proposals p ON p.id = t.proposal_id
        WHERE ${COUNTED} AND ${firstAppearanceScout("t.proposal_id")} = ?`
    )
    .all(since, scoutId) as Array<{ action: "accept" | "reject"; at: string }>;
  const from = Date.parse(since);
  const weeks = Array.from({ length: WEEKS }, (_, i) => ({
    start: new Date(from + i * WEEK_MS).toISOString(),
    accepted: 0,
    triaged: 0,
  }));
  for (const row of rows) {
    // Nothing bounds `at` above, so a row stamped after `now` is in the
    // headline and has to be in a week: the newest, not one past the end.
    // `COUNTED` already keeps everything below `since` out.
    const week =
      weeks[
        Math.min(Math.floor((Date.parse(row.at) - from) / WEEK_MS), WEEKS - 1)
      ]!;
    week.triaged += 1;
    if (row.action === "accept") week.accepted += 1;
  }
  return weeks.map(({ start, accepted, triaged }) => ({
    start,
    triaged,
    rate: triaged >= MIN_WEEK_ITEMS ? accepted / triaged : null,
  }));
}

/**
 * *Reject this run*: one `reject` row per Proposal still pending that the
 * run found, each carrying the run id as `batch` so a later reading can tell
 * *this run was junk* from a brief that kept missing (ADR 0039 decision 5).
 * One transaction, so a run is rejected whole or not at all.
 */
export async function rejectRun(
  deps: ScoutDeps,
  runId: number
): Promise<number> {
  const { queue } = deps;
  // A muted Proposal is not in the stack the button counts, so it is not
  // rejected: that would write a verdict nobody gave (ADR 0044 decision 4).
  const { caught } = await readMuteState(deps);
  const ids = (
    queue
      .prepare(
        `SELECT DISTINCT p.id FROM proposals p JOIN appearances a ON a.proposal_id = p.id
          WHERE a.run_id = ? AND p.state = 'pending' AND p.lane = 'review' ORDER BY p.id`
      )
      .all(runId) as Array<{ id: number }>
  )
    .map((row) => row.id)
    .filter((id) => !caught.has(id));
  const at = stamp(deps);
  inTransaction(queue, () => {
    for (const id of ids) {
      queue
        .prepare("UPDATE proposals SET state = 'rejected' WHERE id = ?")
        .run(id);
      queue
        .prepare(
          "INSERT INTO triage (proposal_id, action, at, batch) VALUES (?, 'reject', ?, ?)"
        )
        .run(id, at, runId);
    }
  });
  return ids.length;
}

/**
 * Undo a reject or a defer. There is none for accept: that would be the app
 * deleting a vault file it wrote (`CLAUDE.md` § Invariants; ADR 0039 decision
 * 6). Whether the card is still in *this session's* stack is the window's to
 * know; what the core owns is that only a decision still standing can be
 * taken back, so a double undo, or one for a deferral that already came
 * back, appends nothing.
 */
export function undoTriage(deps: ScoutDeps, proposalId: number): void {
  const { queue } = deps;
  const state = stateOf(deps, proposalId);
  // The defer that dropped a card to Skim is still the last thing done to it,
  // and taking it back must bring the card back to where it was.
  const demoted =
    state === "pending" &&
    (
      queue
        .prepare(
          "SELECT action FROM triage WHERE proposal_id = ? ORDER BY rowid DESC LIMIT 1"
        )
        .get(proposalId) as { action: string } | undefined
    )?.action === "demote";
  if (state !== "rejected" && state !== "deferred" && !demoted) {
    throw new VaultError("refused", "There is nothing to undo for that card.");
  }
  inTransaction(queue, () => {
    queue
      .prepare(
        "UPDATE proposals SET state = 'pending', lane = CASE WHEN ? THEN 'review' ELSE lane END WHERE id = ?"
      )
      .run(demoted ? 1 : 0, proposalId);
    queue
      .prepare(
        "INSERT INTO triage (proposal_id, action, at) VALUES (?, 'undo', ?)"
      )
      .run(proposalId, stamp(deps));
  });
}

/**
 * A deferral ends when a run for the Scout that placed the paper — the one
 * whose Appearance came first — finishes `ok` (ADR 0016 decision 8). Another
 * Scout that later finds the same paper does not end it: the researcher
 * deferred it until *that* brief looked again, and two Scouts must not make
 * a deferral shorter. The row keeps its `first_seen`, so it comes back at its
 * original place in newest-first order. Called inside the run's own
 * transaction.
 */
export function returnDeferred(deps: ScoutDeps, scoutId: string): void {
  deps.queue
    .prepare(
      `UPDATE proposals SET state = 'pending'
        WHERE state = 'deferred'
          AND ? = ${firstAppearanceScout("proposals.id")}`
    )
    .run(scoutId);
}

/** What the rail and a Scout's group say beyond the cards: the run to reject whole, and what the vault already held. */
export type Group = {
  id: string;
  /** The Scout's newest clean run, the one *reject this run* acts on; `null` before it has run. */
  runId: number | null;
  /** How many of that run's Proposals are still pending. */
  runPending: number;
  /**
   * Deferred Proposals that wait on this Scout's next clean run, the one that
   * brings them back (`returnDeferred`). For a Scout that is looking that is
   * only a matter of time; for a dropped one it is never, until it is
   * restored, and nothing else lists them (ADR 0042 decision 1).
   */
  deferred: number;
  /** Held Proposals, each with the file the vault already has: counted, never hidden (ADR 0039 decision 1). */
  held: Array<{ title: string; path: string }>;
};

export async function readGroups(deps: ScoutDeps): Promise<Group[]> {
  const { queue } = deps;
  const { scouts, dropped } = await readScouts(deps.vaultPath);
  // What a rule holds is out of the stack, so out of what the group offers to
  // reject whole or says is waiting (ADR 0044 decision 4).
  const { caught } = await readMuteState(deps);
  // A dropped Scout's stack is cleared with *reject this run* like any other,
  // so it has a group though the rail does not list it (ADR 0042 decision 1).
  return [...scouts, ...dropped].map((scout) => {
    const run = queue
      .prepare(
        "SELECT id FROM scout_runs WHERE scout_id = ? AND outcome = 'ok' ORDER BY id DESC LIMIT 1"
      )
      .get(scout.id) as { id: number } | undefined;
    const pending =
      run === undefined
        ? 0
        : (
            queue
              .prepare(
                `SELECT DISTINCT p.id FROM proposals p JOIN appearances a ON a.proposal_id = p.id
                  WHERE a.run_id = ? AND p.state = 'pending' AND p.lane = 'review'`
              )
              .all(run.id) as Array<{ id: number }>
          ).filter((row) => !caught.has(row.id)).length;
    const deferred = (
      queue
        .prepare(
          `SELECT id FROM proposals
            WHERE state = 'deferred' AND lane = 'review'
              AND ${firstAppearanceScout("proposals.id")} = ?`
        )
        .all(scout.id) as Array<{ id: number }>
    ).filter((row) => !caught.has(row.id)).length;
    const held = queue
      .prepare(
        `SELECT DISTINCT p.id, p.title, p.stub_path FROM proposals p JOIN appearances a ON a.proposal_id = p.id
          WHERE a.scout_id = ? AND p.state = 'held' AND p.stub_path IS NOT NULL ORDER BY p.id`
      )
      .all(scout.id) as Array<{ title: string; stub_path: string }>;
    return {
      id: scout.id,
      runId: run?.id ?? null,
      runPending: pending,
      deferred,
      held: held.map((h) => ({ title: h.title, path: h.stub_path })),
    };
  });
}

/**
 * When the page last changed, if the runs inside the weekly line's twelve
 * weeks asked more than one (ADR 0043 decision 8): the first run at the page
 * the Scout reads now, after a run at another. Derived from each run's
 * recorded `query`, so nothing is stored and the Queue and the file cannot
 * disagree about it. A run with no recorded page predates the column and is
 * never taken for an edit; an arXiv Scout's Query is a Filter on one source,
 * so it has no page change. The line's figures do not read this.
 */
export function pageChangeIn(
  queue: DatabaseSync,
  scout: Scout,
  now: Date
): { at: string } | null {
  if (scout.source.kind !== "watched") return null;
  const runs = queue
    .prepare(
      `SELECT finished, query FROM scout_runs
        WHERE scout_id = ? AND finished IS NOT NULL AND query IS NOT NULL AND finished >= ?
        ORDER BY id`
    )
    .all(scout.id, acceptSince(now)) as Array<{
    finished: string;
    query: string;
  }>;
  // A re-point nothing has read yet has no date: the change is the edit, which
  // is stored nowhere, and the Voice already says the page is unread. Dating
  // it by the last change between runs would name an older one.
  if (runs.at(-1)?.query !== scout.query) return null;
  // Last write wins, so A, B, A is dated by the return to A, not the first move.
  let at: string | null = null;
  for (let i = 1; i < runs.length; i++) {
    if (runs[i]!.query !== runs[i - 1]!.query) at = runs[i]!.finished;
  }
  return at === null ? null : { at };
}
