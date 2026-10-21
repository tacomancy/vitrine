import { createHash } from "node:crypto";
import { relative } from "node:path";
import { dismiss, dismissed, readDismissals, undismiss } from "./dismissals.js";
import { VaultError } from "./errors.js";
import { listQuestions, type ListedQuestion } from "./list.js";
import { localDay, type OpenDays } from "./open-days.js";
import type { VaultIndex } from "./vault-index.js";

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

/**
 * How long an open Question must have sat before it can come back: a calendar
 * fact, not a quiet period, so open days are not involved (spec #728).
 */
export const RESURFACE_AFTER_DAYS = 60;

/** How many it shows. Fewer when the pool holds fewer; none when it is empty. */
const RESURFACED = 3;

/** The row kind this store keeps its dismissals under, apart from every Loose Ends kind. */
export const RESURFACED_KIND = "resurfaced";

/**
 * What `dismissals.json` keys a Question by: its `id:`, or its vault-relative
 * path when another tool wrote it without one (`dismissals.ts`).
 */
const subjectOf = (vaultPath: string, q: ListedQuestion) =>
  q.id ?? relative(vaultPath, q.path);

/** Whole calendar days from `from` to `to`, counted in the machine's own zone. */
function calendarDaysBetween(from: Date, to: Date): number {
  const day = (d: Date) =>
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  return day(to) - day(from);
}

// mulberry32: a few lines, no dependency, and the same stream for the same
// seed on every machine — the property the choice rests on.
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * *From the notebook*: three open Questions old enough to have been forgotten,
 * picked by a shuffle seeded by the local date plus the client's `seed`. The
 * same date and seed give the same three on every read, so a reload does not
 * reshuffle and tomorrow is a new page — the mechanism is predictable, the
 * tone is random. Nothing weights the pick: any signal would turn a random
 * page into a ranking.
 *
 * The pool is derived from the status each time, so a promoted, answered or
 * abandoned Question leaves by itself, and it is never counted in the reply:
 * how many older Questions there are is not Home's to say. A Partial and an
 * Unreadable file are not in `questions`, so neither can be picked.
 */
export async function resurfaced(
  index: VaultIndex,
  vaultPath: string,
  now: Date,
  seed: number
): Promise<{ questions: ListedQuestion[] }> {
  const { dismissals } = await readDismissals(vaultPath);
  const pool = listQuestions(index, vaultPath, "oldest")
    .questions.filter(
      (q) =>
        q.status === "open" &&
        calendarDaysBetween(new Date(q.captured), now) >=
          RESURFACE_AFTER_DAYS &&
        !dismissed(dismissals, subjectOf(vaultPath, q), RESURFACED_KIND)
    )
    // The listing's order is the index's; the shuffle must not depend on it.
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const next = random(
    createHash("sha256")
      .update(`${localDay(now)}:${seed}`)
      .digest()
      .readUInt32BE(0)
  );
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return { questions: pool.slice(0, RESURFACED) };
}

/** The key a dismissal of the Question at `path` is stored under; refuses a path that is no Question here. */
function keyOf(index: VaultIndex, vaultPath: string, path: string): string {
  const found = listQuestions(index, vaultPath, "oldest").questions.find(
    (q) => q.path === path
  );
  if (found === undefined) {
    throw new VaultError("refused", "That is not a Question in this vault.");
  }
  return subjectOf(vaultPath, found);
}

/** Out of the rotation, never out of the vault: nothing in the Question's own file is touched. */
export function dismissResurfaced(
  index: VaultIndex,
  vaultPath: string,
  path: string,
  at: string
): Promise<void> {
  return dismiss(vaultPath, keyOf(index, vaultPath, path), RESURFACED_KIND, at);
}

export function undismissResurfaced(
  index: VaultIndex,
  vaultPath: string,
  path: string
): Promise<void> {
  return undismiss(vaultPath, keyOf(index, vaultPath, path), RESURFACED_KIND);
}
