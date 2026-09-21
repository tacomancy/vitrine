import { describe, expect, it } from "vitest";

import { outline } from "../src/outline.js";

// `outline()` runs synchronously inside the index build (ADR 0014), so one
// long note must not freeze the core. This bounds the whole locator, gfm
// included: gfm's autolink literal registers its email construct on every
// letter, so micromark ends a `data` token at each word start and its text
// resolver merges the fragments afterwards. Unpatched, that merge is one
// splice per run — quadratic in a paragraph's lines: 32,000 lines took ~7.6 s
// on the reference machine, ~0.4 s with `patches/micromark@4.0.2.patch`
// (#196), which folds the fragments in a single pass. The bound is loose
// because CI's runner is ~5× slower (2.4 s there); what it must catch is the
// patch silently no longer applying, which is tens of seconds.
describe("outline: cost per paragraph", () => {
  it("outlines a 32,000-line paragraph in linear time", () => {
    const line = "The body, read once by the indexer.\n";
    outline(line.repeat(200)); // warm up before timing

    const started = performance.now();
    outline(line.repeat(32_000));
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(10_000);
  });
});
