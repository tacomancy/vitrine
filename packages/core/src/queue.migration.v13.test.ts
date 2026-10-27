import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openQueue } from "./queue.js";

// Version 13 to 14 (#885, ADR 0055) adds what a Watched Scout's Item pages
// leave behind: `proposals.item_page_tries`, null when no read is owed, and
// `scout_runs.item_pages_read`. An existing row keeps what it had; which of
// the pending cards from before then owe a read is #887's to decide.

describe("the queue database, version 13 to 14", () => {
  it("adds the columns and leaves an existing Proposal and run as they were", async () => {
    const vault = await mkdtemp(join(tmpdir(), "vitrine-queue-"));
    await mkdir(join(vault, ".vitrine"), { recursive: true });
    const first = await openQueue(vault);
    first.exec("ALTER TABLE scout_runs DROP COLUMN item_pages_unread");
    first.exec("ALTER TABLE proposals DROP COLUMN item_page_tries");
    first.exec("ALTER TABLE scout_runs DROP COLUMN item_pages_read");
    first.exec(
      `INSERT INTO scout_runs (id, scout_id, started, finished, outcome, window_from, window_to, fetched, new)
       VALUES (5, 'lab', '2026-10-20T10:00:00Z', '2026-10-20T10:01:00Z', 'ok', '2026-10-20T10:00:00Z', '2026-10-20T10:00:00Z', 2, 2)`
    );
    first.exec(
      `INSERT INTO proposals (id, source_key, title, authors, published, abstract, url, lane, state, first_seen)
       VALUES (3, 'url:https://lab.example/a', 'Probing', '[]', '', '', 'https://lab.example/a', 'review', 'pending', '2026-10-20T10:01:00Z')`
    );
    first.exec("PRAGMA user_version = 13");
    first.close();

    const migrated = await openQueue(vault);
    expect(
      migrated
        .prepare(
          "SELECT title, state, item_page_tries FROM proposals WHERE id = 3"
        )
        .get()
    ).toEqual({ title: "Probing", state: "pending", item_page_tries: null });
    expect(
      migrated
        .prepare("SELECT new, item_pages_read FROM scout_runs WHERE id = 5")
        .get()
    ).toEqual({ new: 2, item_pages_read: 0 });
    migrated.close();
  });
});
