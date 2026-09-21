import { watch, type FSWatcher } from "node:fs";
import { realpath, stat, unlink, writeFile } from "node:fs/promises";
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
 *
 * `watchVault` resolves only once the watch is *live*. libuv brings its
 * FSEvents stream up on another thread after `fs.watch` returns — and tears
 * it down and recreates it whenever a handle is added — so an event in that
 * gap is lost with no error. The vault service must sweep only after that
 * gap (*watch, then sweep*, decision 3), and Node gives no signal for it, so
 * one is made: a probe file under `.vitrine/` whose own event is waited for.
 */

/** Quiet for this long, with two stats agreeing, before a file is read (§ Watcher and Ingest). */
export const SETTLE_MS = 2000;

/** The one folder whose symlink is followed, so an iCloud or Dropbox PDF folder is watched. */
const PDF_FOLDER = "sources/pdf";

/** The probe that proves the watch live; a dot-entry, so nothing downstream ever sees it. */
const PROBE = ".vitrine/.watch";
/** How often the probe is touched while no event has come, and for how long before giving up. */
const PROBE_TICK_MS = 50;
const PROBE_TIMEOUT_MS = 5000;

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

  const schedule = () => {
    if (timer !== null || pending.size === 0 || closed) return;
    let earliest = Infinity;
    for (const { dueAt } of pending.values())
      earliest = Math.min(earliest, dueAt);
    timer = setTimeout(() => void fire(), Math.max(0, earliest - Date.now()));
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
      // A batch the index could not apply is reported, not fatal: the next
      // batch, or the next open's sweep, will see the same files again.
      await onSettled(settled.sort()).catch((error: unknown) =>
        onError(`a settled batch was not applied: ${errorMessage(error)}`)
      );
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

  let probed: (() => void) | null = null;

  /** The listener for one `fs.watch`; `rebase` turns its filenames into vault-relative paths. */
  const listener =
    (watched: string, rebase: (relativeToWatched: string) => string) =>
    (_: string, filename: string | Buffer | null) => {
      if (filename === null) return;
      const name = filename.toString();
      const relativeToWatched = isAbsolute(name)
        ? relative(watched, name)
        : name;
      const path = rebase(relativeToWatched.split(sep).join("/"));
      if (path === PROBE) probed?.();
      void hint(path);
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

  /**
   * Touch the probe until an event arrives, then remove it. Rewritten every
   * tick rather than written once: the stream only reports events later
   * than its own creation, so a probe written into the gap is never
   * reported, while the next touch after the gap is. Silence past the
   * timeout is not a failure here — the sweep still runs — but is worth a
   * line, since a watch that never delivers is what #190's `watching` is for.
   */
  const live = async () => {
    const probe = join(root, PROBE);
    let seen = false;
    let wake: () => void = () => undefined;
    probed = () => {
      seen = true;
      wake();
    };
    const deadline = Date.now() + PROBE_TIMEOUT_MS;
    while (!seen && !closed && Date.now() < deadline) {
      try {
        await writeFile(probe, String(Date.now()));
      } catch (error) {
        probed = null;
        onError(`the watch probe could not be written: ${errorMessage(error)}`);
        return;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
        setTimeout(resolve, PROBE_TICK_MS);
      });
    }
    probed = null;
    if (!seen && !closed) {
      onError("the watch gave no sign of life; sweeping anyway");
    }
    await unlink(probe).catch(() => undefined);
  };

  // Both watches are started before the probe: adding a handle recreates
  // the shared stream, so proving the root live and then adding the PDF
  // folder would reopen the gap the probe exists to close.
  start(root, (path) => path);
  const pdfReal = await pdfFolderOutside(root);
  if (pdfReal !== null && !closed) {
    start(pdfReal, (path) => `${PDF_FOLDER}/${path}`);
  }
  await live();
  return { close };
}
