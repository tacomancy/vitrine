import type { ListedQuestion } from "core";

/**
 * How long a gap between two consecutive captures may be and still be the
 * same sitting (#265; spec #206 story 60, from HOLD-4). Wall-clock adjacency
 * rather than *same `from`*, for two reasons: a sitting that moved from one
 * paper to the next is exactly the train of thought the story wants
 * recovered, and `from` is already on the pane a line above, so grouping by
 * it would say twice what is already said once.
 *
 * A number in code, as the stalled Research Question's threshold is
 * (`loose-ends.ts`): a setting would make the user responsible for a
 * judgement the app is making.
 */
export const SITTING_GAP_MINUTES = 90;

/**
 * The other Questions captured in the same sitting as `path`, in capture
 * order — the maximal run of captures containing it whose adjacent gaps are
 * all within `gapMinutes`. Empty when it is alone in its run, and that is
 * what the pane draws nothing at all for.
 *
 * Computed here and not in the core: `questions.list` already returns every
 * Question sorted by `captured`, which is all a run needs, so a procedure
 * for this would be a second way to ask what the Inbox has already asked.
 * A Partial file has no `captured`, belongs to no sitting and breaks none —
 * `Listing` keeps it out of `questions` entirely.
 */
export function othersInSitting(
  questions: ListedQuestion[],
  path: string,
  gapMinutes: number
): ListedQuestion[] {
  // The list arrives in whichever order the Inbox is sorted by; a run is a
  // fact about capture order, so it is read in that order either way.
  const order = [...questions].sort(
    (a, b) => Date.parse(a.captured) - Date.parse(b.captured)
  );
  const self = order.findIndex((question) => question.path === path);
  if (self === -1) return [];
  const gap = gapMinutes * 60_000;
  // Within the threshold, so a gap of exactly it is inside the run.
  const joined = (earlier: number, later: number) =>
    Date.parse(order[later]!.captured) - Date.parse(order[earlier]!.captured) <=
    gap;
  let start = self;
  while (start > 0 && joined(start - 1, start)) start -= 1;
  let end = self;
  while (end < order.length - 1 && joined(end, end + 1)) end += 1;
  return [...order.slice(start, self), ...order.slice(self + 1, end + 1)];
}
