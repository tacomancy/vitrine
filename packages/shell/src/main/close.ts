// The quit-time handshake with the core, kept pure so the wait can be tested
// without an Electron — the same reason `launch.ts` and `chooser.ts` exist.
import type { CoreMessage, ShellMessage } from "core";

/**
 * The part of the core's `utilityProcess` a close needs: ask it something,
 * hear what it says, and hear it go. Each listener registration answers
 * with the function that stops it, so nothing is left hanging off a process
 * the app is about to kill.
 */
export type CorePort = {
  postMessage: (message: ShellMessage) => void;
  onMessage: (listener: (message: CoreMessage) => void) => () => void;
  onExit: (listener: () => void) => () => void;
};

/**
 * How long the app waits for the core to close before quitting anyway. The
 * real wait is a file write per page an Obsidian edit left owing a Revision
 * (`pending-revisions.ts`), so seconds are generous; the bound is for the
 * close that cannot finish at all — a vault on a volume that has gone away.
 * Quitting anyway loses nothing, because a Revision that could not be
 * spliced stays in `queue.sqlite` and is owed again at the next open, and a
 * quit that never finishes is the app hanging.
 */
export const CORE_CLOSE_MS = 5_000;

/** Why the wait ended. `closed` is the orderly one; the other two are not. */
export type CloseOutcome = "closed" | "gone" | "gaveUp";

/**
 * Ask the core to close and wait for its answer, but never longer than
 * `withinMs` (#276). Until this existed, `app.quit()` killed the core
 * outright and the only teardown it got was `process.on("exit")`, which
 * cannot await and so splices nothing.
 */
export function closeCore(
  core: CorePort,
  withinMs: number = CORE_CLOSE_MS
): Promise<CloseOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => settle("gaveUp"), withinMs);
    function settle(outcome: CloseOutcome) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stopMessages();
      stopExit();
      resolve(outcome);
    }
    const stopMessages = core.onMessage((message) => {
      if (message.type === "closed") settle("closed");
    });
    // A core that crashed on its way out is a core there is nothing left to
    // wait for; without this the quit would sit out the whole bound.
    const stopExit = core.onExit(() => settle("gone"));
    // Asked for last, so a fast answer cannot arrive before anyone is
    // listening. A core that died between the caller's check and this line
    // throws here, and a rejection would leave the quit deferred for good —
    // `before-quit` has already called `preventDefault` by now.
    try {
      core.postMessage({ type: "close" });
    } catch {
      settle("gone");
    }
  });
}
