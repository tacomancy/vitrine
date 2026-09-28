/**
 * The renderer's half of the Global command's match (ADR 0027 decisions 5
 * and 6). `packages/core/src/display-name.ts` and `destinations.ts` hold
 * the same key and the same rungs, and deliberately: the command's list is
 * half objects and half Surfaces and Dashboards, which are not files and so
 * are not the core's to know. The core matches and orders its half; the
 * renderer merges its own into them and orders across both, which it cannot
 * do without scoring the rows the core sent. The two copies have to agree —
 * a row the renderer scored differently would sort above rows the core had
 * already cut — so any change to one is a change to both.
 *
 * What only exists here is the run to mark: the core answers with the
 * Display name as it is written, and a row has to show which part of it the
 * query found.
 */

/**
 * The same walk as `matchKey` below, one character at a time, recording
 * where in the original each key character came from — which is what makes
 * the marked run possible, and is the one thing this side has that the core
 * does not.
 *
 * It is an approximation of `matchKey` and never its definition: lowercasing
 * per character is not lowercasing the string, because a few mappings are
 * context-sensitive (final sigma — `ΟΔΟΣ` is `οδος` whole and `οδοσ` by the
 * character). `matchRun` therefore checks this walk against `matchKey` and
 * declines to mark rather than mark the wrong run, so the divergence can
 * only ever cost a highlight. It must never reach `strength`, where it would
 * cost a row its place.
 */
function keyed(text: string): { key: string; from: number[]; to: number[] } {
  let key = "";
  const from: number[] = [];
  const to: number[] = [];
  let pendingSpace = false;
  let at = 0;
  for (const char of text) {
    const start = at;
    at += char.length;
    if (/['’]/u.test(char)) continue;
    if (!/[\p{L}\p{N}]/u.test(char)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && key !== "") {
      key += " ";
      from.push(start);
      to.push(start);
    }
    pendingSpace = false;
    const lower = char.toLowerCase();
    key += lower;
    // One span per code unit, so `from` and `to` stay parallel to `key`
    // even where lowercasing a character yields more than one of them.
    for (let unit = 0; unit < lower.length; unit++) {
      from.push(start);
      to.push(at);
    }
  }
  return { key, from, to };
}

/**
 * The form a Display name and a query are compared in, character for
 * character as `packages/core/src/display-name.ts` spells it — the whole
 * string lowercased at once, because that is where the context-sensitive
 * mappings live. `match.pinned.test.ts` holds the two to each other.
 *
 * A run of punctuation becomes one space rather than nothing, so *slow-wave
 * density* is found by either half of the word as well as the whole of it.
 * An apostrophe is the exception and goes, because *sleep's role* is one
 * word to anyone typing it. Letters and digits of every script survive.
 */
export const matchKey = (text: string): string =>
  text
    .toLowerCase()
    .replace(/['\u2019]+/gu, "")
    // Whitespace is outside the class too, so this collapses runs as well.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * How well a name answers the query, the prototype's four rungs
 * (branch `prototype/global-command`, variant B):
 *
 *   3 exact · 2 prefix · 1 word start · 0 contains
 *
 * Both arguments are already `matchKey`ed, so a word start is a space
 * followed by the query — the name's own first word is the prefix rung
 * above. An empty query is every name equally, which is what leaves the
 * list before a character is typed to Kind and recency alone.
 */
export function strength(query: string, display: string): number {
  if (query === "") return 0;
  if (display === query) return 3;
  if (display.startsWith(query)) return 2;
  return display.includes(` ${query}`) ? 1 : 0;
}

/**
 * The span of `display` the query matched, as `display` is written — so a
 * query typed across a hyphen marks the hyphen too, which is the honest
 * answer to *why is this row here*. Null when nothing has been typed, and
 * for a name that does not hold the query at all: every rung of `strength`
 * contains it, so a row that scored has a run to mark.
 */
export function matchRun(
  display: string,
  query: string
): [number, number] | null {
  const wanted = matchKey(query);
  if (wanted === "") return null;
  const { key, from, to } = keyed(display);
  // The walk disagreeing with the rule is rare and always harmless here:
  // no mark, rather than a mark over the wrong characters.
  if (key !== matchKey(display)) return null;
  const start = key.indexOf(wanted);
  if (start < 0) return null;
  const begins = from[start];
  const ends = to[start + wanted.length - 1];
  return begins === undefined || ends === undefined ? null : [begins, ends];
}
