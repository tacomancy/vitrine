import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { reviewDepth } from "./review-depth.js";
import type { ScoutActivity } from "./scout-activity.js";
import { closeCores, core, fixtureCopy } from "./test-core.js";

afterEach(closeCores);

// Review depth and age (#518; ADR 0042 decision 7): pending and deferred
// counted apart, age as the median and oldest `first_seen`. The queue is
// seeded directly; what is asserted is what a row and the fleet header carry.

const NOW = new Date("2026-09-30T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

const scoutFile = (name: string) =>
  `name: ${name}\ncadence: daily\nlane: review\ncreated: 2026-06-01T00:00:00Z\nfilter:\n  query: all:${name}\n`;

type Seed = {
  /** The Scouts that found it, in order: the first is the one whose Appearance came first. */
  by: string[];
  /** First seen this many days ago. */
  age: number;
  state?: "pending" | "deferred" | "held";
  lane?: "review" | "skim";
};

async function opened(names: string[]) {
  const vault = await fixtureCopy("obsidian-vault");
  for (const name of names) {
    const path = join(vault, ".vitrine/scouts", `${name}.yaml`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, scoutFile(name));
  }
  const c = await core({ now: () => NOW });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const db = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"));
  let n = 0;
  return {
    db,
    seed({ by, age, state = "pending", lane = "review" }: Seed) {
      n += 1;
      const id = Number(
        db
          .prepare(
            `INSERT INTO proposals (source_key, title, authors, published, venue, abstract, url, lane, state, first_seen)
             VALUES (?, ?, '["A"]', '2026-01-01', 'J', '', 'https://x.example', ?, ?, ?)`
          )
          .run(`k${n}`, `T${n}`, lane, state, daysAgo(age)).lastInsertRowid
      );
      for (const scout of by) {
        const run = Number(
          db
            .prepare(
              `INSERT INTO scout_runs (scout_id, started, finished, outcome, window_from, window_to, retroactive)
               VALUES (?, ?, ?, 'ok', ?, ?, 0)`
            )
            .run(
              scout,
              daysAgo(age),
              daysAgo(age),
              daysAgo(age + 1),
              daysAgo(age)
            ).lastInsertRowid
        );
        db.prepare(
          "INSERT INTO appearances (proposal_id, run_id, scout_id, seen_at, url) VALUES (?, ?, ?, ?, 'https://x.example')"
        ).run(id, run, scout, daysAgo(age));
      }
    },
    activity: async () => {
      const r = await c.query<ScoutActivity>("scouts.activity");
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
  };
}

const rowOf = (a: ScoutActivity, id: string) => {
  const row = a.rows.find((r) => r.kind === "scout" && r.id === id);
  if (row?.kind !== "scout") throw new Error("no such row");
  return row;
};

describe("scouts.activity — Review depth", () => {
  it("counts pending apart from deferred, per Scout and fleet-wide, leaving Skim and held out", async () => {
    const f = await opened(["alpha", "beta"]);
    f.seed({ by: ["alpha"], age: 3 });
    f.seed({ by: ["alpha"], age: 5 });
    f.seed({ by: ["alpha"], age: 9, state: "deferred" });
    f.seed({ by: ["beta"], age: 1 });
    f.seed({ by: ["beta"], age: 2, lane: "skim" });
    f.seed({ by: ["beta"], age: 2, state: "held" });

    const a = await f.activity();

    expect(rowOf(a, "alpha").review).toMatchObject({ pending: 2, deferred: 1 });
    expect(rowOf(a, "beta").review).toMatchObject({ pending: 1, deferred: 0 });
    expect(a.review).toMatchObject({ pending: 3, deferred: 1 });
  });

  it("waits under every Scout that found a paper, as the Queue's stack does, and once in the fleet", async () => {
    const f = await opened(["alpha", "beta"]);
    f.seed({ by: ["alpha", "beta"], age: 4 });
    f.seed({ by: ["alpha"], age: 2 });

    const a = await f.activity();

    // `beta` found one card and the Queue lists it in beta's stack: a row that
    // said nothing was pending beside that stack would be wrong, not quiet.
    expect(rowOf(a, "alpha").review.pending).toBe(2);
    expect(rowOf(a, "beta").review).toMatchObject({
      pending: 1,
      oldest: { at: daysAgo(4), ago: "4 days ago" },
    });
    expect(a.review.pending).toBe(2);
  });

  it("has no figure for a Scout nothing waits under, and none for a vault with no Proposals", async () => {
    const f = await opened(["alpha"]);

    const a = await f.activity();

    const none = { pending: 0, deferred: 0, median: null, oldest: null };
    expect(rowOf(a, "alpha").review).toEqual(none);
    expect(a.review).toEqual(none);
  });
});

describe("scouts.activity — Review age", () => {
  it("states age as the median and the oldest first_seen of the pending ones, deferred ignored", async () => {
    const f = await opened(["alpha"]);
    for (const age of [10, 4, 2]) f.seed({ by: ["alpha"], age });
    f.seed({ by: ["alpha"], age: 30, state: "deferred" });

    const odd = rowOf(await f.activity(), "alpha").review;

    expect(odd.median).toEqual({ at: daysAgo(4), ago: "4 days ago" });
    expect(odd.oldest).toEqual({ at: daysAgo(10), ago: "10 days ago" });

    f.seed({ by: ["alpha"], age: 6 });
    const even = rowOf(await f.activity(), "alpha").review;

    // 10, 6, 4, 2 — halfway between 6 and 4.
    expect(even.median).toEqual({ at: daysAgo(5), ago: "5 days ago" });
    expect(even.oldest?.ago).toBe("10 days ago");
  });

  it("is one row's age for a single pending Proposal, which is its own median and its own oldest", async () => {
    const f = await opened(["alpha"]);
    f.seed({ by: ["alpha"], age: 3 });

    const { median, oldest } = rowOf(await f.activity(), "alpha").review;

    expect(median).toEqual({ at: daysAgo(3), ago: "3 days ago" });
    expect(oldest).toEqual(median);
  });
});

describe("reviewDepth — the derivation Home reads", () => {
  it("hands the fleet header the very figures Home will be handed, so Home never computes them again", async () => {
    const f = await opened(["alpha", "beta"]);
    f.seed({ by: ["alpha", "beta"], age: 2 });
    f.seed({ by: ["alpha"], age: 4 });
    f.seed({ by: ["beta"], age: 6, state: "deferred" });

    const homes = reviewDepth(f.db, NOW);

    expect(homes.fleet).toMatchObject({ pending: 2, deferred: 1 });
    expect(homes.byScout.get("alpha")?.oldest?.ago).toBe("4 days ago");
    expect((await f.activity()).review).toEqual(homes.fleet);
  });
});
