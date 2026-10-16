import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Card } from "./scouts.js";
import { arxivScout, openedWithQueue, type Seed } from "./scout-queue-seed.js";
import { closeCores } from "./test-core.js";

afterEach(closeCores);

// Rank (ADR 0044 decision 2, #640): authors with accepted work, then
// Corroboration, then Assigned-Question count, then newest — read from the
// record at the moment of reading, never stored, and a sort, never a filter.

const withQuestions = (name: string, assigned: string[]) =>
  arxivScout(name) +
  (assigned.length > 0
    ? `assigned:\n${assigned.map((q) => `  - ${q}\n`).join("")}`
    : "");

async function opened(scouts: Record<string, string>) {
  const s = await openedWithQueue(scouts);
  return {
    ...s,
    /** The Proposal seeded n-th is titled `T<n>`. */
    order: async (sort?: "rank" | "newest") => {
      const r = await s.c.query<Card[]>(
        "scouts.queue",
        sort === undefined ? undefined : { sort }
      );
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    held: async (file: string, authors: string[]) => {
      await mkdir(join(s.vault, "sources"), { recursive: true });
      await writeFile(
        join(s.vault, "sources", `${file}.md`),
        `---\nkind: source-stub\ncitekey: ${file}\ntitle: Held\nauthors:\n${authors.map((a) => `  - ${a}\n`).join("")}---\n`
      );
      await s.c.mutate("vault.checkAgain");
    },
  };
}

const titles = (cards: Card[]) => cards.map((c) => c.title);
const seeded = (over: Seed) => ({ lane: "review" as const, ...over });

describe("Review rank", () => {
  it("is newest-first when there is no history, as before", async () => {
    const q = await opened({ "a.yaml": arxivScout("a") });
    q.seed("a", seeded({ ago: 5, authors: ["X"] }));
    q.seed("a", seeded({ ago: 1, authors: ["Y"] }));

    expect(titles(await q.order())).toEqual(["T2", "T1"]);
    expect((await q.order()).every((c) => c.signals.length === 0)).toBe(true);
  });

  it("lifts a paper by an author with accepted work above a newer one, and says so", async () => {
    const q = await opened({ "a.yaml": arxivScout("a") });
    await q.held("known", ["Ana Meer"]);
    q.seed("a", seeded({ ago: 5, authors: ["x", "  ana meer "] }));
    q.seed("a", seeded({ ago: 1, authors: ["Y"] }));

    const cards = await q.order();

    expect(titles(cards)).toEqual(["T1", "T2"]);
    expect(cards[0]!.signals).toEqual([
      { kind: "authors", names: ["  ana meer "] },
    ]);
    expect(cards[1]!.signals).toEqual([]);
  });

  it("counts a hand-attached Source's authors as accepted work", async () => {
    const q = await opened({ "a.yaml": arxivScout("a") });
    await mkdir(join(q.vault, "sources"), { recursive: true });
    await writeFile(
      join(q.vault, "sources/hand.md"),
      "---\nkind: source\nid: s1\ncitekey: hand\ntitle: Mine\nauthors:\n  - Ana Meer\n---\n"
    );
    await q.c.mutate("vault.checkAgain");
    q.seed("a", seeded({ ago: 5, authors: ["Ana Meer"] }));
    q.seed("a", seeded({ ago: 1, authors: ["Y"] }));

    expect(titles(await q.order())).toEqual(["T1", "T2"]);
  });

  it("breaks ties by Corroboration, then Assigned-Question count, then newest", async () => {
    const q = await opened({
      "a.yaml": withQuestions("a", ["rq1"]),
      "b.yaml": withQuestions("b", ["rq1", "rq2"]),
      "c.yaml": withQuestions("c", []),
    });
    q.seed("c", seeded({ ago: 1 })); // T1: nothing
    q.seed("a", seeded({ ago: 2 })); // T2: one Question
    q.seed("b", seeded({ ago: 3 })); // T3: two Questions
    q.seed("c", seeded({ ago: 6, firstBy: "a" })); // T4: two Scouts

    const cards = await q.order();

    expect(titles(cards)).toEqual(["T4", "T3", "T2", "T1"]);
    expect(cards.map((c) => c.signals)).toEqual([
      [
        { kind: "corroboration", scouts: 2 },
        { kind: "questions", count: 1 },
      ],
      [{ kind: "questions", count: 2 }],
      [{ kind: "questions", count: 1 }],
      [],
    ]);
  });

  it("lets a rejected paper count against nothing", async () => {
    const q = await opened({ "a.yaml": arxivScout("a") });
    q.seed("a", seeded({ action: "reject", authors: ["Ana Meer"] }));
    q.seed("a", seeded({ ago: 5, authors: ["Ana Meer"] }));
    q.seed("a", seeded({ ago: 1, authors: ["Y"] }));

    // The reject lowers nothing: the older paper by the same author is not
    // pushed below an unknown one's, and nothing lifts it either.
    expect(titles(await q.order())).toEqual(["T3", "T2"]);
  });

  it("restores today's order for Newest and hides nothing either way", async () => {
    const q = await opened({ "a.yaml": arxivScout("a") });
    await q.held("known", ["Ana Meer"]);
    q.seed("a", seeded({ ago: 5, authors: ["Ana Meer"] }));
    q.seed("a", seeded({ ago: 1, authors: ["Y"] }));
    q.seed("a", seeded({ ago: 3, authors: ["Z"] }));

    const ranked = await q.order("rank");
    const newest = await q.order("newest");

    expect(titles(ranked)).toEqual(["T1", "T2", "T3"]);
    expect(titles(newest)).toEqual(["T2", "T3", "T1"]);
    expect(newest).toHaveLength(ranked.length);
  });
});
