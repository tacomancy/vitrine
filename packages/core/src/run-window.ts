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

import { effectiveSettleMs } from "./vault-watcher.js";

/** Quiet for this long after the last PDF named, and the held PDFs are read (§ Watcher and Ingest). */
export const RUN_WINDOW_MS = 5000;

/** No PDF is held longer than this after the first one in its hold, however steadily more arrive. */
export const RUN_CEILING_MS = 60_000;

type RunWindowOptions = {
  /**
   * The settle window the watcher is asked for. The window is never under
   * twice the one the watcher actually uses, its own floor included
   * (`effectiveSettleMs`): the cap closes Batches about one settle window
   * apart, and a window of one would race the next Batch and split the
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

/**
 * The window actually used for the one asked for, which is never under twice
 * the settle window the watcher actually uses (see `RunWindowOptions`). Its own
 * export so that what the test harness waits for is read from this rule and not
 * copied from it.
 */
export const effectiveRunWindowMs = (windowMs: number, settleMs: number) =>
  Math.max(windowMs, 2 * effectiveSettleMs(settleMs));

export type RunWindow = {
  /** A `vaultChanged` named these PDFs: hold them, and start the window again. */
  hold: (paths: readonly string[]) => void;
  /** Every Source is about to be read, which covers whatever is held: forget it, unread. */
  discard: () => void;
  /** The vault is going: nothing held will be read. */
  close: () => void;
};

export function createRunWindow({
  settleMs,
  windowMs,
  ceilingMs,
  run,
}: RunWindowOptions): RunWindow {
  const effectiveWindowMs = effectiveRunWindowMs(windowMs, settleMs);
  const effectiveCeilingMs = Math.max(ceilingMs, effectiveWindowMs);
  const held = new Set<string>();
  // The window's timer, started again by every PDF named, and the ceiling's,
  // started by the first PDF of a hold and moved by nothing after it.
  let windowTimer: NodeJS.Timeout | undefined;
  let ceilingTimer: NodeJS.Timeout | undefined;

  const forget = () => {
    clearTimeout(windowTimer);
    clearTimeout(ceilingTimer);
    windowTimer = ceilingTimer = undefined;
    held.clear();
  };
  const release = () => {
    const paths = [...held];
    forget();
    if (paths.length > 0) run(paths);
  };

  return {
    hold: (paths) => {
      if (ceilingTimer === undefined) {
        ceilingTimer = setTimeout(release, effectiveCeilingMs);
        // A pending timer must never be the reason the process stays up.
        ceilingTimer.unref();
      }
      for (const path of paths) held.add(path);
      clearTimeout(windowTimer);
      windowTimer = setTimeout(release, effectiveWindowMs);
      windowTimer.unref();
    },
    discard: forget,
    close: forget,
  };
}
