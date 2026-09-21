import { fromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, it } from "vitest";

import { inlineFields } from "../src/syntax/inline-fields.js";

// `outline()` runs synchronously inside the index build (ADR 0014), so one
// long note must not freeze the core. This bounds the inline-field construct
// alone (`outline.performance.test.ts` bounds the whole locator): the tree
// comes out the same either way, so what a regression costs is time. Without
// the construct's `previous` hook each word start split the line into `data`
// tokens that micromark merged with one splice per line — quadratic in a
// paragraph's lines: 32,000 lines took ~20 s under vitest on the reference
// machine, ~0.4 s once fixed.
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
