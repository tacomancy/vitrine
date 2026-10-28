import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openQueue } from "./queue.js";

// Version 18 to 19 (#910, ADR 0056 decision 3) adds `scout_runs.check_id`,
// which ties together the runs of one check of a Scout's pages. No run was
// part of a check of several before, so every earlier row has none and
// stands as a check of its own.

describe("the queue database, version 18 to 19", () => {
  it("adds the column and leaves an existing run as it was", async () => {
    const vault = await mkdtemp(join(tmpdir(), "vitrine-queue-"));
    await mkdir(join(vault, ".vitrine"), { recursive: true });
    const first = await openQueue(vault);
    first.exec("ALTER TABLE scout_runs DROP COLUMN check_id");
    first.exec(
      `INSERT INTO scout_runs (id, scout_id, started, finished, outcome, window_from, window_to, retroactive, fetched, new, query)
       VALUES (7, 'lab', '2026-10-27T10:00:00Z', '2026-10-27T10:01:00Z', 'ok', '2026-10-27T10:00:00Z', '2026-10-27T10:00:00Z', 1, 3, 3, 'https://lab.example/research')`
    );
    first.exec("PRAGMA user_version = 18");
    first.close();

    const migrated = await openQueue(vault);
    expect(
      migrated
        .prepare(
          "SELECT scout_id, outcome, retroactive, fetched, new, query, check_id FROM scout_runs WHERE id = 7"
        )
        .get()
    ).toEqual({
      scout_id: "lab",
      outcome: "ok",
      retroactive: 1,
      fetched: 3,
      new: 3,
      query: "https://lab.example/research",
      check_id: null,
    });
    migrated.close();
  });
});
