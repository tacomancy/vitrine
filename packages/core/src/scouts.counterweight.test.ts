import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Card } from "./scouts.js";
import { arxivScout, openedWithQueue, type Seed } from "./scout-queue-seed.js";
import { closeCores, virtualClock } from "./test-core.js";

afterEach(closeCores);

// The counterweight slot (#648; ADR 0044 decision 7): once a Scout has five
// counted triage acts, its group reserves the second place in Review for one
// Proposal found by two or more Scouts none of whose authors has accepted work
// — never filled with a Proposal that does not qualify, and exempt from the Cap.

const KNOWN = "Ana Meer";

async function opened(acts: number) {
  const q = await openedWithQueue({
    "a.yaml": arxivScout("a"),
    "b.yaml": arxivScout("b"),
  });
  for (let i = 0; i < acts; i++) {
    q.seed("a", { action: i % 2 === 0 ? "accept" : "reject" });
  }
  await mkdir(join(q.vault, "sources"), { recursive: true });
  await writeFile(
    join(q.vault, "sources/known.md"),
    `---\nkind: source-stub\ncitekey: known\ntitle: Held\nauthors:\n  - ${KNOWN}\n---\n`
  );
  await q.c.mutate("vault.checkAgain");
  return {
    ...q,
    /** Proposals seeded after the acts are titled by their order here; the acts take T1..Tn. */
    cards: async (sort?: "rank" | "newest") =>
      (
        await q.c.query<Card[]>(
          "scouts.queue",
          sort === undefined ? undefined : { sort }
        )
      ).result!.data,
  };
}

const pend = (over: Seed = {}): Seed => ({ lane: "review", ...over });
const titles = (cards: Card[]) => cards.map((c) => c.title);

/** Two accepted-author cards that rank first, a corroborated stranger, and a newer single find. */
function seedStack(
  q: Awaited<ReturnType<typeof opened>>,
  strangerAuthors: string[]
) {
  q.seed("a", pend({ ago: 6, authors: [KNOWN] })); // known1
  q.seed("a", pend({ ago: 5, authors: [KNOWN] })); // known2
  q.seed("b", pend({ ago: 4, authors: strangerAuthors, firstBy: "a" })); // corroborated
  q.seed("a", pend({ ago: 1, authors: ["Plain"] })); // newest, single
}

describe("the counterweight slot", () => {
  it("puts a corroborated paper from unaccepted authors second, and labels it", async () => {
    const q = await opened(5);
    seedStack(q, ["Stranger"]);

    const cards = await q.cards();

    // Rank alone would put it third, behind both accepted-author cards.
    expect(titles(cards)).toEqual(["T7", "T8", "T6", "T9"]);
    expect(cards.map((c) => c.counterweight)).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });

  it("is empty when nothing qualifies, with no filler", async () => {
    const q = await opened(5);
    // Corroborated, but its author has accepted work; and a single find by a stranger.
    q.seed("b", pend({ ago: 4, authors: [KNOWN], firstBy: "a" }));
    q.seed("a", pend({ ago: 1, authors: ["Plain"] }));

    const cards = await q.cards();

    expect(cards.some((c) => c.counterweight)).toBe(false);
    expect(titles(cards)).toEqual(["T6", "T7"]);
  });

  it("does not exist below five counted acts", async () => {
    const q = await opened(4);
    seedStack(q, ["Stranger"]);

    const cards = await q.cards();

    expect(cards.some((c) => c.counterweight)).toBe(false);
    expect(titles(cards)).toEqual(["T6", "T5", "T7", "T8"]);
  });

  it("keeps a card that already ranks in the top two where it is", async () => {
    const q = await opened(5);
    q.seed("a", pend({ ago: 5, authors: [KNOWN] })); // T6
    q.seed("b", pend({ ago: 4, authors: ["Stranger"], firstBy: "a" })); // T7
    q.seed("a", pend({ ago: 1, authors: ["Plain"] })); // T8

    const cards = await q.cards();

    expect(titles(cards)).toEqual(["T6", "T7", "T8"]);
    expect(cards.map((c) => c.counterweight)).toEqual([false, true, false]);
  });

  it("holds one slot per group, for the best qualifying paper", async () => {
    const q = await opened(5);
    q.seed("a", pend({ ago: 6, authors: [KNOWN] })); // T6
    q.seed("a", pend({ ago: 5, authors: [KNOWN] })); // T7
    q.seed("b", pend({ ago: 4, authors: ["S1"], firstBy: "a" })); // T8
    q.seed("b", pend({ ago: 2, authors: ["S2"], firstBy: "a" })); // T9, newer

    const cards = await q.cards();

    expect(cards.filter((c) => c.counterweight).map((c) => c.title)).toEqual([
      "T9",
    ]);
    expect(titles(cards)).toEqual(["T7", "T9", "T6", "T8"]);
  });

  it("is a Rank placement: Newest keeps its own order and carries no slot", async () => {
    const q = await opened(5);
    seedStack(q, ["Stranger"]);

    const cards = await q.cards("newest");

    expect(titles(cards)).toEqual(["T9", "T8", "T7", "T6"]);
    expect(cards.some((c) => c.counterweight)).toBe(false);
  });
});

describe("the counterweight slot and the cap", () => {
  const entry = (id: string, author: string) => `<entry>
    <id>http://arxiv.org/abs/${id}v1</id>
    <updated>2026-09-29T10:00:00Z</updated>
    <published>2026-09-29T10:00:00Z</published>
    <title>Paper ${id}</title>
    <summary>An abstract.</summary>
    <author><name>${author}</name></author>
    <link href="http://arxiv.org/abs/${id}v1" rel="alternate" type="text/html"/>
  </entry>`;
  const feedOf = (fourth: string) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>4</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <opensearch:itemsPerPage>100</opensearch:itemsPerPage>
  ${[
    entry("2609.00001", KNOWN),
    entry("2609.00002", "B. Two"),
    entry("2609.00003", "C. Three"),
    entry("2609.00004", fourth),
  ].join("\n")}
</feed>`;

  async function capped(fourth = KNOWN) {
    const feed = feedOf(fourth);
    const q = await openedWithQueue(
      {
        "a.yaml": arxivScout("a") + "cap: 2\n",
        "b.yaml": arxivScout("b"),
      },
      {},
      {
        arxiv: {
          clock: virtualClock(),
          fetch: () => Promise.resolve(new Response(feed)),
        },
      }
    );
    for (let i = 0; i < 5; i++) {
      q.seed("a", { action: i % 2 === 0 ? "accept" : "reject" });
    }
    await mkdir(join(q.vault, "sources"), { recursive: true });
    await writeFile(
      join(q.vault, "sources/known.md"),
      `---\nkind: source-stub\ncitekey: known\ntitle: Held\nauthors:\n  - ${KNOWN}\n---\n`
    );
    await q.c.mutate("vault.checkAgain");
    const run = async (id: string) =>
      expect(
        (await q.c.mutate("scouts.runNow", { scoutId: id })).error
      ).toBeUndefined();
    const states = () =>
      q.db
        .prepare(
          "SELECT title, state FROM proposals WHERE title LIKE 'Paper%' ORDER BY title"
        )
        .all() as Array<{ title: string; state: string }>;
    return { ...q, run, states };
  }

  it("lets a second Scout's find release the one capped paper the slot would hold", async () => {
    const q = await capped();
    await q.run("a");
    expect(q.states().filter((p) => p.state === "capped")).toHaveLength(2);

    await q.run("b");

    // Both capped papers are now corroborated and from strangers, but the
    // slot is one: the newer comes back and the other stays below the cap.
    expect(q.states()).toEqual([
      { title: "Paper 2609.00001", state: "pending" },
      { title: "Paper 2609.00002", state: "capped" },
      { title: "Paper 2609.00003", state: "pending" },
      { title: "Paper 2609.00004", state: "pending" },
    ]);
    const stack = (await q.c.query<Card[]>("scouts.queue")).result!.data.filter(
      (c) => c.title.startsWith("Paper")
    );
    expect(stack.map((c) => c.title)).toEqual([
      "Paper 2609.00004",
      "Paper 2609.00003",
      "Paper 2609.00001",
    ]);
    expect(stack[1]!.counterweight).toBe(true);
  });

  it("releases nothing when the stack already holds a qualifying paper", async () => {
    const q = await capped("D. Four");
    await q.run("a");

    await q.run("b");

    // Paper 4 was kept, is now corroborated and from a stranger: it is the slot.
    expect(q.states().filter((p) => p.state === "capped")).toHaveLength(2);
  });

  it("leaves a capped paper capped when the Scout is below the floor", async () => {
    const q = await capped();
    await q.run("a");
    q.db
      .prepare("DELETE FROM triage WHERE action IN ('accept','reject')")
      .run();

    await q.run("b");

    expect(q.states().filter((p) => p.state === "capped")).toHaveLength(2);
  });
});
