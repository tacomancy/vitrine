import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openQueue } from "./queue.js";

// Version 17 to 18 (#890, ADR 0055 decision 10) adds `proposals.paper_url`,
// the link an Item page gives as this work's own paper. No page had been
// asked for one before, so every earlier row has none.

describe("the queue database, version 17 to 18", () => {
  it("adds the column and leaves an existing Proposal as it was", async () => {
    const vault = await mkdtemp(join(tmpdir(), "vitrine-queue-"));
    await mkdir(join(vault, ".vitrine"), { recursive: true });
    const first = await openQueue(vault);
    first.exec("ALTER TABLE scout_runs DROP COLUMN check_id");
    first.exec("ALTER TABLE proposals DROP COLUMN paper_url");
    first.exec(
      `INSERT INTO proposals (id, source_key, title, authors, published, abstract, url, lane, state, first_seen, item_page_tries)
       VALUES (3, 'url:https://www.lab.example/research/post-3', 'Post 3', '["Ada Rowe"]', '2025-09-01', 'A summary.', 'https://www.lab.example/research/post-3', 'review', 'pending', '2026-10-27T10:01:00Z', 0)`
    );
    first.exec("PRAGMA user_version = 17");
    first.close();

    const migrated = await openQueue(vault);
    expect(
      migrated
        .prepare(
          "SELECT title, authors, abstract, state, item_page_tries, paper_url FROM proposals WHERE id = 3"
        )
        .get()
    ).toEqual({
      title: "Post 3",
      authors: '["Ada Rowe"]',
      abstract: "A summary.",
      state: "pending",
      item_page_tries: 0,
      paper_url: null,
    });
    migrated.close();
  });
});
