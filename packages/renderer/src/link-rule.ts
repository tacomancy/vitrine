/**
 * What the window does with a link it did not write (#407, #424; the
 * shell's counterpart is `routeLink` in `packages/shell/src/main/
 * navigation.ts`). Text from a paper's metadata, a note or an agent can hold
 * `file:///…`, `javascript:…` or `obsidian://…`; Chromium stops the first
 * two inside the renderer before the shell ever hears, so a surface that
 * drew them as links would show a click that does nothing and says nothing
 * (§ Invariants, no silent failures). So the surface decides *before* it
 * draws: a link that goes out is a link, and one that will not is drawn as
 * plainly not one and says, when activated, which scheme it had.
 *
 * `OUTBOUND` is the shell's `EXTERNAL_SCHEMES`, restated because the
 * renderer cannot import the Electron package; `link-rule.test.tsx` pins the
 * two together so neither can drift.
 */
export const OUTBOUND: ReadonlySet<string> = new Set([
  "https:",
  "http:",
  "mailto:",
]);

export type LinkKind =
  /** Goes to the default browser, by the parsed URL's own spelling. */
  | { kind: "out"; href: string }
  /** One of the app's own routes: the window moves, nothing leaves. */
  | { kind: "route"; href: string }
  /** Not followed. `scheme` is what it had, or null when it had none. */
  | { kind: "refused"; scheme: string | null; text: string };

export function classifyLink(href: string): LinkKind {
  // The app's own Addresses are hashes (ADR 0020 decision 8).
  if (href.startsWith("#/")) return { kind: "route", href };
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return { kind: "refused", scheme: null, text: href };
  }
  return OUTBOUND.has(parsed.protocol)
    ? { kind: "out", href: parsed.href }
    : { kind: "refused", scheme: parsed.protocol, text: href };
}

/** What activating a refused link says. */
export const refusal = (scheme: string | null) =>
  scheme === null
    ? "Vitrine will not follow this link: it is not an address."
    : `Vitrine will not follow ${scheme} links.`;
