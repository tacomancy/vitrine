import { matchKey as core } from "../../core/src/display-name.js";
import { describe, expect, it } from "vitest";
import { matchKey, matchRun } from "./match";

/**
 * The one test that holds the Global command's two halves together. The key
 * exists twice — the core matches the objects, the renderer orders across
 * them and its own Surfaces and Dashboards, and nothing can be shared
 * because `core` is a types-only devDependency and the renderer bundles for
 * a browser (`docs/architecture.md` § The Global command's list is half the
 * renderer's). A row the renderer keyed differently would score differently
 * and sort above rows the core had already cut, and no test of either side
 * alone would see it. So this one imports both and compares them.
 *
 * `display-name.ts` reaches for `node:path` and nothing else, which is what
 * makes importing it from here cheap.
 */
const CORPUS = [
  "",
  "Is replay necessary for consolidation?",
  "Does slow-wave density predict recall gain?",
  "Sleep's role — REM/NREM?",
  "Müller & Bäumler 2019",
  // Greek: final sigma is the mapping that made the two diverge once, and
  // lowercasing a string is not lowercasing its characters one by one.
  "ΟΔΟΣ",
  "ΆΣ",
  "Ο ΎΠΝΟΣ ΚΑΙ Η ΜΝΉΜΗ",
  // Turkish and German: a dotted capital grows a combining mark, and ẞ is
  // one character that lowercases to one.
  "İstanbul",
  "STRASSE",
  "GROẞE",
  "  leading and trailing  ",
  "…‽ punctuation only ‽…",
  "don’t — the curly one",
  "日本語のタイトル",
  "emoji 🧠 in the middle",
  "0.5 s, not 1 s",
];

describe("the renderer's key and the core's are one rule", () => {
  it.each(CORPUS)("keys %j the same on both sides", (text) => {
    expect(matchKey(text)).toBe(core(text));
  });
});

describe("a run is marked only where the walk agrees with the rule", () => {
  it.each(CORPUS)("never marks the wrong characters of %j", (text) => {
    const key = matchKey(text);
    // Every word the name holds must either mark exactly itself, or not
    // mark at all — never some other span.
    for (const word of key.split(" ").filter(Boolean)) {
      const run = matchRun(text, word);
      if (run === null) continue;
      expect(matchKey(text.slice(run[0], run[1]))).toBe(word);
    }
  });

  it("marks what it can: the ordinary name is never the one it gives up on", () => {
    expect(
      matchRun("Does slow-wave density predict recall gain?", "density")
    ).not.toBeNull();
  });
});
