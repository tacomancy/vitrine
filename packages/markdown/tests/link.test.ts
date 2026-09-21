import { describe, expect, it } from "vitest";

import { parseMarkdownLinkTarget, parseWikilink } from "../src/index.js";

// help.obsidian.md/links plus the corpus rows L1a–L1l, L4. `parseWikilink`
// takes the text between `[[` and `]]`; resolution is not its business.
describe("parseWikilink", () => {
  it.each([
    [
      "Sleep and consolidation",
      {
        target: "Sleep and consolidation",
        heading: [],
        blockId: null,
        alias: null,
      },
    ],
    [
      "Sleep and consolidation|alias",
      {
        target: "Sleep and consolidation",
        heading: [],
        blockId: null,
        alias: "alias",
      },
    ],
    [
      "Sleep and consolidation#Heading",
      {
        target: "Sleep and consolidation",
        heading: ["Heading"],
        blockId: null,
        alias: null,
      },
    ],
    [
      "note#H1#H2",
      { target: "note", heading: ["H1", "H2"], blockId: null, alias: null },
    ],
    [
      "note#^blockid",
      { target: "note", heading: [], blockId: "blockid", alias: null },
    ],
    [
      "#Own heading",
      { target: "", heading: ["Own heading"], blockId: null, alias: null },
    ],
    [
      "image.png|200",
      { target: "image.png", heading: [], blockId: null, alias: "200" },
    ],
    // L1k: the escaped pipe is an alias link; the target is unchanged.
    [
      "Sleep and consolidation\\|shown",
      {
        target: "Sleep and consolidation",
        heading: [],
        blockId: null,
        alias: "shown",
      },
    ],
    // L4b: the fragment is kept as written; matching trims it later.
    [
      "note# Heading ",
      { target: "note", heading: [" Heading "], blockId: null, alias: null },
    ],
    [
      "note#H1#^id|shown",
      { target: "note", heading: ["H1"], blockId: "id", alias: "shown" },
    ],
    [
      "paper.pdf#page=3",
      { target: "paper.pdf", heading: ["page=3"], blockId: null, alias: null },
    ],
    ["a|b|c", { target: "a", heading: [], blockId: null, alias: "b|c" }],
  ])("[[%s]]", (inner, expected) => {
    expect(parseWikilink(inner)).toEqual(expected);
  });
});

describe("parseMarkdownLinkTarget", () => {
  it("decodes %20 in a note path (L1i)", () => {
    expect(parseMarkdownLinkTarget("Sleep%20and%20consolidation.md")).toEqual({
      target: "Sleep and consolidation.md",
      heading: [],
      blockId: null,
      external: false,
    });
  });

  it("splits the heading off a note path (L1j)", () => {
    expect(
      parseMarkdownLinkTarget("Sleep%20and%20consolidation.md#Heading")
    ).toEqual({
      target: "Sleep and consolidation.md",
      heading: ["Heading"],
      blockId: null,
      external: false,
    });
  });

  it("leaves a URL alone, %20 included", () => {
    expect(parseMarkdownLinkTarget("https://example.com/a%20b#frag")).toEqual({
      target: "https://example.com/a%20b#frag",
      heading: [],
      blockId: null,
      external: true,
    });
  });

  it("reads a block id and an own-file fragment", () => {
    expect(parseMarkdownLinkTarget("note.md#^id")).toMatchObject({
      target: "note.md",
      blockId: "id",
    });
    expect(parseMarkdownLinkTarget("#Heading")).toMatchObject({
      target: "",
      heading: ["Heading"],
    });
  });

  it("keeps a target whose percent-encoding is malformed", () => {
    expect(parseMarkdownLinkTarget("100%.md")).toMatchObject({
      target: "100%.md",
    });
  });
});
