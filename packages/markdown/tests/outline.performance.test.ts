import { fromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, it } from "vitest";

import { inlineFields } from "../src/syntax/inline-fields.js";

// `outline()` runs synchronously inside the index build (ADR 0014), so one
// long note must not freeze the core. The tree comes out the same either way
// — what a regression costs is time, so time is what this bounds. The
// inline-field construct is registered on every key character; without its
// `previous` hook each word start split the line into `data` tokens, which
// micromark then merged with one splice per line: quadratic in a paragraph's
// lines. 32,000 lines took ~20 s under vitest on the reference machine,
// ~0.4 s once fixed. (gfm's autolink literal splits at word starts too, at a
// smaller constant; that is upstream and outside this bound.)
describe("inline fields: cost per paragraph", () => {
  it("tokenizes a 32,000-line paragraph in linear time", () => {
    const line = "The body, read once by the indexer.\n";
    const parse = (lines: number) =>
      fromMarkdown(line.repeat(lines), { extensions: [inlineFields()] });
    parse(200); // warm up before timing

    const started = performance.now();
    parse(32_000);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(2_000);
  });
});
