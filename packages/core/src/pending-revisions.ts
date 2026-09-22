import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { errorMessage } from "./errors.js";
import { localIso } from "./time.js";

/**
 * `.vitrine/queue.sqlite`'s first table (#217; ADR 0020 decision 3, ADR
 * 0013; `docs/architecture.md` § Watcher and Ingest, External Position
 * edits): the Revisions an edit made outside the app owes its file, parked
 * until the file is quiet.
 *
 * The queue is the index's opposite. `index.sqlite` is a cache of what the
 * vault already says and is deleted whenever its schema moves; a pending
 * Revision exists nowhere else — the previous text it holds is gone from
 * the file the moment Obsidian saved over it — so this database is never
 * deleted, and a version that is not ours refuses the vault rather than
 * losing what it holds. Load-bearing per `CLAUDE.md`.
 */

/**
 * `PRAGMA user_version` for `queue.sqlite`, versioned separately from the
 * index's. Bump on any change to the table below and add the migration
 * that carries the old rows forward: there is no rebuild path here.
 * 1: pending Revisions (#217).
 */
export const QUEUE_SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE pending_revisions (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  field TEXT NOT NULL,
  from_text TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX pending_revisions_path ON pending_revisions (path);
`;

/** One Revision a file owes: the Position's text before the edit, and when the edit was seen. */
export type PendingRevision = {
  id: number;
  path: string;
  field: string;
  from: string;
  /** Local ISO, as `formatRevision` will stamp the entry. */
  at: string;
};

/** What the index's `positions` diff saw: which field moved, and what it moved from. */
export type PositionChange = { path: string; field: string; from: string };

export type PendingRevisions = {
  /** Park one external change, or extend the one already parked for that field. */
  record: (change: PositionChange) => void;
  /** What `path` owes, oldest first; the caller clears them once its write lands. */
  pending: (path: string) => PendingRevision[];
  clear: (ids: number[]) => void;
  /** Splice everything still parked, whatever its timer — vault close awaits this. */
  flush: () => Promise<void>;
  close: () => void;
};

export type PendingRevisionsOptions = {
  /**
   * How long a file must be quiet before its entries are spliced, and the
   * span within which a second external edit extends one entry rather than
   * opening another — ADR 0006 decision 5's thirty minutes, the same
   * injected window the page's saves coalesce by (#213).
   */
  windowMs: number;
  now: () => Date;
  /** One file's parked entries into its `## Position history`; an own write like any other. */
  splice: (path: string) => Promise<void>;
};

export class QueueOpenError extends Error {}

/**
 * Open `queue.sqlite` at its schema, or refuse. Unlike the index there is
 * no delete-and-rebuild: a version this build does not know belongs to a
 * newer one, and the rows under it are the only copy of what they say.
 */
function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as {
    user_version: number;
  };
  if (version === QUEUE_SCHEMA_VERSION) return db;
  if (version !== 0) {
    db.close();
    throw new Error(
      `it carries schema version ${version}, and this build knows ${QUEUE_SCHEMA_VERSION}. Nothing was deleted; a newer Vitrine wrote it.`
    );
  }
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${QUEUE_SCHEMA_VERSION}`);
  return db;
}

/**
 * The queue for one vault, with the timers that fire its splices. Throws
 * `QueueOpenError` when the database cannot be opened or is not ours — the
 * vault service turns that into the `writeFailed` refusal, as it does for
 * an unwritable `.vitrine/`.
 */
export async function openPendingRevisions(
  vaultPath: string,
  { windowMs, now, splice }: PendingRevisionsOptions
): Promise<PendingRevisions> {
  const folder = join(vaultPath, ".vitrine");
  const file = join(folder, "queue.sqlite");
  await mkdir(folder, { recursive: true }).catch((cause: unknown) => {
    throw new QueueOpenError(
      `Couldn't create ${folder}: ${errorMessage(cause)}`
    );
  });
  let db: DatabaseSync;
  try {
    db = openDatabase(file);
  } catch (cause) {
    throw new QueueOpenError(`Couldn't open ${file}: ${errorMessage(cause)}`);
  }

  const insert = db.prepare(
    "INSERT INTO pending_revisions (path, field, from_text, at) VALUES (?, ?, ?, ?)"
  );
  const restamp = db.prepare(
    "UPDATE pending_revisions SET at = ? WHERE id = ?"
  );
  const latest = db.prepare(
    "SELECT id, at FROM pending_revisions WHERE path = ? AND field = ? ORDER BY id DESC LIMIT 1"
  );
  const forPath = db.prepare(
    "SELECT id, path, field, from_text, at FROM pending_revisions WHERE path = ? ORDER BY id"
  );
  const allPaths = db.prepare(
    "SELECT DISTINCT path FROM pending_revisions ORDER BY path"
  );
  const remove = db.prepare("DELETE FROM pending_revisions WHERE id = ?");

  let closed = false;
  // One timer per file, restarted by every change to it: *quiet* is the
  // absence of further edits, so a session of typing in Obsidian is spliced
  // once it ends rather than in the middle of it.
  const quiet = new Map<string, NodeJS.Timeout>();
  const forget = (path: string) => {
    clearTimeout(quiet.get(path));
    quiet.delete(path);
  };
  const waitForQuiet = (path: string) => {
    forget(path);
    // Unreferenced: a vault with something parked must not be what keeps
    // the process — or a test run — alive.
    quiet.set(
      path,
      setTimeout(() => {
        quiet.delete(path);
        if (!closed) void splice(path);
      }, windowMs).unref()
    );
  };

  return {
    record: ({ path, field, from }) => {
      const stamp = now();
      const head = latest.get(path, field) as
        { id: number; at: string } | undefined;
      const since =
        head === undefined ? NaN : stamp.getTime() - Date.parse(head.at);
      // Inside the window the parked entry keeps its `from` — the text from
      // before the *first* edit — and takes the later timestamp, the same
      // rule a page save coalesces by (ADR 0020 decision 2). Outside it, or
      // over an entry this build cannot date, a second entry is opened.
      if (head !== undefined && since >= 0 && since < windowMs) {
        restamp.run(localIso(stamp), head.id);
      } else {
        insert.run(path, field, from, localIso(stamp));
      }
      waitForQuiet(path);
    },
    pending: (path) =>
      (
        forPath.all(path) as Array<{
          id: number;
          path: string;
          field: string;
          from_text: string;
          at: string;
        }>
      ).map(({ from_text, ...row }) => ({ ...row, from: from_text })),
    clear: (ids) => {
      for (const id of ids) remove.run(id);
    },
    flush: async () => {
      for (const { path } of allPaths.all() as Array<{ path: string }>) {
        forget(path);
        await splice(path);
      }
    },
    close: () => {
      closed = true;
      for (const path of [...quiet.keys()]) forget(path);
      db.close();
    },
  };
}
