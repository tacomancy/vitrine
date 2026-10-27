import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openQueue } from "./queue.js";

// Version 15 to 16 (#888, ADR 0055 decision 6) adds
// `scout_runs.item_pages_unread`, the Item pages a run tried and could not
// read. An earlier run counted none, and keeps everything else it had.

describe("the queue database, version 15 to 16", () => {
  it("adds the column at 0 and leaves an existing run as it was", async () => {
    const vault = await mkdtemp(join(tmpdir(), "vitrine-queue-"));
    await mkdir(join(vault, ".vitrine"), { recursive: true });
    const first = await openQueue(vault);
    first.exec("ALTER TABLE scout_runs DROP COLUMN item_pages_unread");
    first.exec(
      `INSERT INTO scout_runs (id, scout_id, started, finished, outcome, window_from, window_to, fetched, new, item_pages_read)
       VALUES (5, 'lab', '2026-10-20T10:00:00Z', '2026-10-20T10:01:00Z', 'ok', '2026-10-20T10:00:00Z', '2026-10-20T10:00:00Z', 4, 4, 3)`
    );
    first.exec("PRAGMA user_version = 15");
    first.close();

    const migrated = await openQueue(vault);
    expect(
      migrated
        .prepare(
          "SELECT new, item_pages_read, item_pages_unread FROM scout_runs WHERE id = 5"
        )
        .get()
    ).toEqual({ new: 4, item_pages_read: 3, item_pages_unread: 0 });
    expect(
      (
        migrated.prepare("PRAGMA user_version").get() as {
          user_version: number;
        }
      ).user_version
    ).toBe(16);
    migrated.close();
  });
});
