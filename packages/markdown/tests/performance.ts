/**
 * The CPU time, in milliseconds, that `work` costs this process, not the time
 * it took: elapsed time answers for everything else the machine is doing as
 * well. Beside 40 busy loops on ten cores the outline's 32,000-line paragraph
 * took 6 s elapsed where it takes 0.7 s alone, while its CPU time went from
 * 0.9 s to 1.5 s (#538). (CPU time can exceed elapsed time at rest: V8's
 * collector and compiler threads are counted too.)
 *
 * `process.cpuUsage` covers the whole process, which is this one test file
 * under Vitest's default `forks` pool — that is why it is safe here, and a
 * `threads` pool would count the neighbouring files too.
 */
export function cpuMs(work: () => void): number {
  const before = process.cpuUsage();
  work();
  const { user, system } = process.cpuUsage(before);
  return (user + system) / 1000;
}

const LINE = "The body, read once by the indexer.\n";

/**
 * How many times dearer `parse` finds one paragraph of 32,000 lines than the
 * same lines as 160 short paragraphs, in CPU time: how its cost per line grows
 * with the length of a paragraph. About 1 while that cost is linear (0.8 to 1.8
 * measured); 10 to 27 when it is quadratic in a paragraph's lines, as
 * micromark's merge of `data` tokens is without `patches/micromark@4.0.2.patch`
 * (#196). A cost that grows with the length of the whole note, however it is
 * cut into paragraphs, is not seen.
 *
 * A ratio, not a number of seconds, because no number of seconds holds on both
 * machines these tests run on: the macOS CI runner is 2 to 4 times slower than
 * a laptop and spreads 2.5 times from run to run, so a bound that suits one
 * fails or misses on the other (the old ones were loosened once, and were then
 * past what the regression costs on a laptop). Speed and load scale the two
 * measurements alike. What a quadratic merge changes is how they compare.
 *
 * The baseline is the cheaper of two runs of the short paragraphs: the first
 * still pays for compiling what it runs, which on its own took a genuine
 * regression's penalty from 18 to 6, and noise only ever adds to a timing.
 */
export function longParagraphPenalty(
  parse: (markdown: string) => unknown
): number {
  const short = (LINE.repeat(200) + "\n").repeat(160);
  const long = LINE.repeat(32_000);
  parse(LINE.repeat(200)); // warm up before measuring

  const baseline = Math.min(
    cpuMs(() => parse(short)),
    cpuMs(() => parse(short))
  );
  return cpuMs(() => parse(long)) / baseline;
}

/**
 * Where the performance tests draw the line on `longParagraphPenalty`: nearly
 * three times the dearest healthy penalty measured (1.8), and half the cheapest
 * regression's (9.7).
 */
export const LINEAR_PENALTY_BOUND = 5;

/**
 * A performance test's timeout, wide because it must never be what judges the
 * run. A synchronous test cannot be interrupted, so Vitest's 5 s default only
 * fails a run *after* it has finished — as a bare `Test timed out` that names
 * nothing, even though the assertion passed — and these tests outgrow it
 * without anything being wrong: the outline's takes 6.5 s elapsed inside the
 * full suite and 41 s beside 40 busy loops. The failure belongs to the
 * assertion on `longParagraphPenalty`, which names what it measured. ADR 0029
 * declined a global `testTimeout`; this is local to the tests that need it, as
 * `TIMING_TIMEOUT_MS` is in the watcher suite.
 */
export const PERFORMANCE_TIMEOUT_MS = 120_000;
