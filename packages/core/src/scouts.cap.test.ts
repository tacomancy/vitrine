import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Card } from "./scouts.js";
import type { Group } from "./triage.js";
import { arxivScout, openedWithQueue } from "./scout-queue-seed.js";
import { closeCores, virtualClock } from "./test-core.js";

afterEach(closeCores);

// Caps (#647; ADR 0044 decision 5): once a Scout has five counted triage acts,
// a run lets in its top N by Rank and stores the rest as `capped`: counted on
// the group, never rejected, no triage row, released by *show them*.

type Paper = { id: string; authors: string[] };

const entry = ({ id, authors }: Paper) => `<entry>
    <id>http://arxiv.org/abs/${id}v1</id>
    <updated>2026-09-29T10:00:00Z</updated>
    <published>2026-09-29T10:00:00Z</published>
    <title>Paper ${id}</title>
    <summary>An abstract.</summary>
    ${authors.map((a) => `<author><name>${a}</name></author>`).join("\n")}
    <link href="http://arxiv.org/abs/${id}v1" rel="alternate" type="text/html"/>
  </entry>`;

const feed = (papers: Paper[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>${papers.length}</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <opensearch:itemsPerPage>100</opensearch:itemsPerPage>
  ${papers.map(entry).join("\n")}
</feed>`;

const PAPERS: Paper[] = [
  { id: "2609.00001", authors: ["Ana Meer"] },
  { id: "2609.00002", authors: ["B. Two"] },
  { id: "2609.00003", authors: ["C. Three"] },
  { id: "2609.00004", authors: ["D. Four"] },
];

async function opened(cap: string | null, acts: number) {
  let body = feed(PAPERS);
  const q = await openedWithQueue(
    {
      "a.yaml": arxivScout("a") + (cap === null ? "" : `cap: ${cap}\n`),
    },
    {},
    {
      arxiv: {
        clock: virtualClock(),
        fetch: () => Promise.resolve(new Response(body)),
      },
    }
  );
  for (let i = 0; i < acts; i++) {
    q.seed("a", { action: i % 2 === 0 ? "accept" : "reject" });
  }
  // The author whose accepted work lifts the first paper in the feed.
  await mkdir(join(q.vault, "sources"), { recursive: true });
  await writeFile(
    join(q.vault, "sources/known.md"),
    "---\nkind: source-stub\ncitekey: known\ntitle: Held\nauthors:\n  - Ana Meer\n---\n"
  );
  await q.c.mutate("vault.checkAgain");
  const triageRows = () =>
    (q.db.prepare("SELECT COUNT(*) AS n FROM triage").get() as { n: number }).n;
  return {
    ...q,
    triageRows,
    run: async () =>
      expect(
        (await q.c.mutate("scouts.runNow", { scoutId: "a" })).error
      ).toBeUndefined(),
    stack: async () =>
      (await q.c.query<Card[]>("scouts.queue"))
        .result!.data.filter((card) => card.title.startsWith("Paper"))
        .map((card) => card.title),
    group: async () =>
      (await q.c.query<Group[]>("scouts.groups")).result!.data.find(
        (g) => g.id === "a"
      )!,
    states: () =>
      q.db
        .prepare(
          "SELECT state, COUNT(*) AS n FROM proposals WHERE title LIKE 'Paper%' GROUP BY state"
        )
        .all() as Array<{ state: string; n: number }>,
    arrive: (papers: Paper[]) => {
      body = feed(papers);
    },
  };
}

describe("a Scout's cap", () => {
  it("changes nothing below five counted triage acts", async () => {
    const q = await opened("2", 4);

    await q.run();

    expect(await q.stack()).toHaveLength(4);
    expect((await q.group()).capped).toBe(0);
    expect(q.states()).toEqual([{ state: "pending", n: 4 }]);
  });

  it("changes nothing without a cap, however much history", async () => {
    const q = await opened(null, 6);

    await q.run();

    expect(await q.stack()).toHaveLength(4);
    expect((await q.group()).capped).toBe(0);
  });

  it("keeps the top N by Rank once the floor is met and stores the rest as capped", async () => {
    const q = await opened("2", 5);
    const before = q.triageRows();

    await q.run();

    // The author with accepted work outranks the rest; ties go to the card
    // the stack would show first (the later one).
    expect((await q.stack()).sort()).toEqual([
      "Paper 2609.00001",
      "Paper 2609.00004",
    ]);
    expect(q.states()).toEqual(
      expect.arrayContaining([
        { state: "pending", n: 2 },
        { state: "capped", n: 2 },
      ])
    );
    const group = await q.group();
    expect(group.capped).toBe(2);
    expect(group.cap).toBe(2);
    // Never rejected and never logged: Accept rate cannot move for these.
    expect(q.triageRows()).toBe(before);
  });

  it("releases what it cut when asked, and still logs nothing", async () => {
    const q = await opened("2", 5);
    await q.run();
    const before = q.triageRows();

    const released = await q.c.mutate("scouts.showCapped", { scoutId: "a" });

    expect(released.error).toBeUndefined();
    expect(await q.stack()).toHaveLength(4);
    expect((await q.group()).capped).toBe(0);
    expect(q.states()).toEqual([{ state: "pending", n: 4 }]);
    expect(q.triageRows()).toBe(before);
  });

  it("counts each run's arrivals on their own, and leaves capped rows capped when a paper is found again", async () => {
    const q = await opened("2", 5);
    await q.run();

    q.arrive(PAPERS);
    await q.run();

    expect((await q.group()).capped).toBe(2);
    expect(await q.stack()).toHaveLength(2);
  });
});
