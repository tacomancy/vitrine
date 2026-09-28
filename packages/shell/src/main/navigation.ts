// Kept pure so what the window may move to can be tested without an
// Electron — the same reason `chooser.ts` and `launch.ts` exist.

/**
 * Whether the window may go to `url`, given the URL it loaded the app from.
 *
 * Only the app's own origin, so the hash routes move and nothing else does.
 * Anything that would leave — a link in a note, a script setting
 * `location`, a dropped file if Electron's `navigateOnDragDrop` were ever
 * turned on — replaces the whole app until a reload, with no way back from
 * inside it. `file:` needs no case of its own: it is never the app's origin.
 */
export function allowNavigation(url: string, appUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}
