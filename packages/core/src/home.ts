import { localDay, type OpenDays } from "./open-days.js";

/**
 * The day the researcher was last here, when that is far enough back to be
 * an absence (spec #728 stories 9–10): the latest open day before today, said
 * only when it is not yesterday, so a normal day carries no *away* clause. Null
 * on the first ever open, which has no previous day to be away since.
 */
export function awaySince(days: OpenDays, now: Date): string | null {
  const previous = days.before(localDay(now));
  if (previous === null) return null;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return previous >= localDay(yesterday) ? null : previous;
}
