import { describe, expect, it } from "vitest";

import { outline } from "../src/index.js";

// Inline tags through the locator: which `#` contexts count is the part of
// tag recognition ADR 0008 decision 4 bought micromark for.
function inlineTags(source: string) {
  return outline(source)
    .tags.filter((tag) => tag.source === "inline")
    .map((tag) => (tag.valid ? tag.canonical : `invalid:${tag.text}`));
}

describe("outline: inline tags", () => {
  it("finds the tags in prose with their ranges", () => {
    const source =
      "Tags in prose: #simple #with-dash #nested/two/levels #ML/Probing\n";
    const tags = outline(source).tags;
    expect(tags.map((t) => t.valid && t.canonical)).toEqual([
      "simple",
      "with-dash",
      "nested/two/levels",
      "ml/probing",
    ]);
    expect(tags.map((t) => source.slice(t.range.start, t.range.end))).toEqual([
      "#simple",
      "#with-dash",
      "#nested/two/levels",
      "#ML/Probing",
    ]);
    expect(tags[3]).toMatchObject({ text: "ML/Probing", source: "inline" });
  });

  it("ends a tag at punctuation and keeps the emoji", () => {
    expect(inlineTags("(#one), #two. #émoji🙂!")).toEqual([
      "one",
      "two",
      "émoji🙂",
    ]);
  });

  it("is not a tag glued to a word, nor escaped", () => {
    expect(inlineTags("issue#1 and a#b and \\#escaped")).toEqual([]);
  });

  it.each([
    ["a fenced code block", "```\ncode with #infence\n```\n"], // T3b
    ["an indented code block", "para\n\n    indented #inindent\n"], // T3c
    ["a code span", "Inline `#inspan` here\n"], // T3d
    ["a wikilink fragment", "[[Sleep and consolidation#inwikilink]]\n"], // T3e
    ["a markdown link URL", "[text](https://example.com/#inmdlink)\n"], // T3f
    ["a bare URL", "Bare URL: https://example.com/#inbareurl\n"], // T3g
    ["an autolink", "<https://example.com/#inautolink>\n"], // T3h
    ["inline math", "Inline math: $x #inmath y$\n"], // T3i
    ["an HTML comment", "HTML comment: <!-- #inhtmlcomment -->\n"], // T3k
    ["an HTML block", "<!--\n#inhtmlblock\n-->\n"],
    ["a heading marker", "# notatag-heading\n"], // T2d
    ["a bare hash", "Bare hash: # and #\n"], // T2e
    ["digits only", "Numeric only: #1984\n"], // T2a
    ["an unclosed fence", "```\n#infence1\n~~~\nstill fenced #infence2\n"], // T4a, T4b
  ])("does not count a # inside %s", (_, source) => {
    expect(inlineTags(source)).toEqual([]);
  });

  it.each([
    [
      "a %%comment%%",
      "Obsidian comment: %%hidden #incomment%%\n",
      ["incomment"],
    ], // T3j
    ["inline HTML", "<span>#insidehtml</span>\n", ["insidehtml"]], // T5b
    ["after a < b", "if a < b then #comparison holds\n", ["comparison"]], // T5
    [
      "after a closed fence",
      "```\n#in\n```\nclosed now. #afterfence",
      ["afterfence"],
    ], // T4c
    ["a table cell", "| a | b |\n| - | - |\n| #cell | 2 |\n", ["cell"]],
    ["a blockquote", "> quoted #inquote\n", ["inquote"]],
    ["a list item", "- item #inlist\n", ["inlist"]],
    ["a heading", "## Heading #inheading\n", ["inheading"]],
    ["a trailing slash", "Trailing slash: #tag/\n", ["tag"]], // T2b
    ["a double slash", "Double slash: #a//b\n", ["a//b"]], // T2c
    ["a digit after a letter", "#y1984\n", ["y1984"]], // T2a
  ])("counts a tag in %s", (_, source, expected) => {
    expect(inlineTags(source)).toEqual(expected);
  });

  it("does not read the frontmatter as prose", () => {
    expect(inlineTags('---\nnote: "not #a-tag"\n---\n')).toEqual([]); // F7
  });
});
