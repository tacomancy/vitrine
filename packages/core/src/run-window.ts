/**
 * The run window (ADR 0013, update for #553; `docs/architecture.md` § Watcher
 * and Ingest, *The run window*): the wait between a `vaultChanged` naming a PDF
 * and Ingest reading it, so that a delivery is one run however it was cut.
 *
 * It is Ingest's and not the watcher's because the watcher cannot see what
 * cuts a delivery — its own cap closes a Batch about one settle window after
 * its first path whatever keeps arriving (#189), a stalled loop closes one
 * before events the OS has already delivered are heard (#554), and the
 * open-time sweep raises one `vaultChanged` per 250-file chunk — and a Batch
 * is also what the index applies, which must not wait. Every one of those
 * reaches the vault service as a `vaultChanged`, so that is where this sits.
 *
 * The window starts again with every `vaultChanged` that names a PDF, so a
 * delivery is read when it goes quiet. It never asks the watcher whether more
 * is coming: that view is empty after a stall and between two large files,
 * which is where the window is needed.
 *
 * A window that starts again can be starved by a stream that never goes quiet
 * — a library syncing for an hour, one PDF rewritten every few seconds — and
 * every other PDF's Ingest would wait on it for as long as it lasted. So no
 * PDF is held past the ceiling, counted from the first PDF in its hold: the
 * hold ends then whatever is still arriving, and the next PDF opens a new one.
 */

/** Quiet for this long after the last PDF named, and the held PDFs are read (§ Watcher and Ingest). */
export const RUN_WINDOW_MS = 5000;

/** No PDF is held longer than this after the first one in its hold, however steadily more arrive. */
export const RUN_CEILING_MS = 60_000;

export type RunWindowOptions = {
  /**
   * The settle window the watcher actually uses, its own floor included. The
   * window is never under twice it: the cap closes Batches about one settle
   * window apart, and a window of one would race the next Batch and split the
   * delivery it exists to join. Enforced here, in the callee, because a
   * caller that had to remember it would one day hand in a shorter one.
   */
  settleMs: number;
  /** How long after the last PDF named the held ones are read; raised to the floor if shorter. */
  windowMs: number;
  /** The longest a hold lasts, from the first PDF in it; raised to the window if shorter. */
  ceilingMs: number;
  /** Reads the held PDFs as one Ingest run. */
  run: (paths: string[]) => void;
};

export type RunWindow = {
  /** A `vaultChanged` named these PDFs: hold them, and start the window again. */
  hold: (paths: readonly string[]) => void;
  /** The caller is about to read every Source, which covers whatever is held: drop it. */
  drain: () => void;
  /** The vault is going: nothing held will be read. */
  close: () => void;
};

export function createRunWindow({
  settleMs,
  windowMs,
  ceilingMs,
  run,
}: RunWindowOptions): RunWindow {
  const window = Math.max(windowMs, 2 * settleMs);
  const ceiling = Math.max(ceilingMs, window);
  const held = new Set<string>();
  // The window, started again by every PDF named, and the ceiling, started by
  // the first PDF of a hold and moved by nothing after it.
  let quiet: NodeJS.Timeout | undefined;
  let limit: NodeJS.Timeout | undefined;

  const stop = () => {
    clearTimeout(quiet);
    clearTimeout(limit);
    quiet = limit = undefined;
  };
  const drop = () => {
    stop();
    held.clear();
  };
  const release = () => {
    const paths = [...held];
    drop();
    if (paths.length > 0) run(paths);
  };

  return {
    hold: (paths) => {
      if (held.size === 0) {
        limit = setTimeout(release, ceiling);
        // A pending timer must never be the reason the process stays up.
        limit.unref();
      }
      for (const path of paths) held.add(path);
      clearTimeout(quiet);
      quiet = setTimeout(release, window);
      quiet.unref();
    },
    drain: drop,
    close: drop,
  };
}
