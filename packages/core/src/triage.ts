import type { DatabaseSync } from "node:sqlite";
import { VaultError } from "./errors.js";
import { readScouts } from "./scout-file.js";

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

/** `D`: out of the stack until that Scout's next run finishes `ok` (see `returnDeferred`). */
export function deferProposal(deps: ScoutDeps, proposalId: number): void {
  decide(deps, proposalId, "defer", "deferred");
}

function decide(
  deps: ScoutDeps,
  proposalId: number,
  action: "reject" | "defer",
  state: "rejected" | "deferred"
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

/** Accepts and rejects that count toward each Scout's Accept rate (beat 9 reads this; ADR 0039 decisions 4 and 6). */
export type AcceptCounts = {
  scoutId: string;
  accepted: number;
  rejected: number;
};

/**
 * Only what the Scout placed in Review counts: a Proposal with a `promote`
 * row was moved by hand, and one still in the Skim lane was never put to the
 * brief's test, so neither earns or costs the Scout anything — accepted or
 * not. A reject taken back by a later `undo` is not a reject. Credit goes to
 * the Scout whose Appearance came first, as a deferral's does.
 */
export function acceptCounts(queue: DatabaseSync): AcceptCounts[] {
  return queue
    .prepare(
      `SELECT (SELECT scout_id FROM appearances WHERE proposal_id = t.proposal_id
                ORDER BY run_id, rowid LIMIT 1) AS scoutId,
              SUM(t.action = 'accept') AS accepted,
              SUM(t.action = 'reject') AS rejected
         FROM triage t JOIN proposals p ON p.id = t.proposal_id
        WHERE t.action IN ('accept', 'reject')
          AND p.lane = 'review'
          AND NOT EXISTS (SELECT 1 FROM triage x WHERE x.proposal_id = t.proposal_id
                           AND x.action = 'promote')
          AND NOT EXISTS (SELECT 1 FROM triage u WHERE u.proposal_id = t.proposal_id
                           AND u.action = 'undo' AND u.rowid > t.rowid)
        GROUP BY scoutId ORDER BY scoutId`
    )
    .all() as AcceptCounts[];
}

/**
 * *Reject this run*: one `reject` row per Proposal still pending that the
 * run found, each carrying the run id as `batch` so a later reading can tell
 * *this run was junk* from a brief that kept missing (ADR 0039 decision 5).
 * One transaction, so a run is rejected whole or not at all.
 */
export function rejectRun(deps: ScoutDeps, runId: number): number {
  const { queue } = deps;
  const ids = (
    queue
      .prepare(
        `SELECT DISTINCT p.id FROM proposals p JOIN appearances a ON a.proposal_id = p.id
          WHERE a.run_id = ? AND p.state = 'pending' AND p.lane = 'review' ORDER BY p.id`
      )
      .all(runId) as Array<{ id: number }>
  ).map((row) => row.id);
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
  if (state !== "rejected" && state !== "deferred") {
    throw new VaultError("refused", "There is nothing to undo for that card.");
  }
  inTransaction(queue, () => {
    queue
      .prepare("UPDATE proposals SET state = 'pending' WHERE id = ?")
      .run(proposalId);
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
          AND ? = (SELECT scout_id FROM appearances WHERE proposal_id = proposals.id
                    ORDER BY run_id, rowid LIMIT 1)`
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
  /** Held Proposals, each with the file the vault already has: counted, never hidden (ADR 0039 decision 1). */
  held: Array<{ title: string; path: string }>;
};

export async function readGroups(deps: ScoutDeps): Promise<Group[]> {
  const { queue } = deps;
  const { scouts } = await readScouts(deps.vaultPath);
  return scouts.map((scout) => {
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
                `SELECT COUNT(DISTINCT p.id) AS n FROM proposals p JOIN appearances a ON a.proposal_id = p.id
                  WHERE a.run_id = ? AND p.state = 'pending' AND p.lane = 'review'`
              )
              .get(run.id) as { n: number }
          ).n;
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
      held: held.map((h) => ({ title: h.title, path: h.stub_path })),
    };
  });
}
