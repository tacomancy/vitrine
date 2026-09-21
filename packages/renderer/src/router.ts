import { useEffect, useSyncExternalStore } from "react";

/**
 * Where the window is (ADR 0020 decision 8; `docs/architecture.md`
 * § Research Question view and triage, Navigation): `window.location.hash`
 * is the single source of truth for *where*, so a surface is an address that
 * can be copied. Everything else stays React state — no library, no store.
 */
export type Location =
  | { surface: "inbox" }
  | { surface: "questions"; path: string }
  | { surface: "loose-ends" };

export const INBOX: Location = { surface: "inbox" };
export const LOOSE_ENDS: Location = { surface: "loose-ends" };

const QUESTIONS = "#/questions/";

/** The hash for a location; the path is vault-relative and encoded per segment. */
export function hashOf(location: Location): string {
  switch (location.surface) {
    case "inbox":
      return "#/inbox";
    case "loose-ends":
      return "#/loose-ends";
    case "questions":
      return (
        QUESTIONS + location.path.split("/").map(encodeURIComponent).join("/")
      );
  }
}

/** The location a hash names; anything unrecognised is the Inbox. */
export function parseHash(hash: string): Location {
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

/** Go somewhere; the new location is a history entry, as a link's would be. */
export function navigate(location: Location) {
  window.location.hash = hashOf(location);
}

/** The window's location, kept in step with the hash. */
export function useLocation(): Location {
  const hash = useSyncExternalStore(subscribe, readHash);
  const location = parseHash(hash);
  // An empty or unknown hash reads as `#/inbox` once the window has decided
  // where it is; replaced, not pushed, so back does not land on a hash that
  // named nothing.
  useEffect(() => {
    const canonical = hashOf(location);
    if (hash !== canonical) {
      window.history.replaceState(null, "", canonical);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  }, [hash, location]);
  return location;
}
