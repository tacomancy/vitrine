import type { DatabaseSync } from "node:sqlite";
import { localIso } from "./time.js";

/**
 * `queue.sqlite`'s `pending_revisions` (#217; ADR 0020 decision 3, ADR
 * 0013; `docs/architecture.md` § Watcher and Ingest, External Position
 * edits): the Revisions an edit made outside the app owes its file, parked
 * until the file is quiet. The database itself — its version, and the
 * promise that nothing in it is ever deleted — is `queue.ts`'s.
 * Load-bearing per `CLAUDE.md`.
 */

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

/**
 * The parked Revisions for one vault, with the timers that fire their
 * splices, over a `queue.sqlite` handle `queue.ts` has already opened and
 * migrated. Closing is the opener's: two tables share the handle.
 */
export function openPendingRevisions(
  db: DatabaseSync,
  { windowMs, now, splice }: PendingRevisionsOptions
): PendingRevisions {
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
    },
  };
}
