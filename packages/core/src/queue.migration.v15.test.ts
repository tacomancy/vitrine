import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openQueue } from "./queue.js";

// Version 15 to 16 (#886, ADR 0055) adds `scout_runs.item_values_dropped`,
// the values an Item page's Extraction copied that were not on that page. A
// run from before asked the model nothing of an Item page, so it dropped none.

describe("the queue database, version 15 to 16", () => {
  it("adds the column and leaves an existing run as it was", async () => {
    const vault = await mkdtemp(join(tmpdir(), "vitrine-queue-"));
    await mkdir(join(vault, ".vitrine"), { recursive: true });
    const first = await openQueue(vault);
    first.exec("ALTER TABLE scout_runs DROP COLUMN check_id");
    first.exec("ALTER TABLE proposals DROP COLUMN paper_url");
    first.exec("ALTER TABLE scout_runs DROP COLUMN item_pages_unread");
    first.exec("ALTER TABLE scout_runs DROP COLUMN item_values_dropped");
    first.exec(
      `INSERT INTO scout_runs (id, scout_id, started, finished, outcome, window_from, window_to, fetched, new, item_pages_read, unverified)
       VALUES (5, 'lab', '2026-10-27T10:00:00Z', '2026-10-27T10:01:00Z', 'ok', '2026-10-27T10:00:00Z', '2026-10-27T10:00:00Z', 2, 2, 2, 1)`
    );
    first.exec("PRAGMA user_version = 15");
    first.close();

    const migrated = await openQueue(vault);
    expect(
      migrated
        .prepare(
          "SELECT new, item_pages_read, unverified, item_values_dropped FROM scout_runs WHERE id = 5"
        )
        .get()
    ).toEqual({
      new: 2,
      item_pages_read: 2,
      unverified: 1,
      item_values_dropped: 0,
    });
    migrated.close();
  });
});
