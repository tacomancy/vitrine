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
      /** An entry that stands on its own whether or not it carries a why (`isLoud`). */
      loud: boolean;
    }
  | { kind: "quiet"; revisions: Revision[] };

// The grammar's suffix, as `hypothesis.ts` in the core writes it; the
// renderer imports only types from the core, so the literal is repeated.
const AFTER_EVIDENCE = " · edited after evidence";

/**
 * A criterion changed after evidence was attached (TEST-5; ADR 0031
 * decision 4) is never collapsed into the quiet trail, with a why or
 * without: the absence of a reason there is the thing a reader most needs
 * to see (prototype 04, the history's loud entries; spec #327 story 50).
 */
export const isLoud = (revision: Revision) =>
  revision.field.endsWith(AFTER_EVIDENCE);

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
  current: Record<string, string>
): HistoryRow[] {
  const latest = new Map(Object.entries(current));
  const rows: HistoryRow[] = [];
  for (const revision of entries) {
    const chain = chainOf(revision.field);
    const to = latest.get(chain) ?? "";
    latest.set(chain, revision.from);
    const loud = isLoud(revision);
    if (revision.why !== null || loud) {
      rows.push({ kind: "explained", revision, to, loud });
      continue;
    }
    const last = rows[rows.length - 1];
    if (last?.kind === "quiet") last.revisions.push(revision);
    else rows.push({ kind: "quiet", revisions: [revision] });
  }
  return rows;
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
