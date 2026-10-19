import { afterEach, describe, expect, it } from "vitest";
import type { AcceptCounts } from "./triage.js";
import type { Card } from "./scouts.js";
import { arxivScout, openedWithQueue } from "./scout-queue-seed.js";
import { closeCores } from "./test-core.js";

afterEach(closeCores);

// Reject group and defer group (#644; ADR 0044 decision 9): one triage row per
// Proposal, all carrying one `bulk` id, `batch` untouched, and one undo for the
// whole gesture. The window names the cards it shows; the core acts on exactly
// those that are still pending in Review.

async function stack(n = 3) {
  const q = await openedWithQueue({ "a.yaml": arxivScout("a") });
  for (let i = 0; i < n; i++) q.seed("a", { lane: "review" });
  const ids = (
    q.db.prepare("SELECT id FROM proposals ORDER BY id").all() as Array<{
      id: number;
    }>
  ).map((r) => r.id);
  const call = async (
    name: "rejectGroup" | "deferGroup",
    proposalIds: number[]
  ) => q.c.mutate(`scouts.${name}`, { proposalIds });
  const undoBulk = async (bulk: number) =>
    q.c.mutate("scouts.undoBulk", { bulk });
  const rows = () =>
    q.db
      .prepare(
        "SELECT proposal_id AS id, action, batch, bulk FROM triage ORDER BY rowid"
      )
      .all() as Array<{
      id: number;
      action: string;
      batch: number | null;
      bulk: number | null;
    }>;
  const state = (id: number) =>
    (
      q.db.prepare("SELECT state FROM proposals WHERE id = ?").get(id) as {
        state: string;
      }
    ).state;
  const queue = async () =>
    (await q.c.query<Card[]>("scouts.queue")).result!.data;
  const counts = async () =>
    (await q.c.query<AcceptCounts[]>("scouts.acceptCounts")).result!.data;
  return { ...q, ids, call, undoBulk, rows, state, queue, counts };
}

describe("reject group", () => {
  it("writes one reject row per card, all sharing one bulk id, with no batch", async () => {
    const s = await stack();

    const done = await s.call("rejectGroup", s.ids);

    expect(done.error).toBeUndefined();
    expect(done.result!.data).toMatchObject({ count: 3 });
    const rows = s.rows();
    expect(rows.map((r) => [r.id, r.action, r.batch])).toEqual(
      s.ids.map((id) => [id, "reject", null])
    );
    const bulk = rows[0]!.bulk;
    expect(bulk).not.toBeNull();
    expect(rows.every((r) => r.bulk === bulk)).toBe(true);
    expect(done.result!.data).toMatchObject({ bulk });
    expect(s.ids.map(s.state)).toEqual(["rejected", "rejected", "rejected"]);
    expect(await s.queue()).toEqual([]);
  });

  it("acts on exactly the cards it is given, leaving the rest of the stack", async () => {
    const s = await stack();

    await s.call("rejectGroup", s.ids.slice(0, 2));

    expect(s.ids.map(s.state)).toEqual(["rejected", "rejected", "pending"]);
    expect((await s.queue()).map((c) => c.id)).toEqual([s.ids[2]]);
  });

  it("gives each gesture its own bulk id", async () => {
    const s = await stack();

    await s.call("rejectGroup", [s.ids[0]!]);
    await s.call("rejectGroup", [s.ids[1]!]);

    const [a, b] = s.rows();
    expect(a!.bulk).not.toBeNull();
    expect(b!.bulk).not.toBeNull();
    expect(a!.bulk).not.toBe(b!.bulk);
  });

  it("skips a card that is no longer pending in Review rather than refusing the rest", async () => {
    const s = await stack();
    await s.c.mutate("scouts.reject", { proposalId: s.ids[0] });

    const done = await s.call("rejectGroup", s.ids);

    expect(done.result!.data).toMatchObject({ count: 2 });
    expect(s.rows().filter((r) => r.bulk !== null)).toHaveLength(2);
  });

  it("refuses when nothing it is given can be acted on, writing nothing", async () => {
    const s = await stack(1);
    await s.c.mutate("scouts.reject", { proposalId: s.ids[0] });
    const before = s.rows().length;

    const done = await s.call("rejectGroup", s.ids);

    expect(done.error?.message).toMatch(/nothing/i);
    expect(s.rows()).toHaveLength(before);
  });

  it("counts toward Accept rate like any reject", async () => {
    const s = await stack();

    await s.call("rejectGroup", s.ids);

    expect(await s.counts()).toMatchObject([
      { scoutId: "a", accepted: 0, rejected: 3 },
    ]);
  });
});

describe("defer group", () => {
  it("writes one defer row per card under one bulk id and holds them out of the stack", async () => {
    const s = await stack();

    const done = await s.call("deferGroup", s.ids);

    expect(done.result!.data).toMatchObject({ count: 3 });
    const rows = s.rows();
    expect(rows.map((r) => r.action)).toEqual(["defer", "defer", "defer"]);
    expect(new Set(rows.map((r) => r.bulk)).size).toBe(1);
    expect(rows[0]!.bulk).not.toBeNull();
    expect(rows.every((r) => r.batch === null)).toBe(true);
    expect(s.ids.map(s.state)).toEqual(["deferred", "deferred", "deferred"]);
    expect(await s.queue()).toEqual([]);
  });

  it("still drops a card deferred a third time to Skim, the demote carrying the bulk id", async () => {
    const s = await stack(1);
    const id = s.ids[0]!;
    for (let i = 0; i < 2; i++) {
      await s.c.mutate("scouts.defer", { proposalId: id });
      s.db.prepare("UPDATE proposals SET state = 'pending'").run();
    }

    await s.call("deferGroup", [id]);

    const rows = s.rows();
    expect(rows.slice(-2).map((r) => r.action)).toEqual(["defer", "demote"]);
    expect(rows.at(-1)!.bulk).toBe(rows.at(-2)!.bulk);
  });
});

describe("undo a bulk act", () => {
  it("puts every card back as one act, compensating each row under the same bulk id", async () => {
    const s = await stack();
    const { result } = await s.call("rejectGroup", s.ids);
    const { bulk } = result!.data as { bulk: number };

    const undone = await s.undoBulk(bulk);

    expect(undone.error).toBeUndefined();
    expect(undone.result!.data).toMatchObject({ count: 3 });
    expect(s.ids.map(s.state)).toEqual(["pending", "pending", "pending"]);
    const rows = s.rows();
    expect(rows.map((r) => r.action)).toEqual([
      "reject",
      "reject",
      "reject",
      "undo",
      "undo",
      "undo",
    ]);
    expect(rows.every((r) => r.bulk === bulk)).toBe(true);
    expect((await s.queue()).map((c) => c.id)).toEqual(
      expect.arrayContaining(s.ids)
    );
  });

  it("leaves Accept rate counting none of it afterwards", async () => {
    const s = await stack();
    const { result } = await s.call("rejectGroup", s.ids);
    expect(await s.counts()).toMatchObject([{ rejected: 3 }]);

    await s.undoBulk((result!.data as { bulk: number }).bulk);

    expect(await s.counts()).toEqual([]);
  });

  it("brings a card back from Skim when the defer that demoted it was in the bulk act", async () => {
    const s = await stack(1);
    const id = s.ids[0]!;
    for (let i = 0; i < 2; i++) {
      await s.c.mutate("scouts.defer", { proposalId: id });
      s.db.prepare("UPDATE proposals SET state = 'pending'").run();
    }
    const { result } = await s.call("deferGroup", [id]);
    expect(await s.queue()).toEqual([]);

    await s.undoBulk((result!.data as { bulk: number }).bulk);

    expect((await s.queue()).map((c) => c.id)).toEqual([id]);
  });

  it("takes back only what still stands, and says so when nothing does", async () => {
    const s = await stack(2);
    const { result } = await s.call("deferGroup", s.ids);
    const { bulk } = result!.data as { bulk: number };
    // A clean run of the placing Scout brings one deferral back on its own.
    s.db
      .prepare("UPDATE proposals SET state = 'pending' WHERE id = ?")
      .run(s.ids[0]!);

    const first = await s.undoBulk(bulk);
    expect(first.result!.data).toMatchObject({ count: 1 });

    const again = await s.undoBulk(bulk);
    expect(again.error?.message).toMatch(/nothing/i);
    expect(s.rows().filter((r) => r.action === "undo")).toHaveLength(1);
  });
});
