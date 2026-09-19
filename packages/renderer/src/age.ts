const DAY = 24 * 60 * 60 * 1000;

/**
 * How long ago a Question was captured, in the Inbox's shape: under 24h
 * "today", under 30 days "Nd", under 12 months "Nmo", otherwise "Ny" with a
 * month remainder when there is one. Computed here from `captured` and now;
 * never stored, and never a state — the same grey at every age.
 */
export function formatAge(captured: string, now: Date): string {
  const elapsed = now.getTime() - Date.parse(captured);
  if (elapsed < DAY) return "today";
  const days = Math.floor(elapsed / DAY);
  if (days < 30) return `${days}d`;
  // 30 days is a month even when the calendar has not turned one.
  const months = Math.max(1, monthsBetween(new Date(captured), now));
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest === 0 ? `${years}y` : `${years}y ${rest}mo`;
}

/** Whole calendar months from `from` to `to`, floored. */
function monthsBetween(from: Date, to: Date): number {
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return months;
}
