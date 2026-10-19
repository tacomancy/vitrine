import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AcceptCounts } from "./triage.js";
import type { Card } from "./scouts.js";
import { arxivScout, openedWithQueue, type Seed } from "./scout-queue-seed.js";
import {
  closeCores,
  core,
  fixtureCopy,
  fixtures,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// Lane moves (#643; ADR 0044 decision 8): a Review Proposal deferred a third
// time drops to Skim (`demote`), a Skim Proposal a second Scout also finds
// rises to Review (`raise`). Both are triage rows, the card says why, and a
// raise keeps the Proposal out of Accept rate as a hand promotion does.

const review = (over: Seed = {}): Seed => ({ lane: "review", ...over });

async function demotable() {
  const q = await openedWithQueue({ "a.yaml": arxivScout("a") });
  q.seed("a", review());
  const id = (q.db.prepare("SELECT id FROM proposals").get() as { id: number })
    .id;
  const act = async (name: "defer" | "undo" | "promote") =>
    (await q.c.mutate(`scouts.${name}`, { proposalId: id })).error?.message;
  /** What a clean run of the placing Scout does to a deferral. */
  const returned = () =>
    q.db
      .prepare(
        "UPDATE proposals SET state = 'pending' WHERE state = 'deferred'"
      )
      .run();
  const rows = () =>
    q.db
      .prepare("SELECT action FROM triage WHERE proposal_id = ? ORDER BY rowid")
      .all(id)
      .map((r) => (r as { action: string }).action);
  const queue = async () =>
    (await q.c.query<Card[]>("scouts.queue")).result!.data;
  const skim = async () =>
    (await q.c.query<{ recent: Card[]; older: Card[] }>("scouts.skim")).result!
      .data.recent;
  const defers = async (n: number) => {
    for (let i = 0; i < n; i++) {
      expect(await act("defer")).toBeUndefined();
      returned();
    }
  };
  return { ...q, id, act, returned, rows, queue, skim, defers };
}

describe("demote", () => {
  it("drops a Proposal deferred a third time to Skim and writes a demote row", async () => {
    const d = await demotable();

    await d.defers(2);
    expect(d.rows()).toEqual(["defer", "defer"]);
    expect(await d.queue()).toHaveLength(1);

    await d.act("defer");

    expect(d.rows()).toEqual(["defer", "defer", "defer", "demote"]);
    expect(await d.queue()).toEqual([]);
    const [line] = await d.skim();
    expect(line).toMatchObject({ id: d.id, moved: { kind: "demoted" } });
  });

  it("does not count a defer that was undone", async () => {
    const d = await demotable();

    await d.act("defer");
    await d.act("undo");
    await d.defers(2);

    expect(d.rows()).not.toContain("demote");
    expect(await d.queue()).toHaveLength(1);

    await d.act("defer");
    expect(d.rows().at(-1)).toBe("demote");
  });

  it("counts defers across rejects taken back: an undone reject is no defer", async () => {
    const d = await demotable();

    await d.defers(2);
    expect(
      (await d.c.mutate("scouts.reject", { proposalId: d.id })).error
    ).toBeUndefined();
    await d.act("undo");
    await d.act("defer");

    expect(d.rows().at(-1)).toBe("demote");
  });

  it("can still be promoted by hand, and the card then says nothing of it", async () => {
    const d = await demotable();
    await d.defers(3);

    expect(await d.act("promote")).toBeUndefined();

    const [card] = await d.queue();
    expect(card).toMatchObject({ id: d.id, moved: null });
  });

  it("starts the count again after a hand promotion", async () => {
    const d = await demotable();
    await d.defers(3);
    await d.act("promote");

    await d.defers(2);
    expect(d.rows().filter((a) => a === "demote")).toHaveLength(1);

    await d.act("defer");
    expect(d.rows().filter((a) => a === "demote")).toHaveLength(2);
  });

  it("is taken back by undoing the defer that caused it", async () => {
    const d = await demotable();
    await d.defers(2);
    await d.act("defer");

    expect(await d.act("undo")).toBeUndefined();

    expect(await d.queue()).toHaveLength(1);
    expect((await d.queue())[0]!.moved).toBeNull();
    expect(await d.skim()).toEqual([]);
    // The taken-back defer is not one of the three.
    await d.act("defer");
    expect(d.rows().at(-1)).toBe("demote");
  });

  it("leaves a Proposal in Skim after the Scout's next clean run, not deferred", async () => {
    const d = await demotable();
    await d.defers(3);

    expect(
      d.db.prepare("SELECT state, lane FROM proposals").get()
    ).toMatchObject({ state: "pending", lane: "skim" });
  });
});

describe("Accept rate", () => {
  const counts = async (c: Awaited<ReturnType<typeof demotable>>["c"]) =>
    (await c.query<AcceptCounts[]>("scouts.acceptCounts")).result!.data;

  it("excludes a raised Proposal, as it does a promoted one", async () => {
    const q = await openedWithQueue({ "a.yaml": arxivScout("a") });
    q.seed("a", review({ action: "accept" }));
    q.seed("a", review({ action: "accept" }));
    q.seed("a", review({ action: "reject" }));
    expect(await counts(q.c)).toMatchObject([{ accepted: 2, rejected: 1 }]);

    // Raised on arrival, then accepted: the Scout did not place it.
    q.seed("a", review({ action: "accept" }));
    const id = (
      q.db.prepare("SELECT max(id) AS id FROM proposals").get() as {
        id: number;
      }
    ).id;
    q.db
      .prepare(
        "INSERT INTO triage (proposal_id, action, at) VALUES (?, 'raise', ?)"
      )
      .run(id, "2026-09-29T00:00:00Z");

    expect(await counts(q.c)).toMatchObject([{ accepted: 2, rejected: 1 }]);
  });

  it("still excludes a promoted Proposal", async () => {
    const q = await openedWithQueue({ "a.yaml": arxivScout("a") });
    q.seed("a", review({ action: "accept", promoted: true }));
    q.seed("a", review({ action: "accept" }));

    expect(await counts(q.c)).toMatchObject([{ accepted: 1, rejected: 0 }]);
  });
});

describe("raise", () => {
  const NOW = new Date("2026-09-30T12:00:00Z");

  async function twoScouts() {
    const vault = await fixtureCopy("obsidian-vault");
    const yaml = (name: string, lane: string) =>
      `name: ${name}\ncadence: daily\nlane: ${lane}\ncreated: 2026-09-20T00:00:00Z\nfilter:\n  query: all:sleep\n`;
    await mkdir(join(vault, ".vitrine/scouts"), { recursive: true });
    await writeFile(
      join(vault, ".vitrine/scouts/quiet.yaml"),
      yaml("Quiet", "skim")
    );
    await writeFile(
      join(vault, ".vitrine/scouts/loud.yaml"),
      yaml("Loud", "skim")
    );
    const atom = await readFile(join(fixtures, "arxiv", "normal.xml"), "utf8");
    const c = await core({
      now: () => NOW,
      arxiv: {
        clock: virtualClock(),
        fetch: () => Promise.resolve(new Response(atom)),
      },
    });
    expect(
      (await c.mutate("vault.open", { path: vault })).error
    ).toBeUndefined();
    await c.indexed();
    return {
      c,
      run: (scoutId: string) => c.mutate("scouts.runNow", { scoutId }),
      skim: async () =>
        (await c.query<{ recent: Card[] }>("scouts.skim")).result!.data.recent,
      queue: async () => (await c.query<Card[]>("scouts.queue")).result!.data,
    };
  }

  it("lifts a Skim Proposal a second Scout also finds, writes a raise row and says who found it", async () => {
    const s = await twoScouts();
    await s.run("quiet");
    expect(await s.queue()).toEqual([]);
    const before = await s.skim();
    expect(before.length).toBeGreaterThan(0);

    await s.run("loud");

    expect(await s.skim()).toEqual([]);
    const cards = await s.queue();
    expect(cards).toHaveLength(before.length);
    expect(cards[0]!.moved).toEqual({
      kind: "raised",
      by: { id: "loud", name: "Loud" },
    });
  });

  it("does not raise a muted line, so deleting the rule returns it to Skim with no raise row", async () => {
    const s = await twoScouts();
    await s.run("quiet");
    const [held] = await s.skim();
    const rule = { kind: "keyword", value: held!.title };
    expect((await s.c.mutate("scouts.mute", rule)).error).toBeUndefined();

    await s.run("loud");
    expect((await s.c.mutate("scouts.unmute", rule)).error).toBeUndefined();

    expect((await s.queue()).map((c) => c.id)).not.toContain(held!.id);
    expect((await s.skim()).map((c) => c.id)).toContain(held!.id);
  });

  it("does not raise on the same Scout finding it again, nor leave Skim for a Review card", async () => {
    const s = await twoScouts();
    await s.run("quiet");
    await s.run("quiet");

    expect(await s.queue()).toEqual([]);
    expect((await s.skim()).length).toBeGreaterThan(0);
  });
});
