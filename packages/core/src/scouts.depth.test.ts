import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { ReviewDepth } from "./review-depth.js";
import type { ScoutActivity } from "./scout-activity.js";
import { closeCores, core, fixtureCopy } from "./test-core.js";

afterEach(closeCores);

// Home's Waiting section reads `scouts.depth` (spec #728, #731). It must be
// the figure Scout Activity shows, not a second count of the same stack.

const NOW = new Date("2026-09-30T12:00:00Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

async function opened() {
  const vault = await fixtureCopy("obsidian-vault");
  const path = join(vault, ".vitrine/scouts/alpha.yaml");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    "name: alpha\ncadence: daily\nlane: review\ncreated: 2026-06-01T00:00:00Z\nfilter:\n  query: all:alpha\n"
  );
  const c = await core({ now: () => NOW });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const db = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"));
  let n = 0;
  const seed = (
    age: number,
    state: "pending" | "deferred",
    lane = "review"
  ) => {
    n += 1;
    const id = Number(
      db
        .prepare(
          `INSERT INTO proposals (source_key, title, authors, published, venue, abstract, url, lane, state, first_seen)
           VALUES (?, ?, '["A"]', '2026-01-01', 'J', '', 'https://x.example', ?, ?, ?)`
        )
        .run(`k${n}`, `T${n}`, lane, state, daysAgo(age)).lastInsertRowid
    );
    const run = Number(
      db
        .prepare(
          `INSERT INTO scout_runs (scout_id, started, finished, outcome, window_from, window_to, retroactive)
           VALUES ('alpha', ?, ?, 'ok', ?, ?, 0)`
        )
        .run(daysAgo(age), daysAgo(age), daysAgo(age + 1), daysAgo(age))
        .lastInsertRowid
    );
    db.prepare(
      "INSERT INTO appearances (proposal_id, run_id, scout_id, seen_at, url) VALUES (?, ?, 'alpha', ?, 'https://x.example')"
    ).run(id, run, daysAgo(age));
  };
  return { seed, c };
}

describe("scouts.depth", () => {
  it("is the fleet figure Scout Activity carries: aged inside pending, deferred apart, Skim absent", async () => {
    const f = await opened();
    f.seed(2, "pending");
    f.seed(40, "pending"); // past the default window, still counted
    f.seed(9, "deferred");
    f.seed(1, "pending", "skim");

    const depth = await f.c.query<ReviewDepth>("scouts.depth");
    const activity = await f.c.query<ScoutActivity>("scouts.activity");

    expect(depth.error).toBeUndefined();
    expect(depth.result!.data).toEqual(activity.result!.data.review);
    expect(depth.result!.data).toMatchObject({
      pending: 2,
      deferred: 1,
      pastWindow: 1,
    });
  });
});
