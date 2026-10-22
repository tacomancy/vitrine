import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openQueue } from "./queue.js";

// Version 11 to 12 (#806) adds the venue's OpenAlex source ID and the
// publisher lineage to `proposals`. An existing row keeps everything it had
// and reads null in both, which is what makes a name-only rule behave as before.

describe("the queue database, version 11 to 12", () => {
  it("adds the columns and leaves an existing Proposal as it was", async () => {
    const vault = await mkdtemp(join(tmpdir(), "vitrine-queue-"));
    await mkdir(join(vault, ".vitrine"), { recursive: true });
    const first = await openQueue(vault);
    first.exec("ALTER TABLE proposals DROP COLUMN publisher_lineage");
    first.exec("ALTER TABLE proposals DROP COLUMN venue_source_id");
    first.exec(
      `INSERT INTO proposals (id, source_key, title, authors, published, venue, venue_type, abstract, url, lane, state, first_seen)
       VALUES (3, 'doi:10.1/x', 'Probing', '["Ada"]', '2026-09-01', 'J', 'journal', 'An abstract.', 'https://j.example/x', 'review', 'pending', '2026-09-25T10:00:00Z')`
    );
    first.exec("PRAGMA user_version = 11");
    first.close();

    const migrated = await openQueue(vault);
    expect(
      migrated
        .prepare(
          "SELECT title, venue, venue_type, venue_source_id, publisher_lineage FROM proposals WHERE id = 3"
        )
        .get()
    ).toEqual({
      title: "Probing",
      venue: "J",
      venue_type: "journal",
      venue_source_id: null,
      publisher_lineage: null,
    });
    migrated.close();
  });
});
