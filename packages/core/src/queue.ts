import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { errorMessageWithoutPath } from "./errors.js";

/**
 * `.vitrine/queue.sqlite` (ADR 0006 decision 10; `docs/architecture.md`
 * § Index): the app state that is **not** re-derivable from the vault, and
 * therefore the one database that is never deleted. This module owns the
 * file, its version, and its migrations; each table's behaviour is its own
 * module's (`pending-revisions.ts`, `open-days.ts`, `last-arrival.ts`).
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
 * 3: the PDF folder's last arrival (#379).
 * 4: Scout runs, Proposals, Appearances and the triage log (#448).
 * 5: the Query each run asked, so "edited since it last ran cleanly" and
 *    "saving an edited Query overrides a wait" are read off rows (#449).
 */
export const QUEUE_SCHEMA_VERSION = 5;

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

// At most one row, pinned by its key, so replacing the arrival can never
// leave two to choose between.
const LAST_ARRIVAL = `
CREATE TABLE last_arrival (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  at TEXT NOT NULL,
  name TEXT NOT NULL
);
`;

// The Scout tables (ADR 0016, ADR 0039; `docs/architecture.md` § Scouts).
// Nothing here is inferred later from the absence of a row: what the
// researcher did, or what the machine could not do, is a row — which is why
// `held` and `interrupted` are values and not flags, and why a triage act is
// never edited or deleted. `truncated` holds how many more matched than the
// ceiling let through, so 0 is a run that was not cut.
const SCOUTS = `
CREATE TABLE scout_runs (
  id INTEGER PRIMARY KEY,
  scout_id TEXT NOT NULL,
  started TEXT NOT NULL,
  finished TEXT,
  outcome TEXT CHECK (outcome IN ('ok', 'failed')),
  error_kind TEXT CHECK (error_kind IN ('network', 'http', 'rate_limited', 'parse', 'interrupted')),
  error_message TEXT,
  window_from TEXT NOT NULL,
  window_to TEXT NOT NULL,
  retroactive INTEGER NOT NULL DEFAULT 0,
  fetched INTEGER NOT NULL DEFAULT 0,
  new INTEGER NOT NULL DEFAULT 0,
  held INTEGER NOT NULL DEFAULT 0,
  truncated INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX scout_runs_scout ON scout_runs (scout_id);
CREATE TABLE proposals (
  id INTEGER PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  doi TEXT,
  title TEXT NOT NULL,
  authors TEXT NOT NULL,
  published TEXT NOT NULL,
  venue TEXT,
  abstract TEXT NOT NULL,
  url TEXT NOT NULL,
  lane TEXT NOT NULL CHECK (lane IN ('review', 'skim')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'deferred', 'accepted', 'rejected', 'held')),
  first_seen TEXT NOT NULL,
  stub_path TEXT
);
CREATE TABLE appearances (
  proposal_id INTEGER NOT NULL REFERENCES proposals (id),
  run_id INTEGER NOT NULL REFERENCES scout_runs (id),
  scout_id TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  url TEXT NOT NULL,
  UNIQUE (proposal_id, scout_id, url)
);
CREATE TABLE triage (
  proposal_id INTEGER NOT NULL REFERENCES proposals (id),
  action TEXT NOT NULL CHECK (action IN ('accept', 'reject', 'defer', 'promote', 'undo')),
  at TEXT NOT NULL,
  batch INTEGER REFERENCES scout_runs (id)
);
`;

// A run's Query is a fact about the run, like its window: the Scout's file
// holds only what the Query is now, and nothing in it says whether it was
// edited since the last clean run. Null on a run from before this column.
const SCOUT_RUN_QUERY = `
ALTER TABLE scout_runs ADD COLUMN query TEXT;
`;

/**
 * `MIGRATIONS[v]` is what carries a database at version `v` to `v + 1`. A
 * fresh database is version 0 and runs all of them in order, which is what
 * keeps the empty case and the upgrade case from drifting apart — there is
 * no separate "current schema" to forget to update.
 */
const MIGRATIONS: readonly string[] = [
  PENDING_REVISIONS,
  OPEN_DAYS,
  LAST_ARRIVAL,
  SCOUTS,
  SCOUT_RUN_QUERY,
];

/**
 * A run with a start and no finish is a quit, a crash or a closed lid. Left
 * alone it would be passed over by health, which reads the newest *finished*
 * run, and a Scout whose last real run was long ago would read as quiet or as
 * never run. It is closed as failed rather than deleted: a request that
 * crashes the core every time would then leave no trace anywhere (ADR 0039
 * decision 2). Runs on open, before the first check, and leaves `window_to` unread.
 */
export function closeInterrupted(
  queue: DatabaseSync,
  now: Date
): Array<{ scoutId: string; runId: number }> {
  const closed = queue
    .prepare(
      "UPDATE scout_runs SET finished = ?, outcome = 'failed', error_kind = 'interrupted', error_message = 'Vitrine closed before this check finished.' WHERE finished IS NULL RETURNING id, scout_id"
    )
    .all(now.toISOString()) as Array<{ id: number; scout_id: string }>;
  return closed.map((r) => ({ scoutId: r.scout_id, runId: r.id }));
}

export class QueueOpenError extends Error {}

/**
 * Named vault-relative, because these two go into messages as well as onto
 * the vault path: a message that interpolated the joined path would put back
 * exactly what the errno's strip took out (#288).
 */
const META_FOLDER = ".vitrine";
const FILE = "queue.sqlite";

/**
 * Open `queue.sqlite` at this build's schema, migrating a database written
 * by an older build and refusing one written by a newer.
 */
export async function openQueue(vaultPath: string): Promise<DatabaseSync> {
  const folder = join(vaultPath, META_FOLDER);
  const file = join(folder, FILE);
  await mkdir(folder, { recursive: true }).catch((cause: unknown) => {
    throw new QueueOpenError(
      `Couldn't create ${META_FOLDER}/: ${errorMessageWithoutPath(cause)}`
    );
  });
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file);
  } catch (cause) {
    throw new QueueOpenError(
      `Couldn't open ${META_FOLDER}/${FILE}: ${errorMessageWithoutPath(cause)}`
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
      `Couldn't open ${META_FOLDER}/${FILE}: ${errorMessageWithoutPath(cause)}`
    );
  }
  return db;
}
