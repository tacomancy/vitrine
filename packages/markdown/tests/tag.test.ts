import { describe, expect, it } from "vitest";

import { canonicalTag, parseTag } from "../src/index.js";

// Obsidian's tag grammar (help.obsidian.md/tags) with the undocumented cases
// the corpus settled, docs/architecture.md § Markdown. The text handed in is
// the tag without its `#`, as a `tags:` entry is written.
describe("parseTag", () => {
  it.each([
    ["simple", "simple"],
    ["with-dash", "with-dash"],
    ["with_underscore", "with_underscore"],
    ["nested/two/levels", "nested/two/levels"],
    ["y1984", "y1984"], // T2a: one non-digit is enough
    ["émoji🙂", "émoji🙂"], // T1d
    ["ML/Probing", "ml/probing"], // T1b, T1c: one tag with #ml/probing
    ["tag/", "tag"], // T2b: the trailing slash is dropped
    ["a//b", "a//b"], // T2c: a literal empty segment is kept
    ["19/84", "19/84"], // the slash is the non-digit
  ])("%j is the tag %j", (text, canonical) => {
    expect(parseTag(text)).toEqual({ canonical });
  });

  it.each([
    ["", "empty"],
    ["1984", "only digits"], // T2a
    ["/", "only digits"], // nothing but a dropped slash
    ["machine learning", "contains whitespace"], // F8
    [" beta", "contains whitespace"], // F2b: the comma-split remainder
    ["a.b", "contains '.'"],
    ["a#b", "contains '#'"],
    ["a,b", "contains ','"],
  ])("%j is not a tag: %s", (text, reason) => {
    expect(parseTag(text)).toEqual({ invalid: reason });
  });
});

describe("canonicalTag", () => {
  it("is NFC then lowercase", () => {
    // e + combining acute (NFD) and é (NFC) are one tag.
    expect(canonicalTag("émoji")).toBe("émoji");
    expect(canonicalTag("ML/Probing")).toBe("ml/probing");
  });

  it("keeps `_` and `-` distinct", () => {
    expect(canonicalTag("with_underscore")).not.toBe(
      canonicalTag("with-underscore")
    );
  });

  it("preserves emoji", () => {
    expect(canonicalTag("émoji🙂")).toBe("émoji🙂");
  });

  it("drops trailing slashes only", () => {
    expect(canonicalTag("tag//")).toBe("tag");
    expect(canonicalTag("a//b")).toBe("a//b");
  });
});
