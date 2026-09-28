import { EXPERIMENTS, INBOX, LOOSE_ENDS, SETTINGS, type Route } from "./router";

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
  /**
   * Lit somewhere besides its destination — or, without one, anywhere at
   * all: a page needs a path, so a Kind's pages light the entry for it.
   */
  lit?: (at: Route) => boolean;
  /**
   * For a built surface whose contents are files of one Kind: that Kind,
   * and where such a file comes from — what the Sidebar says in place of
   * the contents while the vault provably holds none (#347).
   */
  holds?: { kind: string; hint: string };
};

export const SURFACES: readonly Entry[] = [
  { name: "Home" },
  { name: "Question Inbox", to: INBOX },
  { name: "Reader" },
  {
    name: "Research Question view",
    lit: (at) => at.surface === "research-question",
    holds: { kind: "research-question", hint: "promoted from a question" },
  },
  {
    name: "Hypothesis view",
    // No list surface: a Hypothesis is reached from its parent, its
    // Question's row, and ⌘K, so the entry lights only while one is on
    // screen (spec #327 story 79).
    lit: (at) => at.surface === "hypothesis",
    holds: { kind: "hypothesis", hint: "from a research question" },
  },
  {
    name: "Experiment view",
    // The surface is where a run is made; every Experiment's page is part
    // of it too (spec #362 story 80).
    to: EXPERIMENTS,
    lit: (at) => at.surface === "experiment",
    holds: { kind: "experiment", hint: "designed here, run elsewhere" },
  },
  { name: "Scout Queue" },
  { name: "Vault" },
];

export const DASHBOARDS: readonly Entry[] = [
  { name: "Loose Ends", to: LOOSE_ENDS },
];

/**
 * A screen that has somewhere to go: a Surface, a Dashboard, or Settings.
 * `CONTEXT.md` keeps the three words apart and this deliberately coins no
 * fourth one for them: what these rows have in common is the Address, which
 * is why the Global command can offer them at all.
 */
export type Addressed = {
  kind: "surface" | "dashboard" | "settings";
  name: string;
  route: Route;
};

/**
 * The ones with an Address and no others, which is the whole of the reach
 * rule as it applies to screens (ADR 0027 decision 4) — the same rule
 * `routeOf` is for a file. Surfaces first, so a tie between the two breaks
 * the way the ordering says. Settings last: it is not on the map, since the
 * Sidebar draws it as the vault's gear rather than an entry (ADR 0025
 * decision 1), but it has an Address, so ⌘K reaches it.
 */
export const ADDRESSED: readonly Addressed[] = [
  ...[
    ...SURFACES.map((entry) => ({ kind: "surface" as const, ...entry })),
    ...DASHBOARDS.map((entry) => ({ kind: "dashboard" as const, ...entry })),
  ].flatMap(({ kind, name, to }) =>
    to === undefined ? [] : [{ kind, name, route: to }]
  ),
  { kind: "settings", name: "Settings", route: SETTINGS },
];
