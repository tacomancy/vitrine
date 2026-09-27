import type { DatabaseSync } from "node:sqlite";

/**
 * The record of open days (#243; `docs/architecture.md` § Loose Ends): the
 * local dates the vault was open in the app.
 *
 * A quiet period — the stalled Research Question's, and every threshold
 * like it that follows — is counted in these and never in calendar days.
 * An absence of any length then adds nothing to it by construction, so a
 * fortnight away can change how much Home has to say but can never create
 * a row that was not there when the user left (stories REP-11, RES-3).
 *
 * A date is a fact about the past that no sweep could recover, which is
 * why it lives in `queue.sqlite` rather than the index.
 */

export type OpenDays = {
  /** Record this date as one the vault was open; recording it twice is a no-op. */
  record: (day: string) => void;
  /**
   * How many distinct recorded days fall strictly after `day`. Strictly,
   * because the day something was promoted is not a day it spent waiting.
   */
  since: (day: string) => number;
};

export function openDays(db: DatabaseSync): OpenDays {
  const insert = db.prepare("INSERT OR IGNORE INTO open_days (day) VALUES (?)");
  // Dates are compared as strings: an open day as it was recorded in the
  // machine's zone then, and `promoted` as the date in its own written
  // offset. Travel can shift a count by one, which a threshold in weeks
  // absorbs — and the alternative, resolving both into one zone, would
  // quietly move days the user actually spent at the vault.
  const after = db.prepare("SELECT COUNT(*) AS n FROM open_days WHERE day > ?");
  return {
    record: (day) => insert.run(day),
    since: (day) => (after.get(day) as { n: number }).n,
  };
}

/** `YYYY-MM-DD` in the machine's own zone — the form `open_days` is keyed by. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The date part of a timestamp **as it was written**, offset and all: the
 * `promoted:` key says `2026-08-20T10:04:00+01:00`, and the day it names is
 * `2026-08-20` whatever zone this machine is in now. Null when the value is
 * not a timestamp this can read a date off.
 */
export function writtenDay(timestamp: string): string | null {
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(timestamp.trim())?.[1];
  return day ?? null;
}
