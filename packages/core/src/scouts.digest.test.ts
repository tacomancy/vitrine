import { afterEach, describe, expect, it } from "vitest";
import type { Card } from "./scouts.js";
import type { ScoutActivity } from "./scout-activity.js";
import { arxivScout, openedWithQueue, type Seed } from "./scout-queue-seed.js";
import { closeCores } from "./test-core.js";

afterEach(closeCores);

// Aging into a digest (#642; ADR 0044 decision 3): Review items older than
// their Scout's window leave the stack for the foot, flagged, and stay
// pending and counted. Nothing moves a Lane and nothing is decided.

const windowed = (name: string, days: number | null) =>
  arxivScout(name) + (days === null ? "" : `review_days: ${days}\n`);

async function opened(scouts: Record<string, string>) {
  const s = await openedWithQueue(scouts);
  return {
    ...s,
    queue: async (sort?: "rank" | "newest") => {
      const r = await s.c.query<Card[]>(
        "scouts.queue",
        sort === undefined ? undefined : { sort }
      );
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    depth: async (scout?: string) => {
      const r = await s.c.query<ScoutActivity>("scouts.activity");
      expect(r.error).toBeUndefined();
      if (scout === undefined) return r.result!.data.review;
      const row = r.result!.data.rows.find(
        (x) => x.kind === "scout" && x.id === scout
      );
      if (row?.kind !== "scout") throw new Error(`no row for ${scout}`);
      return row.review;
    },
  };
}

const review = (over: Seed) => ({ lane: "review" as const, ...over });
const digested = (cards: Card[]) =>
  cards.filter((c) => c.pastWindow).map((c) => c.title);
const live = (cards: Card[]) =>
  cards.filter((c) => !c.pastWindow).map((c) => c.title);

describe("the Review digest", () => {
  it("flags items older than the Scout's window and puts them after every live card", async () => {
    const q = await opened({ "a.yaml": windowed("a", 7) });
    q.seed("a", review({ ago: 20 }));
    q.seed("a", review({ ago: 2 }));
    q.seed("a", review({ ago: 9 }));
    q.seed("a", review({ ago: 1 }));

    for (const sort of ["rank", "newest"] as const) {
      const cards = await q.queue(sort);
      expect(live(cards)).toEqual(["T4", "T2"]);
      expect(digested(cards)).toEqual(["T3", "T1"]);
      // The foot of the stack: live first, then the digest.
      expect(cards.map((c) => c.pastWindow)).toEqual([
        false,
        false,
        true,
        true,
      ]);
    }
  });

  it("uses 14 days for a Scout that sets no review_days", async () => {
    const q = await opened({ "a.yaml": windowed("a", null) });
    q.seed("a", review({ ago: 13 }));
    q.seed("a", review({ ago: 15 }));

    expect(digested(await q.queue())).toEqual(["T2"]);
  });

  it("ages by the Scout window, so a weekly and a daily Scout age differently", async () => {
    const q = await opened({
      "a.yaml": windowed("a", 3),
      "b.yaml": windowed("b", 30),
    });
    q.seed("a", review({ ago: 5 }));
    q.seed("b", review({ ago: 5 }));

    expect(digested(await q.queue())).toEqual(["T1"]);
  });

  it("leaves the item pending, in its Lane, and still counted in Review depth with a past-window count beside it", async () => {
    const q = await opened({
      "a.yaml": windowed("a", 7),
      "b.yaml": windowed("b", 7),
    });
    q.seed("a", review({ ago: 20 }));
    q.seed("a", review({ ago: 2 }));
    q.seed("b", review({ ago: 3 }));

    const cards = await q.queue();
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => c.lane === "review")).toBe(true);
    expect(await q.depth()).toMatchObject({ pending: 3, pastWindow: 1 });
    expect(await q.depth("a")).toMatchObject({ pending: 2, pastWindow: 1 });
    expect(await q.depth("b")).toMatchObject({ pending: 1, pastWindow: 0 });
    // Aging writes no triage row and moves no state.
    const rows = q.db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM triage) t, (SELECT COUNT(*) FROM proposals WHERE state = 'pending' AND lane = 'review') p"
      )
      .get();
    expect(rows).toMatchObject({ t: 0, p: 3 });
  });

  it("does not count a deferred or Skim item as past the window", async () => {
    const q = await opened({ "a.yaml": windowed("a", 7) });
    q.seed("a", review({ ago: 20 }));
    q.db.prepare("UPDATE proposals SET state = 'deferred'").run();
    q.seed("a", { lane: "skim", ago: 20 });

    expect(await q.depth()).toMatchObject({ pending: 0, pastWindow: 0 });
    expect(await q.queue()).toEqual([]);
  });

  it("takes a digested item through triage like any other", async () => {
    const q = await opened({ "a.yaml": windowed("a", 7) });
    q.seed("a", review({ ago: 20 }));
    q.seed("a", review({ ago: 1 }));
    const [, old] = await q.queue();
    expect(old!.pastWindow).toBe(true);

    const r = await q.c.mutate("scouts.reject", { proposalId: old!.id });
    expect(r.error).toBeUndefined();

    expect((await q.queue()).map((c) => c.title)).toEqual(["T2"]);
    expect(await q.depth()).toMatchObject({ pending: 1, pastWindow: 0 });
  });

  it("ages a paper by the Scout that found it first", async () => {
    const q = await opened({
      "a.yaml": windowed("a", 7),
      "b.yaml": windowed("b", 30),
    });
    q.seed("b", review({ ago: 10, firstBy: "a" }));

    expect(digested(await q.queue())).toEqual(["T1"]);
  });
});
