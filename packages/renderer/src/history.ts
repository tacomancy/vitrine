import type { Revision } from "core";
import { localDate, MONTHS } from "./rows";

/**
 * The Position history's arithmetic (brief § Position history; spec #206
 * story 37): what the file's entries mean once they are read newest-first
 * as a narrative. Pure and keyed by field name, so a Hypothesis claim or an
 * Experiment design renders through the same two functions (story 59).
 */

/**
 * One line of the rendered history: an explained Revision leading the
 * narrative, or a run of quiet ones collapsed into a trail.
 */
export type HistoryRow =
  | {
      kind: "explained";
      revision: Revision;
      /** The text this Revision moved the field *to*; empty when nothing says. */
      to: string;
      /** What makes it stand on its own whether or not it carries a why (`loudness`); null for an entry that stands by its why. */
      loud: Loud | null;
    }
  | { kind: "quiet"; revisions: Revision[] };

/** What makes an entry loud: a criterion's two suffixes, and an Override's two fields, as the history writes them. */
export type Loud =
  | "edited after evidence"
  | "deleted after evidence"
  | "override"
  | "override voided";

// The grammar's suffixes and fields, as `hypothesis-rule.ts` in the core
// writes them; the renderer imports only types from the core, so the
// literals are repeated.
const SUFFIXES: readonly Loud[] = [
  "edited after evidence",
  "deleted after evidence",
];
const OVERRIDES: readonly Loud[] = ["override", "override voided"];

/**
 * A criterion changed after evidence was attached (TEST-5; ADR 0031
 * decision 4) is never collapsed into the quiet trail, with a why or
 * without: the absence of a reason there is the thing a reader most needs
 * to see (prototype 04, the history's loud entries; spec #327 story 50).
 * Nor is one deleted after evidence in Obsidian — the extreme case of
 * moving the bar (story 52; #336). Nor an Override or its void (story 50;
 * #337): the call that contradicted the derived state, and the moment it
 * stopped standing, are what a reader six months on most needs to find.
 */
export const loudness = (revision: Revision): Loud | null =>
  OVERRIDES.find((field) => revision.field === field) ??
  SUFFIXES.find((suffix) => revision.field.endsWith(` · ${suffix}`)) ??
  null;

/**
 * The field a chain runs along. A criterion's runs by its number, which
 * never moves (ADR 0031 decision 3): its label's letter changes with its
 * Relationship — making it diagnostic, the commonest edit after evidence —
 * and a marked entry is still its criterion's.
 */
const chainOf = (field: string) => {
  const criterion = /^criterion (?:[CFD]|\^c)(\d+)(?: · |$)/.exec(field);
  return criterion === null ? field : `criterion ${criterion[1]}`;
};

/**
 * The entries as rows, in the file's newest-first order. An entry records
 * only what the field moved *from*, so what it moved *to* is the next newer
 * entry's `from` — or, for the newest of a field, the field as it stands
 * now. The chain is per field: two fields' entries interleave in one
 * section, and a claim's Revision must not be read as the answer's previous
 * text.
 */
export function historyRows(
  entries: Revision[],
  /** Each field's text as the file holds it now, keyed by field name. */
  current: Record<string, string>,
  /**
   * Which entries become rows (`hypothesisFilters`). The chain still runs
   * over every entry, so hiding one never changes what another moved to;
   * a quiet run closes over the entries it hides.
   */
  shows: (revision: Revision) => boolean = () => true
): HistoryRow[] {
  const latest = new Map(Object.entries(current));
  const rows: HistoryRow[] = [];
  for (const revision of entries) {
    const chain = chainOf(revision.field);
    const to = latest.get(chain) ?? "";
    latest.set(chain, revision.from);
    if (!shows(revision)) continue;
    const loud = loudness(revision);
    if (revision.why !== null || loud !== null) {
      rows.push({ kind: "explained", revision, to, loud });
      continue;
    }
    const last = rows[rows.length - 1];
    if (last?.kind === "quiet") last.revisions.push(revision);
    else rows.push({ kind: "quiet", revisions: [revision] });
  }
  return rows;
}

/** One way of reading a long history: its button's words, and which entries it keeps. */
export type HistoryFilter = {
  label: string;
  shows: (revision: Revision) => boolean;
};

/**
 * A Hypothesis's history read for the question asked of it (spec #327
 * story 55; prototype 04's *claim · criteria · every overrule*): the claim
 * alone; criterion edits alone — every `criterion` entry, and a `criteria`
 * row an Obsidian edit left unjudged (#336); and what decided the state —
 * each `· state` entry with the criterion Revision stamped beside it,
 * since that shared timestamp is what attributes the move (#334), and every
 * Override and void. Over the entries given, because the pairing is found
 * by timestamp.
 */
export function hypothesisFilters(entries: Revision[]): HistoryFilter[] {
  const moves = new Set(
    entries.filter((e) => e.field === "state").map((e) => e.at)
  );
  const ofCriterion = (field: string) =>
    field === "criteria" || field.startsWith("criterion ");
  return [
    { label: "claim", shows: (e) => e.field === "claim" },
    { label: "criterion edits", shows: (e) => ofCriterion(e.field) },
    {
      label: "what decided it",
      shows: (e) =>
        e.field === "state" ||
        OVERRIDES.includes(e.field as Loud) ||
        (ofCriterion(e.field) && moves.has(e.at)),
    },
  ];
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * `4 quiet revisions over 6 weeks` — the trail's one line. A run inside a
 * single day has no span worth claiming; the row's date already says when.
 */
export function quietLabel(revisions: Revision[]): string {
  const count = `${revisions.length} quiet revision${revisions.length === 1 ? "" : "s"}`;
  const span = spanOf(revisions);
  return span === null ? count : `${count} over ${span}`;
}

/** The coarsest unit that does not round the run away: days, then weeks, months, years. */
function spanOf(revisions: Revision[]): string | null {
  const times = revisions.map((r) => Date.parse(r.at)).filter((t) => !isNaN(t));
  if (times.length === 0) return null;
  const days = Math.floor((Math.max(...times) - Math.min(...times)) / DAY);
  if (days < 1) return null;
  if (days < 14) return plural(days, "day");
  if (days < 60) return plural(Math.round(days / 7), "week");
  if (days < 365) return plural(Math.round(days / 30), "month");
  return plural(Math.floor(days / 365), "year");
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/**
 * Both ends of a run in one line — `20 Jun – 21 Jul 2026`, the year said
 * once. The date column is narrow, and two full dates in it wrap into four
 * lines beside a one-line trail.
 */
export function rangeLabel(oldest: string, newest: string): string {
  const from = new Date(oldest);
  const to = new Date(newest);
  if (from.getFullYear() !== to.getFullYear()) {
    return `${localDate(oldest)} – ${localDate(newest)}`;
  }
  const short = (d: Date) =>
    `${d.getDate()} ${MONTHS[d.getMonth()]?.slice(0, 3)}`;
  return `${short(from)} – ${short(to)} ${to.getFullYear()}`;
}
