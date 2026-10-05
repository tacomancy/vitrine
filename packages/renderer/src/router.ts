import { useEffect, useSyncExternalStore } from "react";

/**
 * Where the window is (ADR 0020 decision 8; `docs/architecture.md`
 * § Research Question view and triage, Navigation): `window.location.hash`
 * is the single source of truth for *where*, so a surface is an address that
 * can be copied. Everything else stays React state — no library, no store.
 *
 * A Kind-addressed object takes its Kind's own singular name, as `kind:`
 * spells it in frontmatter; surfaces keep their own (ADR 0026).
 */
export type Route =
  | { surface: "inbox"; question?: string; unresolved?: Unresolved }
  | { surface: "research-question"; path: string }
  | { surface: "hypothesis"; path: string }
  | { surface: "experiment"; path: string }
  | { surface: "source"; path: string; arrival?: Arrival }
  | { surface: "experiments" }
  | { surface: "loose-ends" }
  | { surface: "question-map" }
  | { surface: "scouts" }
  | { surface: "settings"; section?: "credentials" };

/**
 * An Address the window arrived on and could not reach, and what came back
 * when it tried: a hash under the prefix ADR 0026 retired, or one whose file
 * the vault cannot answer for. Every one of them lands on the Inbox saying
 * which Address it was (ADR 0027 decision 7) — the Inbox is where the window
 * is when it is nowhere in particular, and a dead Address that said nothing
 * would be indistinguishable from having asked for the Inbox.
 */
/**
 * Where a Source's Reader arrives (`?page=<n>` or `?block=h<n>`), read once
 * on arrival and never rewritten as the user moves (#424; spec #416 "The
 * Address"): the hash is where they came in, not a cursor.
 */
export type Arrival = { page: number } | { block: string };

export type Unresolved = { address: string; reason: string };

export const INBOX: Route = { surface: "inbox" };
export const LOOSE_ENDS: Route = { surface: "loose-ends" };
/** The Question Map (ADR 0041): a Dashboard, opened deliberately. */
export const QUESTION_MAP: Route = { surface: "question-map" };
/** The Experiment surface: where a run is made by name (#364). */
export const EXPERIMENTS: Route = { surface: "experiments" };
export const SETTINGS: Route = { surface: "settings" };
/** Settings with the Credentials section brought into view: where a Scout blocked on its key sends the researcher (#470). */
export const SETTINGS_CREDENTIALS: Route = {
  surface: "settings",
  section: "credentials",
};
/** The Scout Queue (#448): where what the Scouts found waits to be decided. */
export const SCOUTS: Route = { surface: "scouts" };

/**
 * A Question's Address is the Inbox with a row named (#300; ADR 0027
 * decision 7). It is not a surface of its own: the window is on the Inbox
 * either way, and what the Address carries is where to arrive — the
 * selection moving afterwards is not a change of location and never reaches
 * the hash.
 */
const QUESTION = "#/question/";
const RESEARCH_QUESTION = "#/research-question/";
const HYPOTHESIS = "#/hypothesis/";
const EXPERIMENT = "#/experiment/";
const SOURCE = "#/source/";

/**
 * `#/questions/` addressed a *Research* Question — the prefix and the Kind
 * said opposite things. ADR 0026 leaves it unrecognised rather than
 * redefining it: an Address is copyable, so a prefix given a new referent
 * would open a different object without saying it had. Kept here as the one
 * hash the fall-through has to recognise well enough to name.
 */
const RETIRED = "#/questions/";

/** The hash for a route; the path is vault-relative and encoded per segment. */
export function hashOf(route: Route): string {
  switch (route.surface) {
    case "inbox":
      return route.question === undefined
        ? "#/inbox"
        : QUESTION + encodePath(route.question);
    case "loose-ends":
      return "#/loose-ends";
    case "question-map":
      return "#/question-map";
    case "experiments":
      return "#/experiments";
    case "settings":
      return route.section === "credentials"
        ? "#/settings/credentials"
        : "#/settings";
    case "scouts":
      return "#/scouts";
    case "research-question":
      return RESEARCH_QUESTION + encodePath(route.path);
    case "hypothesis":
      return HYPOTHESIS + encodePath(route.path);
    case "experiment":
      return EXPERIMENT + encodePath(route.path);
    case "source":
      return (
        SOURCE +
        encodePath(route.path) +
        (route.arrival === undefined
          ? ""
          : "page" in route.arrival
            ? `?page=${route.arrival.page}`
            : `?block=${route.arrival.block}`)
      );
  }
}

const encodePath = (path: string) =>
  path.split("/").map(encodeURIComponent).join("/");

/**
 * The vault-relative path a hash carries under `prefix`; null when the hash
 * is not one of those, names no path, or cannot be decoded — each of which
 * is an address nothing wrote, and so the Inbox without a word.
 */
function pathUnder(hash: string, prefix: string): string | null {
  if (!hash.startsWith(prefix)) return null;
  try {
    const path = hash
      .slice(prefix.length)
      .split("/")
      .map(decodeURIComponent)
      .join("/");
    return path === "" ? null : path;
  } catch {
    return null;
  }
}

/**
 * A Source's Address. A query this app did not write is not read as if it
 * were no query: it lands on the Inbox naming itself, since a link that
 * meant to arrive somewhere and arrived at the top would be a silent
 * failure.
 */
function parseSource(hash: string): Route {
  const at = hash.indexOf("?");
  const base = at === -1 ? hash : hash.slice(0, at);
  const path = pathUnder(base, SOURCE);
  if (path === null) return INBOX;
  if (at === -1) return { surface: "source", path };
  const query = new URLSearchParams(hash.slice(at + 1));
  const page = /^[1-9]\d*$/.exec(query.get("page") ?? "");
  const block = /^h[1-9]\d*$/.exec(query.get("block") ?? "");
  const one = query.size === 1;
  if (one && page) {
    return { surface: "source", path, arrival: { page: Number(page[0]) } };
  }
  if (one && block) {
    return { surface: "source", path, arrival: { block: block[0] } };
  }
  return {
    surface: "inbox",
    unresolved: {
      address: hash,
      reason: "not an arrival a Source opens on (?page=<n> or ?block=h<n>)",
    },
  };
}

/**
 * The route a hash names; anything unrecognised is the Inbox. Two different
 * things arrive there and the second is owed a word: a hash nothing ever
 * wrote, and one that used to mean something (§ Invariants, no silent
 * failures — the second would otherwise be indistinguishable from a typo).
 */
function parseHash(hash: string): Route {
  if (hash === "#/loose-ends") return LOOSE_ENDS;
  if (hash === "#/question-map") return QUESTION_MAP;
  if (hash === "#/experiments") return EXPERIMENTS;
  if (hash === "#/settings") return SETTINGS;
  if (hash === "#/settings/credentials") return SETTINGS_CREDENTIALS;
  if (hash === "#/scouts") return SCOUTS;
  const question = pathUnder(hash, QUESTION);
  if (question !== null) return { surface: "inbox", question };
  const page = pathUnder(hash, RESEARCH_QUESTION);
  if (page !== null) return { surface: "research-question", path: page };
  const hypothesis = pathUnder(hash, HYPOTHESIS);
  if (hypothesis !== null) return { surface: "hypothesis", path: hypothesis };
  const experiment = pathUnder(hash, EXPERIMENT);
  if (experiment !== null) return { surface: "experiment", path: experiment };
  if (hash.startsWith(SOURCE)) return parseSource(hash);
  if (hash.startsWith(RETIRED))
    return {
      surface: "inbox",
      unresolved: {
        address: hash,
        reason: "no longer an Address this app uses",
      },
    };
  return INBOX;
}

// Both of what the window reads below: the hash, and the history entry's own
// state. `popstate` is here for the second — back and forward between two
// entries on one hash would otherwise change what the window knows about the
// arrival without telling anyone.
const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
};

const readHash = () => window.location.hash;

/**
 * The Address that did not resolve, read off the history entry it landed on.
 * It cannot live in the hash — the canonicalising replace below rewrites that
 * to `#/inbox`, which is what makes the landing visible rather than a flash —
 * and it is not app state: it is a fact about one arrival, so going back to
 * that entry says it again and every other entry says nothing (ADR 0021
 * refused a store, and this is the entry's own to hold).
 *
 * Read a field at a time, and kept flat in the entry to make that possible:
 * `history.state` hands back a fresh clone on every access, so a snapshot of
 * the object itself would never equal the last one and the window would
 * re-render forever.
 */
type EntryState = { address?: string; reason?: string };

const readAddress = () =>
  (window.history.state as EntryState | null)?.address ?? null;
const readReason = () =>
  (window.history.state as EntryState | null)?.reason ?? null;

const stateOf = (route: Route): EntryState | null =>
  route.surface === "inbox" && route.unresolved !== undefined
    ? { ...route.unresolved }
    : null;

/**
 * Move the window to a route without a history entry: for a surface whose
 * file was renamed under it, so the address follows the file and back does
 * not return to a name that is gone.
 */
export function replaceRoute(route: Route): void {
  window.history.replaceState(stateOf(route), "", hashOf(route));
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/**
 * Move the window to a route with a history entry: where a triage action
 * lands — a promotion goes to its page, and back returns to the Inbox.
 */
export function pushRoute(route: Route): void {
  window.history.pushState(stateOf(route), "", hashOf(route));
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** Where the window is, kept in step with the hash. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, readHash);
  const address = useSyncExternalStore(subscribe, readAddress);
  const reason = useSyncExternalStore(subscribe, readReason);
  const parsed = parseHash(hash);
  // The entry's Address belongs to a bare `#/inbox`: it is what a landing
  // that did not resolve left behind, and an Address naming a row is an
  // arrival of its own.
  const route: Route =
    parsed.surface === "inbox" &&
    parsed.question === undefined &&
    parsed.unresolved === undefined &&
    address !== null &&
    reason !== null
      ? { surface: "inbox", unresolved: { address, reason } }
      : parsed;
  // An empty or unknown hash reads as `#/inbox` once the window has decided
  // where it is; replaced, not pushed, so back does not land on a hash that
  // named nothing.
  useEffect(() => {
    const canonical = hashOf(route);
    if (hash !== canonical) replaceRoute(route);
  }, [hash, route]);
  return route;
}
