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
  if (stateOf(deps, proposalId) !== "pending") {
    throw new VaultError("refused", "That card is not in the stack.");
  }
  queue.exec("BEGIN");
  try {
    queue
      .prepare("UPDATE proposals SET state = ? WHERE id = ?")
      .run(state, proposalId);
    queue
      .prepare("INSERT INTO triage (proposal_id, action, at) VALUES (?, ?, ?)")
      .run(proposalId, action, stamp(deps));
    queue.exec("COMMIT");
  } catch (cause) {
    queue.exec("ROLLBACK");
    throw cause;
  }
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
          WHERE a.run_id = ? AND p.state = 'pending' ORDER BY p.id`
      )
      .all(runId) as Array<{ id: number }>
  ).map((row) => row.id);
  const at = stamp(deps);
  queue.exec("BEGIN");
  try {
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
    queue.exec("COMMIT");
  } catch (cause) {
    queue.exec("ROLLBACK");
    throw cause;
  }
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
  queue.exec("BEGIN");
  try {
    queue
      .prepare("UPDATE proposals SET state = 'pending' WHERE id = ?")
      .run(proposalId);
    queue
      .prepare(
        "INSERT INTO triage (proposal_id, action, at) VALUES (?, 'undo', ?)"
      )
      .run(proposalId, stamp(deps));
    queue.exec("COMMIT");
  } catch (cause) {
    queue.exec("ROLLBACK");
    throw cause;
  }
}

/**
 * A deferral ends when a run for a Scout that found the paper finishes `ok`
 * (ADR 0016 decision 8). The row keeps its `first_seen`, so it comes back at
 * its original place in newest-first order and not at the top. Called inside
 * the run's own transaction.
 */
export function returnDeferred(deps: ScoutDeps, scoutId: string): void {
  deps.queue
    .prepare(
      `UPDATE proposals SET state = 'pending'
        WHERE state = 'deferred'
          AND id IN (SELECT proposal_id FROM appearances WHERE scout_id = ?)`
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
                  WHERE a.run_id = ? AND p.state = 'pending'`
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
