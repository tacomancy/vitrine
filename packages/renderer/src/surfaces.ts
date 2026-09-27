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
  { name: "Hypothesis view" },
  { name: "Experiment view" },
  { name: "Scout Queue" },
  { name: "Vault" },
];

export const DASHBOARDS: readonly Entry[] = [
  { name: "Loose Ends", to: LOOSE_ENDS },
];

/** What a screen is called in the Global command's list, and its glyph. */
export type ScreenKind = "surface" | "dashboard";

export type Screen = { kind: ScreenKind; name: string; route: Route };

/**
 * The Surfaces and Dashboards the Global command can go to: the ones with
 * an Address and no others, which is the whole of the reach rule as it
 * applies to screens (ADR 0027 decision 4). Surfaces first, so a tie
 * between the two Kinds breaks the way the ordering says.
 */
export const SCREENS: readonly Screen[] = [
  ...SURFACES.map((entry) => ({ kind: "surface" as const, ...entry })),
  ...DASHBOARDS.map((entry) => ({ kind: "dashboard" as const, ...entry })),
].flatMap(({ kind, name, to }) =>
  to === undefined ? [] : [{ kind, name, route: to }]
);
