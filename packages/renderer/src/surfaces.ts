import { INBOX, LOOSE_ENDS, type Route } from "./router";

/**
 * The product's own map: the eight Surfaces the brief names, in
 * `CONTEXT.md`'s order, then the Dashboards. One list, because two places
 * read it and they must not disagree — the Sidebar draws all of it, live
 * or inert, and the Global command offers the part of it that has an
 * Address. A Surface reachable on the map but not from ⌘K would be the
 * kind of quiet divergence § Invariants rules out; here a beat adds `to`
 * once and both wake up.
 */
export type Entry = {
  name: string;
  /** Where it goes, for the ones that have somewhere to go. */
  to?: Route;
  /** Lit without a destination of its own: a page needs a path. */
  lit?: (at: Route) => boolean;
};

export const SURFACES: readonly Entry[] = [
  { name: "Home" },
  { name: "Question Inbox", to: INBOX },
  { name: "Reader" },
  {
    name: "Research Question view",
    lit: (at) => at.surface === "research-question",
  },
  {
    name: "Hypothesis view",
    // No list surface: a Hypothesis is reached from its parent, its
    // Question's row, and ⌘K, so the entry lights only while one is on
    // screen (spec #327 story 79).
    lit: (at) => at.surface === "hypothesis",
  },
  { name: "Experiment view" },
  { name: "Scout Queue" },
  { name: "Vault" },
];

export const DASHBOARDS: readonly Entry[] = [
  { name: "Loose Ends", to: LOOSE_ENDS },
];

/**
 * A Surface or a Dashboard that has somewhere to go. `CONTEXT.md` keeps the
 * two words apart and this deliberately coins no third one for the pair:
 * what these rows have in common is the Address, which is why the Global
 * command can offer them at all.
 */
export type Addressed = {
  kind: "surface" | "dashboard";
  name: string;
  route: Route;
};

/**
 * The ones with an Address and no others, which is the whole of the reach
 * rule as it applies to screens (ADR 0027 decision 4) — the same rule
 * `routeOf` is for a file. Surfaces first, so a tie between the two breaks
 * the way the ordering says.
 */
export const ADDRESSED: readonly Addressed[] = [
  ...SURFACES.map((entry) => ({ kind: "surface" as const, ...entry })),
  ...DASHBOARDS.map((entry) => ({ kind: "dashboard" as const, ...entry })),
].flatMap(({ kind, name, to }) =>
  to === undefined ? [] : [{ kind, name, route: to }]
);
