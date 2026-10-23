import { afterEach, describe, expect, it } from "vitest";
import type { AcceptCounts } from "./triage.js";
import { arxivScout, daysAgo, openedWithQueue } from "./scout-queue-seed.js";
import { closeCores } from "./test-core.js";

afterEach(closeCores);

// Retroactive batches (#839; ADR 0052 decisions 3 and 4): a Retroactive run read
// as a unit — what of it is still pending and visible, what it cost — so the
// Queue can list it apart from new finds and reject it whole. The renderer never
// derives a batch from `Card.retroactive`, because it cannot see the run.

type Batch = {
  scoutId: string;
  runId: number;
  pending: number;
  costUsd: number | null;
  proposalIds: number[];
};

async function opened() {
  const q = await openedWithQueue({ "a.yaml": arxivScout("a") });
  let n = 0;
  const run = (retroactive: boolean, cost: number | null = null) =>
    Number(
      q.db
        .prepare(
          `INSERT INTO scout_runs (scout_id, started, finished, outcome, window_from, window_to, retroactive, cost_usd)
           VALUES ('a', ?, ?, 'ok', ?, ?, ?, ?)`
        )
        .run(daysAgo(1), daysAgo(1), daysAgo(2), daysAgo(1), +retroactive, cost)
        .lastInsertRowid
    );
  /** A Proposal found by these runs, in order, in this state. */
  const propose = (
    runs: number[],
    state = "pending",
    authors = ["A. Author"],
    lane = "review"
  ) => {
    n += 1;
    const id = Number(
      q.db
        .prepare(
          `INSERT INTO proposals (source_key, title, authors, published, venue, abstract, url, lane, state, first_seen)
           VALUES (?, ?, ?, '2026-01-01', 'J', '', 'https://x.example', ?, ?, ?)`
        )
        .run(`k${n}`, `T${n}`, JSON.stringify(authors), lane, state, daysAgo(3))
        .lastInsertRowid
    );
    for (const r of runs) {
      q.db
        .prepare(
          "INSERT INTO appearances (proposal_id, run_id, scout_id, seen_at, url) VALUES (?, ?, 'a', ?, ?)"
        )
        .run(id, r, daysAgo(3), `https://x.example/${r}`);
    }
    return id;
  };
  const batches = async () =>
    (await q.c.query<Batch[]>("scouts.batches")).result!.data;
  const state = (id: number) =>
    (
      q.db.prepare("SELECT state FROM proposals WHERE id = ?").get(id) as {
        state: string;
      }
    ).state;
  const counts = async () =>
    (await q.c.query<AcceptCounts[]>("scouts.acceptCounts")).result!.data;
  return { ...q, run, propose, batches, state, counts };
}

describe("reading Retroactive runs as batches", () => {
  it("shows only what is pending and visible: acted-on, muted and capped cards are out, and an ordinary run is not a batch", async () => {
    const q = await opened();
    const look = q.run(true, 0.42);
    const ordinary = q.run(false);
    const pending = q.propose([look]);
    const alsoPending = q.propose([look]);
    q.propose([look], "accepted");
    q.propose([look], "rejected");
    q.propose([look], "deferred");
    q.propose([look], "capped");
    q.propose([look], "pending", ["Muted Author"]);
    q.propose([look], "pending", ["A. Author"], "skim");
    q.propose([ordinary]);
    await q.c.mutate("scouts.mute", { kind: "author", value: "Muted Author" });

    expect(await q.batches()).toEqual([
      {
        scoutId: "a",
        runId: look,
        pending: 2,
        costUsd: 0.42,
        // Newest first, as the stack lists them.
        proposalIds: [alsoPending, pending],
      },
    ]);
  });

  it("says a run's cost is null when it was not priced, and drops a batch with nothing left", async () => {
    const q = await opened();
    const unpriced = q.run(true);
    const spent = q.run(true, 0.1);
    q.propose([unpriced]);
    q.propose([spent], "rejected");

    expect(await q.batches()).toEqual([
      expect.objectContaining({ runId: unpriced, costUsd: null, pending: 1 }),
    ]);
  });

  it("leaves a card an earlier ordinary run found to the new finds, though the Retroactive run saw it too", async () => {
    const q = await opened();
    const earlier = q.run(false);
    const look = q.run(true);
    const known = q.propose([earlier, look]);
    const fresh = q.propose([look]);

    expect(await q.batches()).toEqual([
      expect.objectContaining({ runId: look, proposalIds: [fresh] }),
    ]);
    // And Reject this run reaches exactly what the batch lists.
    await q.c.mutate("scouts.rejectRun", { runId: look });
    expect([q.state(known), q.state(fresh)]).toEqual(["pending", "rejected"]);
  });
});

describe("rejecting a Retroactive batch", () => {
  it("writes the run id as batch, so the Accept rate does not move", async () => {
    const q = await opened();
    const look = q.run(true);
    const ids = [q.propose([look]), q.propose([look])];
    const before = await q.counts();

    await q.c.mutate("scouts.rejectRun", { runId: look });

    expect(ids.map(q.state)).toEqual(["rejected", "rejected"]);
    expect(
      q.db.prepare("SELECT action, batch FROM triage ORDER BY rowid").all()
    ).toEqual([
      { action: "reject", batch: look },
      { action: "reject", batch: look },
    ]);
    expect(await q.counts()).toEqual(before);
    expect(await q.batches()).toEqual([]);
  });

  it("is undone as a unit, and leaves a card the researcher decided again since", async () => {
    const q = await opened();
    const look = q.run(true);
    const [a, b, c] = [q.propose([look]), q.propose([look]), q.propose([look])];
    await q.c.mutate("scouts.rejectRun", { runId: look });
    // `b` was put back by hand and rejected on its own: not this run's verdict.
    await q.c.mutate("scouts.undo", { proposalId: b });
    await q.c.mutate("scouts.reject", { proposalId: b });

    const undone = await q.c.mutate<{ count: number }>("scouts.undoRun", {
      runId: look,
    });

    expect(undone.error).toBeUndefined();
    expect(undone.result!.data.count).toBe(2);
    expect([a, b, c].map(q.state)).toEqual(["pending", "rejected", "pending"]);
    expect((await q.batches())[0]!.proposalIds).toEqual([c, a]);
  });

  it("refuses an undo when nothing of the run stands", async () => {
    const q = await opened();
    const look = q.run(true);
    q.propose([look]);

    const undone = await q.c.mutate("scouts.undoRun", { runId: look });

    expect(undone.error).toBeDefined();
  });
});
