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
 * `blob:` does: an object URL carries the origin of the page that made it,
 * and the Experiment page makes them for Artifacts, so the scheme must match
 * as well or a link to one would put the file in place of the app.
 */
export function allowNavigation(url: string, appUrl: string): boolean {
  try {
    const to = new URL(url);
    const app = new URL(appUrl);
    return to.protocol === app.protocol && to.origin === app.origin;
  } catch {
    return false;
  }
}

// The only schemes handed to the OS. `shell.openExternal` gives a URL to
// whatever app claims its scheme, so a custom one (`obsidian:`, anything an
// installed app registers) would let text in a note launch that app with
// arguments of the note's choosing. `file:` is refused too: a local path is
// the app's to reveal (`shell.showItemInFolder`), never to open.
// Exported so the renderer's link rule is pinned to it by a test.
export const EXTERNAL_SCHEMES = new Set(["https:", "http:", "mailto:"]);

export type LinkRoute =
  | { to: "window" }
  | { to: "browser"; url: string }
  | { to: "refused"; scheme: string | undefined; url: string };

/**
 * Where a link the window was asked to follow goes: the app's own routes
 * stay in the window (`allowNavigation`), web and mail links go to the
 * default browser, and anything else is refused — and said to be, since a
 * link that does nothing is a silent failure (#392).
 *
 * A browser route's `url` is the parsed URL's own spelling, not the text that
 * arrived, so what reaches `shell.openExternal` is exactly what the scheme
 * check looked at. A refusal keeps the text as it came, to be shown.
 */
export function routeLink(url: string, appUrl: string): LinkRoute {
  if (allowNavigation(url, appUrl)) return { to: "window" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { to: "refused", scheme: undefined, url };
  }
  return EXTERNAL_SCHEMES.has(parsed.protocol)
    ? { to: "browser", url: parsed.href }
    : { to: "refused", scheme: parsed.protocol, url };
}
