import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openQueue } from "./queue.js";

// Version 14 to 15 (#887, ADR 0055 decision 5) adds no column: the pending
// cards a Watched Scout proposed before Item pages existed become
// Listing-only, with no tries spent, so they fill in on the next run. Every
// other row keeps null.

const RUN = (id: number, scout: string, query: string | null) =>
  `(${id}, '${scout}', '2026-10-20T10:00:00Z', '2026-10-20T10:01:00Z', 'ok', '2026-10-20T10:00:00Z', '2026-10-20T10:00:00Z', 1, 1, ${query === null ? "NULL" : `'${query}'`})`;

const CARD = (id: number, url: string, state = "pending") =>
  `(${id}, 'url:${url}', 'Card ${id}', '[]', '', '', '${url}', 'review', '${state}', '2026-10-20T10:01:00Z')`;

const SEEN = (card: number, run: number, scout: string, url: string) =>
  `(${card}, ${run}, '${scout}', '2026-10-20T10:01:00Z', '${url}')`;

describe("the queue database, version 14 to 15", () => {
  it("makes a Watched Scout's pending cards on its page's site Listing-only, and leaves every other row null", async () => {
    const vault = await mkdtemp(join(tmpdir(), "vitrine-queue-"));
    await mkdir(join(vault, ".vitrine"), { recursive: true });
    const first = await openQueue(vault);
    first.exec("ALTER TABLE scout_runs DROP COLUMN check_id");
    first.exec("ALTER TABLE proposals DROP COLUMN paper_url");
    first.exec("ALTER TABLE scout_runs DROP COLUMN item_pages_unread");
    first.exec("ALTER TABLE scout_runs DROP COLUMN item_values_dropped");
    first.exec(
      `INSERT INTO scout_runs (id, scout_id, started, finished, outcome, window_from, window_to, fetched, new, query) VALUES
       ${[
         RUN(1, "lab", "https://www.anthropic.com/research/team/alignment"),
         RUN(2, "sleep", "cat:q-bio.NC"),
         RUN(3, "old", null),
       ].join(",")}`
    );
    const on = "https://www.anthropic.com/research/a";
    const bare = "https://anthropic.com/research/b";
    const off = "https://alignment.anthropic.com/2025/c/";
    const arxiv = "http://arxiv.org/abs/2610.00001";
    first.exec(
      `INSERT INTO proposals (id, source_key, title, authors, published, abstract, url, lane, state, first_seen) VALUES
       ${[
         CARD(1, on),
         CARD(2, bare),
         CARD(3, off),
         CARD(4, "https://www.anthropic.com/research/d", "rejected"),
         CARD(5, "https://www.anthropic.com/research/e", "deferred"),
         CARD(6, arxiv),
         CARD(7, "https://www.anthropic.com/research/g"),
       ].join(",")}`
    );
    first.exec(
      `INSERT INTO appearances (proposal_id, run_id, scout_id, seen_at, url) VALUES
       ${[
         SEEN(1, 1, "lab", on),
         SEEN(2, 1, "lab", bare),
         SEEN(3, 1, "lab", off),
         SEEN(4, 1, "lab", "https://www.anthropic.com/research/d"),
         SEEN(5, 1, "lab", "https://www.anthropic.com/research/e"),
         SEEN(6, 2, "sleep", arxiv),
         // A run from before runs recorded their page names none.
         SEEN(7, 3, "old", "https://www.anthropic.com/research/g"),
       ].join(",")}`
    );
    first.exec("PRAGMA user_version = 14");
    first.close();

    const migrated = await openQueue(vault);
    expect(
      migrated
        .prepare("SELECT id, item_page_tries FROM proposals ORDER BY id")
        .all()
    ).toEqual([
      { id: 1, item_page_tries: 0 },
      // A leading `www.` is the same site.
      { id: 2, item_page_tries: 0 },
      { id: 3, item_page_tries: null },
      { id: 4, item_page_tries: null },
      { id: 5, item_page_tries: null },
      { id: 6, item_page_tries: null },
      { id: 7, item_page_tries: null },
    ]);
    migrated.close();
  });
});
