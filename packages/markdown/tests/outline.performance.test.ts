import { describe, expect, it } from "vitest";

import { outline } from "../src/outline.js";
import {
  LINEAR_PENALTY_BOUND,
  longParagraphPenalty,
  PERFORMANCE_TIMEOUT_MS,
} from "./performance.js";

// `outline()` runs synchronously inside the index build (ADR 0014), so one
// long note must not freeze the core. This bounds what the length of a
// paragraph adds to the whole locator, gfm included: gfm's autolink literal
// registers its email construct on every letter, so micromark ends a `data`
// token at each word start and its text resolver merges the fragments
// afterwards. Unpatched, that merge is one splice per run — quadratic in a
// paragraph's lines: 32,000 lines cost ~8 s of CPU on the reference machine,
// ~1 s with `patches/micromark@4.0.2.patch` (#196), which folds the fragments
// in a single pass. What this must catch is that patch silently no longer
// applying, and the penalty for a long paragraph (`performance.ts`) is ~18
// without it and about 1 with it. A cost that grows with the length of the
// whole note, however it is cut into paragraphs, is outside what it can see.
describe("outline: cost per paragraph", () => {
  it(
    "costs no more per line in a 32,000-line paragraph than in short ones",
    () => {
      expect(
        longParagraphPenalty(outline),
        "penalty for one 32,000-line paragraph over the same lines in short ones — check that patches/micromark@4.0.2.patch (#196) still applies"
      ).toBeLessThan(LINEAR_PENALTY_BOUND);
    },
    PERFORMANCE_TIMEOUT_MS
  );
});
