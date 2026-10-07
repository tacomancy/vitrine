import { fromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, it } from "vitest";

import { inlineFields } from "../src/syntax/inline-fields.js";
import {
  LINEAR_PENALTY_BOUND,
  longParagraphPenalty,
  PERFORMANCE_TIMEOUT_MS,
} from "./performance.js";

// `outline()` runs synchronously inside the index build (ADR 0014), so one
// long note must not freeze the core. This covers the inline-field construct
// together with micromark's merge of `data` tokens (the whole locator is
// `outline.performance.test.ts`'s), and fails when both have gone quadratic at
// once. Without the construct's `previous` hook each word start splits the line
// into `data` tokens, which that merge handles with one splice per line unless
// `patches/micromark@4.0.2.patch` (#196) is applied. The penalty
// (`performance.ts`) for 32,000 lines:
//
//   hook and patch both gone   20 to 27
//   patch gone, hook there     about 1    (the patch alone is the outline's)
//   hook gone, patch there     about 1.5  (a constant factor, ~2.4x the time,
//                                          which a ratio cannot see)
//   both there                 about 1
//
// So the hook going missing on its own is not caught here, and neither is a
// cost that grows with the length of the whole note (#538 records both).
describe("inline fields: cost per paragraph", () => {
  it(
    "costs no more per line in a 32,000-line paragraph than in short ones",
    () => {
      const parse = (markdown: string) =>
        fromMarkdown(markdown, { extensions: [inlineFields()] });

      expect(
        longParagraphPenalty(parse),
        "penalty for one 32,000-line paragraph over the same lines in short ones — check the construct's `previous` hook and patches/micromark@4.0.2.patch (#196)"
      ).toBeLessThan(LINEAR_PENALTY_BOUND);
    },
    PERFORMANCE_TIMEOUT_MS
  );
});
