import { describe, expect, it } from "vitest";
import { printedKeywords } from "./keyword-line.js";

// A page is its lines joined by "\n"; a blank gap between lines is "\n\n"
// (what the engine's `pageLines` hands over). The parser is read through its
// answer only: which keywords, never how it found them.
const page = (...lines: string[]) => lines.join("\n");

describe("printedKeywords", () => {
  describe("labels", () => {
    it.each([
      ["Keywords: a, b", ["a", "b"]],
      ["KEYWORDS: a, b", ["a", "b"]],
      ["keywords: a, b", ["a", "b"]],
      ["Key words: a, b", ["a", "b"]],
      ["Key Words: a, b", ["a", "b"]],
      ["Author keywords: a, b", ["a", "b"]],
      ["AUTHOR KEYWORDS: a, b", ["a", "b"]],
      ["Index Terms—a, b", ["a", "b"]],
      ["Index terms: a, b", ["a", "b"]],
      ["Keywords - a, b", ["a", "b"]],
      ["Keywords – a, b", ["a", "b"]],
      ["Keywords：a, b", ["a", "b"]],
    ])("%s", (line, expected) => {
      expect(printedKeywords([page("Abstract text.", "", line)])).toEqual(
        expected
      );
    });
  });

  describe("separators", () => {
    it.each([
      ["a, b, c", ","],
      ["a; b; c", ";"],
      ["a · b · c", "middot"],
      ["a • b • c", "bullet"],
      ["a | b | c", "bar"],
      ["a ∙ b ∙ c", "bullet operator"],
    ])("%s (%s)", (list) => {
      expect(printedKeywords([page(`Keywords: ${list}`)])).toEqual([
        "a",
        "b",
        "c",
      ]);
    });
  });

  it("joins a wrapped line before splitting", () => {
    expect(
      printedKeywords([page("Keywords: sleep, memory", "consolidation, odor")])
    ).toEqual(["sleep", "memory consolidation", "odor"]);
  });

  it("joins a word hyphenated at a line end", () => {
    expect(
      printedKeywords([page("Keywords: sleep, reconsoli-", "dation, odor")])
    ).toEqual(["sleep", "reconsolidation", "odor"]);
  });

  describe("where the list ends", () => {
    it("at a blank gap", () => {
      expect(
        printedKeywords([page("Keywords: a, b", "", "Some prose, here.")])
      ).toEqual(["a", "b"]);
    });
    it("at a numbered heading", () => {
      expect(
        printedKeywords([
          page("Keywords: a, b", "1 Introduction", "Body, text."),
        ])
      ).toEqual(["a", "b"]);
    });
    it("at a roman-numeral heading", () => {
      expect(
        printedKeywords([page("Index Terms—a, b", "I. INTRODUCTION", "Body.")])
      ).toEqual(["a", "b"]);
    });
    it("at an unnumbered Introduction", () => {
      expect(
        printedKeywords([page("Keywords: a, b", "Introduction", "Body, text.")])
      ).toEqual(["a", "b"]);
    });
    it("at the end of the page", () => {
      expect(printedKeywords([page("Keywords: a, b")])).toEqual(["a", "b"]);
    });
  });

  describe("what is not a keyword line", () => {
    it("ignores the word in running prose", () => {
      expect(
        printedKeywords([
          page(
            "We extract the keywords of the query, then rank them.",
            "The keywords: a, b appear mid-sentence."
          ),
        ])
      ).toEqual([]);
    });
    it("ignores the label with no colon or dash", () => {
      expect(printedKeywords([page("Keywords are useful.")])).toEqual([]);
    });
    it("reads an empty list after the label as none", () => {
      expect(printedKeywords([page("Keywords:", "", "Body.")])).toEqual([]);
    });
    it("finds nothing in no text", () => {
      expect(printedKeywords([])).toEqual([]);
      expect(printedKeywords([""])).toEqual([]);
    });
  });

  describe("which pages", () => {
    it("finds the label on page two", () => {
      expect(
        printedKeywords([page("Abstract."), page("Keywords: a, b")])
      ).toEqual(["a", "b"]);
    });
    it("does not read page three", () => {
      expect(
        printedKeywords([
          page("Abstract."),
          page("More."),
          page("Keywords: a, b"),
        ])
      ).toEqual([]);
    });
    it("takes the first label it finds", () => {
      expect(
        printedKeywords([page("Keywords: a"), page("Keywords: b")])
      ).toEqual(["a"]);
    });
  });

  it("keeps a phrase over three words for the Lexicon to judge", () => {
    expect(
      printedKeywords([page("Keywords: one two three four, short")])
    ).toEqual(["one two three four", "short"]);
  });

  it("keeps non-ASCII text as printed", () => {
    expect(
      printedKeywords([page("Keywords: naïve Bayes; 深度学习 · Erdős–Rényi")])
    ).toEqual(["naïve Bayes", "深度学习", "Erdős–Rényi"]);
  });

  it("drops empty items and a trailing full stop", () => {
    expect(printedKeywords([page("Keywords: a,, b; ; c.")])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("is total on hostile input", () => {
    const hostile = "Keywords:" + ", ".repeat(50_000) + "x".repeat(100_000);
    expect(() => printedKeywords([hostile])).not.toThrow();
    expect(() =>
      printedKeywords([undefined as unknown as string, null as never])
    ).not.toThrow();
  });
});
