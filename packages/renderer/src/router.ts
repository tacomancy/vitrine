import { useEffect, useSyncExternalStore } from "react";

/**
 * Where the window is (ADR 0020 decision 8; `docs/architecture.md`
 * § Research Question view and triage, Navigation): `window.location.hash`
 * is the single source of truth for *where*, so a surface is an address that
 * can be copied. Everything else stays React state — no library, no store.
 */
export type Route =
  | { surface: "inbox" }
  | { surface: "questions"; path: string }
  | { surface: "loose-ends" };

export const INBOX: Route = { surface: "inbox" };
export const LOOSE_ENDS: Route = { surface: "loose-ends" };

const QUESTIONS = "#/questions/";

/** The hash for a route; the path is vault-relative and encoded per segment. */
export function hashOf(route: Route): string {
  switch (route.surface) {
    case "inbox":
      return "#/inbox";
    case "loose-ends":
      return "#/loose-ends";
    case "questions":
      return (
        QUESTIONS + route.path.split("/").map(encodeURIComponent).join("/")
      );
  }
}

/** The route a hash names; anything unrecognised is the Inbox. */
function parseHash(hash: string): Route {
  if (hash === "#/loose-ends") return LOOSE_ENDS;
  if (hash.startsWith(QUESTIONS)) {
    try {
      const path = hash
        .slice(QUESTIONS.length)
        .split("/")
        .map(decodeURIComponent)
        .join("/");
      if (path !== "") return { surface: "questions", path };
    } catch {
      // A malformed escape is an address nothing wrote; fall through.
    }
  }
  return INBOX;
}

const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

const readHash = () => window.location.hash;

/**
 * Move the window to a route without a history entry: for a surface whose
 * file was renamed under it, so the address follows the file and back does
 * not return to a name that is gone.
 */
export function replaceRoute(route: Route): void {
  window.history.replaceState(null, "", hashOf(route));
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** Where the window is, kept in step with the hash. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, readHash);
  const route = parseHash(hash);
  // An empty or unknown hash reads as `#/inbox` once the window has decided
  // where it is; replaced, not pushed, so back does not land on a hash that
  // named nothing.
  useEffect(() => {
    const canonical = hashOf(route);
    if (hash !== canonical) replaceRoute(route);
  }, [hash, route]);
  return route;
}
