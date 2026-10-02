/**
 * What a run cost at the day's prices (`docs/architecture.md` § BYOK and
 * watched sources). The table is dated because prices move and a run's cost
 * is a fact about the day it ran; an id the table does not know records
 * tokens and no dollars, since a guessed figure would be worse than none.
 */
export const PRICES_AS_OF = "2026-06-24";

/** USD per million tokens. */
const PRICES: Array<{ prefix: string; input: number; output: number }> = [
  { prefix: "claude-opus-5", input: 5, output: 25 },
  { prefix: "claude-sonnet-5", input: 2, output: 10 },
  { prefix: "claude-haiku-4-5", input: 1, output: 5 },
];

/** Cache reads bill at a tenth of input. */
const CACHE_READ = 0.1;

export type Usage = { input: number; output: number; cacheRead: number };

export function costUsd(model: string, usage: Usage): number | null {
  const price = PRICES.find((p) => model.startsWith(p.prefix));
  if (price === undefined) return null;
  return (
    (usage.input * price.input +
      usage.cacheRead * price.input * CACHE_READ +
      usage.output * price.output) /
    1_000_000
  );
}
