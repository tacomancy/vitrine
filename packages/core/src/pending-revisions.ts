import type { DatabaseSync } from "node:sqlite";
import { errorMessage } from "./errors.js";
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
  /**
   * Splice everything still parked, whatever its timer — vault close awaits
   * this. Never rejects: a file that could not take its entries says so in
   * the log and the rest are still tried.
   */
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
 * splices — including one per file the last session left a row for, since
 * a Revision is owed from the moment the vault is open. Over a
 * `queue.sqlite` handle `queue.ts` has already opened and migrated;
 * closing is the opener's, as two tables share the handle.
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

  /**
   * One file's splice, and the one thing there is to do when it cannot
   * land — a vault that has gone away, a file that has, a `.vitrine/` that
   * cannot be written. Nothing is lost: what could not be spliced stays in
   * the table and is owed again at the next open. Neither caller has a
   * surface to say that on — a timer has no caller at all, and by the time
   * `flush` runs the vault is closing — so it reaches the core's log, and
   * the next file is still tried.
   */
  const spliceOrSay = (path: string) =>
    splice(path).catch((cause: unknown) => {
      console.error(
        `vitrine-core: a pending Revision could not be spliced: ${errorMessage(cause)}`
      );
    });

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
        if (!closed) void spliceOrSay(path);
      }, windowMs).unref()
    );
  };

  // A row the last session left behind is owed a splice from the moment the
  // vault is open, not from the next edit to its file (#276): arming only
  // from `record` left it with no timer at all, and the app's next write to
  // that page — a page the user may never open again — was then the only
  // clause of the three that could still fire.
  for (const { path } of allPaths.all() as Array<{ path: string }>) {
    waitForQuiet(path);
  }

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
        await spliceOrSay(path);
      }
    },
    close: () => {
      closed = true;
      for (const path of [...quiet.keys()]) forget(path);
    },
  };
}
