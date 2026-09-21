import { watch, type FSWatcher } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { errorMessage } from "./errors.js";

/**
 * One recursive `fs.watch` over the vault root — libuv's FSEvents backend,
 * nothing native (ADR 0013 decision 2) — plus one over the PDF folder's real
 * path when `sources/pdf` is a symlink out of the vault (decision 15). Every
 * event is a hint: the kind is ignored, the path is stat-ted, and a path is
 * handed on only once it has *settled* — no events for the settle window and
 * two stats agreeing (decision 5). Everything that settles in the same tick
 * is one Batch. What the batch means for the index is `vault-index.ts`'s
 * `refresh`; nothing here reads a file's content.
 */

/** Quiet for this long, with two stats agreeing, before a file is read (§ Watcher and Ingest). */
export const SETTLE_MS = 2000;

/** The one folder whose symlink is followed, so an iCloud or Dropbox PDF folder is watched. */
const PDF_FOLDER = "sources/pdf";

export type WatcherOptions = {
  settleMs: number;
  /** A settled Batch of vault-relative paths; awaited before the next fires. */
  onSettled: (paths: string[]) => Promise<void>;
  /** The watch itself failed; #190 turns this into `watching`. */
  onError: (reason: string) => void;
};

export type Watcher = { close: () => void };

/** What two stats must agree on: `null` is a path that is not there. */
type StatKey = { size: number; mtime: number } | null;

const statKey = async (path: string): Promise<StatKey> => {
  try {
    const s = await stat(path);
    return { size: s.size, mtime: s.mtimeMs };
  } catch {
    return null;
  }
};

const sameStat = (a: StatKey, b: StatKey) =>
  a === null || b === null ? a === b : a.size === b.size && a.mtime === b.mtime;

/** `.vitrine/`, `.obsidian/`, `.git/`, the atomic-write temp file: dropped at the event level (decision 16). */
const isDotEntry = (path: string) =>
  path.split("/").some((segment) => segment.startsWith("."));

/**
 * Where a second watch is needed: the PDF folder's real path when it lies
 * outside the vault, so events from it can be rebased onto `sources/pdf/…`.
 */
async function pdfFolderOutside(root: string): Promise<string | null> {
  let real: string;
  try {
    real = await realpath(join(root, PDF_FOLDER));
  } catch {
    return null;
  }
  const rootReal = await realpath(root);
  const inside = relative(rootReal, real);
  return inside === "" || (!inside.startsWith("..") && !isAbsolute(inside))
    ? null
    : real;
}

export async function watchVault(
  root: string,
  { settleMs, onSettled, onError }: WatcherOptions
): Promise<Watcher> {
  const pending = new Map<string, { stat: StatKey; dueAt: number }>();
  let timer: NodeJS.Timeout | null = null;
  let closed = false;
  // Batches apply one after another, so a later batch never overtakes an
  // earlier one on its way to the index.
  let applying: Promise<void> = Promise.resolve();

  const schedule = () => {
    if (timer !== null || pending.size === 0 || closed) return;
    let earliest = Infinity;
    for (const { dueAt } of pending.values())
      earliest = Math.min(earliest, dueAt);
    timer = setTimeout(fire, Math.max(0, earliest - Date.now()));
  };

  const fire = async () => {
    timer = null;
    const now = Date.now();
    const due = [...pending].filter(([, record]) => record.dueAt <= now);
    const settled: string[] = [];
    await Promise.all(
      due.map(async ([path, record]) => {
        const fresh = await statKey(join(root, path));
        // An event landed while the stat was in flight: that path has a new
        // record and a new due time, and this pass has nothing to say about it.
        if (pending.get(path) !== record) return;
        if (sameStat(fresh, record.stat)) {
          pending.delete(path);
          settled.push(path);
        } else {
          pending.set(path, { stat: fresh, dueAt: Date.now() + settleMs });
        }
      })
    );
    if (settled.length > 0 && !closed) {
      applying = applying.then(() => onSettled(settled.sort()));
      await applying;
    }
    schedule();
  };

  const hint = async (path: string) => {
    if (closed || isDotEntry(path)) return;
    const fresh = await statKey(join(root, path));
    if (closed) return;
    pending.set(path, { stat: fresh, dueAt: Date.now() + settleMs });
    schedule();
  };

  /** The listener for one `fs.watch`; `rebase` turns its filenames into vault-relative paths. */
  const listener =
    (watched: string, rebase: (relativeToWatched: string) => string) =>
    (_: string, filename: string | Buffer | null) => {
      if (filename === null) return;
      const name = filename.toString();
      const relativeToWatched = isAbsolute(name)
        ? relative(watched, name)
        : name;
      void hint(rebase(relativeToWatched.split(sep).join("/")));
    };

  const watchers: FSWatcher[] = [];
  const start = (
    folder: string,
    rebase: (relativeToWatched: string) => string
  ) => {
    const watcher = watch(
      folder,
      { recursive: true },
      listener(folder, rebase)
    );
    watcher.on("error", (error) => {
      close();
      onError(errorMessage(error));
    });
    watchers.push(watcher);
  };
  const close = () => {
    closed = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending.clear();
    for (const watcher of watchers.splice(0)) watcher.close();
  };

  // The root is watched before anything is awaited, so nothing written while
  // the PDF folder's real path is resolved can slip past.
  start(root, (path) => path);
  const pdfReal = await pdfFolderOutside(root);
  if (pdfReal !== null && !closed) {
    start(pdfReal, (path) => `${PDF_FOLDER}/${path}`);
  }
  return { close };
}
