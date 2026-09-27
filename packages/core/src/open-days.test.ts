import { rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { QUEUE_SCHEMA_VERSION } from "./queue.js";
import { closeCores, core, vaultWith } from "./test-core.js";

// Open days (#243; `docs/architecture.md` § Loose Ends): the local dates the
// vault was actually open in the app. A quiet period is counted in these and
// never in calendar days, so time away from the vault can change how much
// Home has to say but never creates a Loose Ends row that was not there when
// the user left. Recorded on `vault.open` and on window focus — never on an
// ordinary request, or an app left open unattended would count every day.

afterEach(closeCores);

/** A clock a test moves: the core reads it per call, as the real one is read. */
function clock(start: string) {
  let at = new Date(start);
  return {
    now: () => at,
    set: (iso: string) => {
      at = new Date(iso);
    },
  };
}

const days = (vault: string): string[] => {
  const db = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"));
  try {
    return (
      db.prepare("SELECT day FROM open_days ORDER BY day").all() as Array<{
        day: string;
      }>
    ).map((row) => row.day);
  } finally {
    db.close();
  }
};

describe("the record of open days", () => {
  it("records today's local date when the vault opens, once however many times it is asked", async () => {
    const vault = await vaultWith({ "a.md": "# a\n" });
    const time = clock("2026-09-21T10:00:00+01:00");
    const c = await core({ now: time.now });

    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    // A second open of the same vault on the same date adds nothing.
    await c.mutate("vault.open", { path: vault });
    await c.indexed();

    expect(days(vault)).toEqual(["2026-09-21"]);
  });

  it("records the date the window was focused on, and only when it is a new one", async () => {
    const vault = await vaultWith({ "a.md": "# a\n" });
    const time = clock("2026-09-21T10:00:00+01:00");
    const c = await core({ now: time.now });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();

    // Focused twice the same day, then again the next: two dates, not three.
    time.set("2026-09-21T18:00:00+01:00");
    await c.focused();
    time.set("2026-09-23T09:00:00+01:00");
    await c.focused();
    await c.focused();

    expect(days(vault)).toEqual(["2026-09-21", "2026-09-23"]);
  });

  it("records nothing for an ordinary request or a vault change", async () => {
    const vault = await vaultWith({ "a.md": "# a\n" });
    const time = clock("2026-09-21T10:00:00+01:00");
    const c = await core({ now: time.now });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();

    // A day passes with the app open and untended: queries land, the
    // watcher reports a change, nothing counts it as a day at the vault.
    time.set("2026-09-22T09:00:00+01:00");
    await c.query("questions.list");
    await c.query("looseEnds.rows");
    await c.query("vault.status");

    expect(days(vault)).toEqual(["2026-09-21"]);
  });

  it("keeps the days when index.sqlite is deleted and rebuilt", async () => {
    const vault = await vaultWith({ "a.md": "# a\n" });
    const time = clock("2026-09-21T10:00:00+01:00");
    const first = await core({ now: time.now });
    await first.mutate("vault.open", { path: vault });
    await first.indexed();
    await closeCores();

    await rm(join(vault, ".vitrine/index.sqlite"), { force: true });

    time.set("2026-09-25T10:00:00+01:00");
    const second = await core({ now: time.now });
    await second.mutate("vault.open", { path: vault });
    await second.indexed();

    expect(days(vault)).toEqual(["2026-09-21", "2026-09-25"]);
  });
});

describe("the queue's schema", () => {
  it("migrates a version-1 queue to 2, keeping what it already holds", async () => {
    const vault = await vaultWith({ "a.md": "# a\n" });
    // A queue as the build before this one left it: version 1, one parked
    // Revision, and no `open_days` table.
    const file = join(vault, ".vitrine/queue.sqlite");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(vault, ".vitrine"), { recursive: true });
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE pending_revisions (
        id INTEGER PRIMARY KEY, path TEXT NOT NULL, field TEXT NOT NULL,
        from_text TEXT NOT NULL, at TEXT NOT NULL
      );
      CREATE INDEX pending_revisions_path ON pending_revisions (path);
    `);
    old.exec(
      "INSERT INTO pending_revisions (path, field, from_text, at) VALUES ('q/a (RQ).md', 'working answer', 'what it said before', '2026-09-20T10:00:00+01:00')"
    );
    old.exec("PRAGMA user_version = 1");
    old.close();

    const c = await core({ now: () => new Date("2026-09-21T10:00:00+01:00") });
    const reply = await c.mutate("vault.open", { path: vault });
    expect(reply.error).toBeUndefined();
    await c.indexed();
    await closeCores();

    const db = new DatabaseSync(file);
    try {
      expect(
        (db.prepare("PRAGMA user_version").get() as { user_version: number })
          .user_version
      ).toBe(QUEUE_SCHEMA_VERSION);
      expect(QUEUE_SCHEMA_VERSION).toBe(2);
      // The parked Revision is still there, and the new table beside it.
      expect(
        db.prepare("SELECT from_text FROM pending_revisions").all()
      ).toEqual([{ from_text: "what it said before" }]);
      expect(db.prepare("SELECT day FROM open_days").all()).toEqual([
        { day: "2026-09-21" },
      ]);
    } finally {
      db.close();
    }
  });

  it("refuses a queue from a build it does not know rather than losing it", async () => {
    const vault = await vaultWith({ "a.md": "# a\n" });
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(vault, ".vitrine"), { recursive: true });
    const file = join(vault, ".vitrine/queue.sqlite");
    const ahead = new DatabaseSync(file);
    ahead.exec(`PRAGMA user_version = ${QUEUE_SCHEMA_VERSION + 1}`);
    ahead.close();

    const c = await core();
    const reply = await c.mutate("vault.open", { path: vault });

    expect(reply.error?.message).toMatch(/queue\.sqlite/);
    expect(reply.error?.data.kind).toBe("writeFailed");
  });
});
