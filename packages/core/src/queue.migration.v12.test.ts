import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openQueue } from "./queue.js";

// Version 12 to 13 (#806) adds the first publisher's name to `proposals`, so a
// card can offer a publisher rule by name. An existing row keeps what it had
// and reads null, which the card shows as the publisher's ID alone.

describe("the queue database, version 12 to 13", () => {
  it("adds the column and leaves an existing Proposal as it was", async () => {
    const vault = await mkdtemp(join(tmpdir(), "vitrine-queue-"));
    await mkdir(join(vault, ".vitrine"), { recursive: true });
    const first = await openQueue(vault);
    first.exec("ALTER TABLE proposals DROP COLUMN publisher_name");
    first.exec(
      `INSERT INTO proposals (id, source_key, title, authors, published, venue, venue_source_id, publisher_lineage, abstract, url, lane, state, first_seen)
       VALUES (3, 'doi:10.1/x', 'Probing', '["Ada"]', '2026-09-01', 'J', 'S1', '["P1"]', 'An abstract.', 'https://j.example/x', 'review', 'pending', '2026-09-25T10:00:00Z')`
    );
    first.exec("PRAGMA user_version = 12");
    first.close();

    const migrated = await openQueue(vault);
    expect(
      migrated
        .prepare(
          "SELECT title, venue_source_id, publisher_lineage, publisher_name FROM proposals WHERE id = 3"
        )
        .get()
    ).toEqual({
      title: "Probing",
      venue_source_id: "S1",
      publisher_lineage: '["P1"]',
      publisher_name: null,
    });
    migrated.close();
  });
});
