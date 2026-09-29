import { describe, expect, it } from "vitest";
import {
  pageWords,
  sameDocument,
  SAME_DOCUMENT,
  type Fingerprint,
} from "./document-fingerprint.js";

// The fingerprint on its own (#420; spec #416 stories 43–44). Its numbers are
// architecture.md's: a save must stay above the threshold, a replacement below.

const of = (id: string, pages: string[]): Fingerprint => ({
  id,
  pages: pages.length,
  page_words: pages.map(pageWords),
});

describe("pageWords", () => {
  it("keeps words of four letters or more, once each, sorted, after normalising", () => {
    expect(
      pageWords("The Sleep spindles; sleep SPINDLES down-\nstream, of it")
    ).toEqual(["downstream", "sleep", "spindles"]);
  });
});

describe("sameDocument", () => {
  const text = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";

  it("is the same file when the id is the same, whatever the words say", () => {
    expect(sameDocument(of("aa", ["alpha"]), of("aa", ["zulu"]))).toBe(true);
  });

  it("does not take a different id as a different document: a Preview save replaces it", () => {
    expect(sameDocument(of("aa", [text]), of("bb", [text]))).toBe(true);
  });

  it("is a different document when the page count differs", () => {
    expect(sameDocument(of("aa", [text]), of("bb", [text, text]))).toBe(false);
  });

  it("holds its threshold at the edge", () => {
    expect(SAME_DOCUMENT).toBe(0.9);
    const ten =
      "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
    // 10 shared of 10 + 1 extra = 10/11 = 0.909; two extra = 10/12 = 0.833.
    expect(sameDocument(of("a", [ten]), of("b", [ten + " kilo"]))).toBe(true);
    expect(sameDocument(of("a", [ten]), of("b", [ten + " kilo lima"]))).toBe(
      false
    );
  });

  it("is a different document when any single page is", () => {
    expect(
      sameDocument(
        of("a", [text, text]),
        of("b", [text, "other words entirely here"])
      )
    ).toBe(false);
  });

  it("cannot show an older sidecar changed", () => {
    expect(
      sameDocument(
        { id: "a", pages: 1 },
        of("b", ["utterly different words here"])
      )
    ).toBe(true);
  });
});
