import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { errorMessageWithoutPath } from "./errors.js";

/**
 * `.vitrine/queue.sqlite` (ADR 0006 decision 10; `docs/architecture.md`
 * § Index): the app state that is **not** re-derivable from the vault, and
 * therefore the one database that is never deleted. This module owns the
 * file, its version, and its migrations; each table's behaviour is its own
 * module's (`pending-revisions.ts`, `open-days.ts`).
 *
 * The queue is the index's opposite. `index.sqlite` is a cache of what the
 * vault already says and is deleted whenever its schema moves; nothing in
 * here exists anywhere else — the previous text a pending Revision holds is
 * gone from the file the moment Obsidian saved over it, and a date the
 * vault was open is a fact about the past no sweep could recover. So there
 * is no rebuild path: a version this build does not know refuses the vault
 * rather than losing what it holds, and a version behind it is migrated.
 * Load-bearing per `CLAUDE.md`.
 */

/**
 * `PRAGMA user_version`, versioned separately from the index's. Bump on any
 * change to the tables below and add the migration that carries the old
 * rows forward.
 *
 * 1: pending Revisions (#217).
 * 2: open days (#243).
 */
export const QUEUE_SCHEMA_VERSION = 2;

const PENDING_REVISIONS = `
CREATE TABLE pending_revisions (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  field TEXT NOT NULL,
  from_text TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX pending_revisions_path ON pending_revisions (path);
`;

// One row per local date the vault was open; the date itself is the key, so
// recording a day twice is a no-op rather than something the caller must
// remember to check.
const OPEN_DAYS = `
CREATE TABLE open_days (day TEXT PRIMARY KEY);
`;

/**
 * `MIGRATIONS[v]` is what carries a database at version `v` to `v + 1`. A
 * fresh database is version 0 and runs all of them in order, which is what
 * keeps the empty case and the upgrade case from drifting apart — there is
 * no separate "current schema" to forget to update.
 */
const MIGRATIONS: readonly string[] = [PENDING_REVISIONS, OPEN_DAYS];

export class QueueOpenError extends Error {}

/**
 * Open `queue.sqlite` at this build's schema, migrating a database written
 * by an older build and refusing one written by a newer.
 */
export async function openQueue(vaultPath: string): Promise<DatabaseSync> {
  const folder = join(vaultPath, ".vitrine");
  const file = join(folder, "queue.sqlite");
  await mkdir(folder, { recursive: true }).catch((cause: unknown) => {
    throw new QueueOpenError(
      `Couldn't create ${folder}: ${errorMessageWithoutPath(cause)}`
    );
  });
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file);
  } catch (cause) {
    throw new QueueOpenError(
      `Couldn't open ${file}: ${errorMessageWithoutPath(cause)}`
    );
  }
  try {
    db.exec("PRAGMA journal_mode = WAL");
    const { user_version: version } = db
      .prepare("PRAGMA user_version")
      .get() as { user_version: number };
    if (version > QUEUE_SCHEMA_VERSION) {
      throw new Error(
        `it carries schema version ${version}, and this build knows ${QUEUE_SCHEMA_VERSION}. Nothing was deleted; a newer Vitrine wrote it.`
      );
    }
    // Each step in its own transaction: a migration that fails leaves the
    // database at the last version it reached rather than half-way into one.
    for (let v = version; v < QUEUE_SCHEMA_VERSION; v++) {
      db.exec("BEGIN");
      try {
        db.exec(MIGRATIONS[v]!);
        db.exec(`PRAGMA user_version = ${v + 1}`);
        db.exec("COMMIT");
      } catch (cause) {
        // A rollback with no transaction live throws in its own right; the
        // migration's failure is the one worth reporting.
        try {
          db.exec("ROLLBACK");
        } catch {
          // Nothing to undo.
        }
        throw cause;
      }
    }
  } catch (cause) {
    db.close();
    throw new QueueOpenError(
      `Couldn't open ${file}: ${errorMessageWithoutPath(cause)}`
    );
  }
  return db;
}
