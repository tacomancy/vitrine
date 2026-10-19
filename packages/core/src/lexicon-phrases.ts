/**
 * The phrases of a paper's title and abstract (`docs/architecture.md` §
 * Lexicon, *Phrases at refresh*): every 1–3-word run, lower-cased,
 * ASCII-folded and punctuation-stripped, with a stopword at either edge
 * disqualifying it. One unit for the Index's phrase table, a Seed the user
 * types and the query compiled from both (ADR 0045 decision 9), so they can
 * never disagree about what a Term is.
 */

export const MAX_PHRASE_WORDS = 3;

const STOPWORDS = new Set(
  `a about above after again all also am an and any are as at be because been
before being below between both but by can could did do does doing down during
each few for from further had has have having he her here hers him his how i
if in into is it its itself just may me might more most must my no nor not now
of off on once only or other our ours out over own same she should so some such
than that the their theirs them then there these they this those through to too
under until up us very was we were what when where which while who whom why
will with within without would you your yours via using use used based new`
    .split(/\s+/)
    .filter(Boolean)
);

/** The words of each punctuation-delimited stretch of `text`, folded. */
function segments(text: string): string[][] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9\s-]+/)
    .map((stretch) => stretch.split(/[^a-z0-9]+/).filter(Boolean))
    .filter((words) => words.length > 0);
}

const usable = (words: readonly string[]) =>
  !STOPWORDS.has(words[0]!) &&
  !STOPWORDS.has(words[words.length - 1]!) &&
  !words.every((w) => /^\d+$/.test(w)) &&
  !(words.length === 1 && words[0]!.length < 2);

/** Phrase → how many times it occurs in the given texts. */
export function phrasesOf(...texts: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const words of segments(text)) {
      for (let size = 1; size <= MAX_PHRASE_WORDS; size++) {
        for (let at = 0; at + size <= words.length; at++) {
          const run = words.slice(at, at + size);
          if (!usable(run)) continue;
          const phrase = run.join(" ");
          counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
        }
      }
    }
  }
  return counts;
}

/**
 * A single phrase as typed — an author keyword now, a Seed later: the
 * normalised phrase, or null where it is empty or longer than three words.
 * Stopword edges are allowed here: the author chose it, so it is not noise.
 */
export function normalisePhrase(text: string): string | null {
  const stretches = segments(text);
  const words = stretches.flat();
  return words.length === 0 || words.length > MAX_PHRASE_WORDS
    ? null
    : words.join(" ");
}

/** How many words a typed phrase has once folded: 0 is empty, over three is too long. */
export const wordCount = (text: string): number => segments(text).flat().length;

/** The abstract of a Source or stub: the `> ` quoted lines of its body, unescaped. */
export function abstractOf(body: string): string {
  return body
    .split("\n")
    .filter((line) => line.startsWith(">"))
    .map((line) => line.replace(/^>\s?/, "").replace(/\\([#\[\]])/g, "$1"))
    .join(" ");
}
