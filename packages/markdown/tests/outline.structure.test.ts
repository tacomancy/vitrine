import { describe, expect, it } from "vitest";

import { outline } from "../src/index.js";

const text = (source: string, { start, end }: { start: number; end: number }) =>
  source.slice(start, end);

describe("outline: frontmatter", () => {
  it("parses the block and reads its tags with ranges into the file", () => {
    const source =
      "---\nkind: note\ntags:\n  - alpha\n  - ML/Probing\n---\n\nBody #inline\n";
    const result = outline(source);
    expect(result.frontmatter?.parsed).toBe(true);
    if (!result.frontmatter?.parsed) throw new Error("unreachable");
    expect(text(source, result.frontmatter.range)).toBe(
      "---\nkind: note\ntags:\n  - alpha\n  - ML/Probing\n---"
    );
    expect(result.frontmatter.document.get("kind")).toBe("note");
    expect(result.tags).toEqual([
      {
        valid: true,
        text: "alpha",
        canonical: "alpha",
        source: "frontmatter",
        range: { start: 25, end: 30 },
      },
      {
        valid: true,
        text: "ML/Probing",
        canonical: "ml/probing",
        source: "frontmatter",
        range: { start: 35, end: 45 },
      },
      {
        valid: true,
        text: "inline",
        canonical: "inline",
        source: "inline",
        range: { start: 56, end: 63 },
      },
    ]);
    expect(result.tags.map((t) => text(source, t.range))).toEqual([
      "alpha",
      "ML/Probing",
      "#inline",
    ]);
  });

  it("reports frontmatter that does not parse, with the reason, and still outlines the body", () => {
    const source = "---\nkind: [unclosed\n---\n\n## Heading\n";
    const result = outline(source);
    expect(result.frontmatter).toMatchObject({
      parsed: false,
      range: { start: 0, end: 23 },
    });
    if (result.frontmatter?.parsed !== false) throw new Error("unreachable");
    expect(result.frontmatter.reason).toMatch(/flow sequence|Flow sequence|\]/);
    expect(result.headings.map((h) => h.text)).toEqual(["Heading"]);
  });

  it("is null when the fence rule says there is none, and the --- is body", () => {
    const result = outline("\n---\nkind: note\n---\nBody.");
    expect(result.frontmatter).toBeNull();
    expect(result.tags).toEqual([]);
  });

  it("skips a BOM and keeps offsets into the string as given", () => {
    const source = "﻿---\nkind: note\n---\n#tag\n";
    const result = outline(source);
    expect(result.frontmatter).toMatchObject({
      parsed: true,
      range: { start: 1, end: 19 },
    });
    expect(result.tags.map((t) => text(source, t.range))).toEqual(["#tag"]);
  });

  describe("tags: forms", () => {
    const tagsOf = (fm: string) =>
      outline(`---\n${fm}\n---\n`).tags.map((t) =>
        t.valid ? t.canonical : `invalid(${t.text}: ${t.reason})`
      );

    it("reads a block sequence (F1)", () => {
      expect(tagsOf("tags:\n  - alpha\n  - ml/probing")).toEqual([
        "alpha",
        "ml/probing",
      ]);
    });

    it("drops the remainder of a comma entry as invalid (F2b)", () => {
      expect(tagsOf("tags:\n  - alpha, beta\n  - gamma")).toEqual([
        "alpha",
        "invalid( beta: contains whitespace)",
        "gamma",
      ]);
    });

    it("drops an entry with a space as invalid (F8)", () => {
      expect(tagsOf("tags: [machine learning, other]")).toEqual([
        "invalid(machine learning: contains whitespace)",
        "other",
      ]);
    });

    it("reads the legacy comma-separated string", () => {
      expect(tagsOf("tags: alpha, beta")).toEqual(["alpha", "beta"]);
    });

    it("ignores `tag:` (F3b) and a text property holding a hashtag (F7)", () => {
      expect(tagsOf("tag: legacy")).toEqual([]);
      expect(tagsOf('note: "not #a-tag"')).toEqual([]);
    });

    it("accepts a leading # and records digits-only as invalid", () => {
      expect(tagsOf('tags:\n  - "#alpha"\n  - 1984')).toEqual([
        "alpha",
        "invalid(1984: only digits)",
      ]);
    });

    it("records a non-string entry and a non-list value as invalid", () => {
      expect(tagsOf("tags:\n  - a: b")).toEqual([
        "invalid(a: b: not a string)",
      ]);
      expect(tagsOf("tags:\n  x: y")).toEqual(["invalid(x: y: not a list)"]);
      expect(tagsOf("tags:")).toEqual([]);
    });

    it("ranges point at the entry in the file", () => {
      const source = "---\ntags: [machine learning, other]\n---\n";
      const ranges = outline(source).tags.map((t) => text(source, t.range));
      expect(ranges).toEqual(["machine learning", "other"]);
    });
  });
});

describe("outline: headings and sections", () => {
  const source = [
    "Lead paragraph.",
    "",
    "## Criteria",
    "",
    "### Criterion text ^c1",
    "",
    "relationship:: confirming",
    "outcome:: not met  ",
    "",
    "- [[experiment]] — evidence",
    "",
    "### Second ^c2",
    "",
    "outcome:: met",
    "",
    "## Design notes",
    "",
    "outcome:: not a criterion field",
    "",
    "# Title *emph*",
    "closing",
  ].join("\n");
  const result = outline(source);

  it("gives every heading its level, text, line, and body to the next heading of equal or higher level", () => {
    expect(result.headings.map((h) => [h.level, h.text, h.blockId])).toEqual([
      [2, "Criteria", null],
      [3, "Criterion text", "c1"],
      [3, "Second", "c2"],
      [2, "Design notes", null],
      [1, "Title *emph*", null],
    ]);
    expect(result.headings.map((h) => text(source, h.range))).toEqual([
      "## Criteria",
      "### Criterion text ^c1",
      "### Second ^c2",
      "## Design notes",
      "# Title *emph*",
    ]);
    const [criteria, c1, c2, design, title] = result.headings;
    expect(text(source, criteria!.body)).toBe(
      "\n### Criterion text ^c1\n\nrelationship:: confirming\noutcome:: not met  \n\n- [[experiment]] — evidence\n\n### Second ^c2\n\noutcome:: met\n\n"
    );
    expect(text(source, c1!.body)).toBe(
      "\nrelationship:: confirming\noutcome:: not met  \n\n- [[experiment]] — evidence\n\n"
    );
    expect(text(source, c2!.body)).toBe("\noutcome:: met\n\n");
    expect(text(source, design!.body)).toBe(
      "\noutcome:: not a criterion field\n\n"
    );
    expect(text(source, title!.body)).toBe("closing");
  });

  it("puts the heading's block id in the block ids with the heading line as its range (B2)", () => {
    expect(
      result.blockIds.map((b) => [
        b.id,
        text(source, b.range),
        text(source, b.marker),
      ])
    ).toEqual([
      ["c1", "### Criterion text ^c1", "^c1"],
      ["c2", "### Second ^c2", "^c2"],
    ]);
  });

  it("reads inline fields with the ### block id they sit under", () => {
    expect(result.inlineFields.map((f) => [f.key, f.value, f.under])).toEqual([
      ["relationship", "confirming", "c1"],
      ["outcome", "not met", "c1"],
      ["outcome", "met", "c2"],
      ["outcome", "not a criterion field", null],
    ]);
    expect(result.inlineFields.map((f) => text(source, f.range))).toEqual([
      "relationship:: confirming",
      "outcome:: not met  ",
      "outcome:: met",
      "outcome:: not a criterion field",
    ]);
    expect(result.inlineFields.map((f) => text(source, f.valueRange))).toEqual([
      "confirming",
      "not met",
      "met",
      "not a criterion field",
    ]);
  });

  it("finds the list item and the wikilink in the evidence line", () => {
    expect(result.listItems.map((l) => text(source, l.range))).toEqual([
      "- [[experiment]] — evidence",
    ]);
    expect(result.links).toEqual([
      {
        syntax: "wikilink",
        target: "experiment",
        heading: [],
        blockId: null,
        alias: null,
        embed: false,
        range: {
          start: source.indexOf("[[experiment]]"),
          end: source.indexOf("[[experiment]]") + 14,
        },
      },
    ]);
  });

  it("does not take a heading inside a callout or a code fence for a section", () => {
    const nested = "> ## in a callout\n\n```\n## in a fence\n```\n\n## real\n";
    expect(outline(nested).headings.map((h) => h.text)).toEqual(["real"]);
  });

  it("reads a setext heading and an empty heading", () => {
    const setext = "Title\n=====\n\n##\n\nbody";
    expect(outline(setext).headings.map((h) => [h.level, h.text])).toEqual([
      [1, "Title"],
      [2, ""],
    ]);
  });

  it("sees `key:: value` inside a list item as a field, but not mid-line", () => {
    const list = "- outcome:: met\n\nsee outcome:: met\n";
    expect(outline(list).inlineFields.map((f) => [f.key, f.value])).toEqual([
      ["outcome", "met"],
    ]);
  });
});

describe("outline: block ids", () => {
  it("attaches an id to its paragraph, list item, and to the block above an own-line id (B1a–d)", () => {
    const source = [
      "A plain paragraph to link to. ^6ea9c9",
      "",
      "- list item one",
      "- list item two ^aa75c2",
      "",
      "| col a | col b |",
      "| ----- | ----- |",
      "| 1     | 2     |",
      "",
      "^e4e371",
      "",
      "> [!note]",
      "> A callout to link to.",
      "",
      "^86acd3",
      "",
      "> quoted ^inquote",
      "",
    ].join("\n");
    const result = outline(source);
    expect(result.blockIds.map((b) => [b.id, text(source, b.range)])).toEqual([
      ["6ea9c9", "A plain paragraph to link to. ^6ea9c9"],
      ["aa75c2", "- list item two ^aa75c2"],
      ["e4e371", "| col a | col b |\n| ----- | ----- |\n| 1     | 2     |"],
      ["86acd3", "> [!note]\n> A callout to link to."],
      ["inquote", "> quoted ^inquote"],
    ]);
    expect(result.blockIds.map((b) => text(source, b.marker))).toEqual([
      "^6ea9c9",
      "^aa75c2",
      "^e4e371",
      "^86acd3",
      "^inquote",
    ]);
  });

  it("is not a block id mid-paragraph, glued to a word, with an illegal character, or alone at the top of a file", () => {
    expect(outline("line one ^id\nline two\n").blockIds).toEqual([]);
    expect(outline("word^id\n").blockIds).toEqual([]);
    expect(outline("word ^id_x\n").blockIds).toEqual([]);
    expect(outline("word ^id x\n").blockIds).toEqual([]);
    expect(outline("^id\n").blockIds).toEqual([]);
  });

  it("allows trailing whitespace after the id", () => {
    const source = "Paragraph ^h12  \n";
    expect(outline(source).blockIds.map((b) => text(source, b.marker))).toEqual(
      ["^h12"]
    );
  });
});

describe("outline: links", () => {
  it("parses every documented form and no external URL", () => {
    const source = [
      "[[Sleep and consolidation]]",
      "[[Sleep and consolidation|alias]]",
      "[[Sleep and consolidation#Heading]]",
      "[[Sleep and consolidation#H1#H2]]",
      "[[Sleep and consolidation#^blockid]]",
      "[[#Own heading]]",
      "![[Sleep and consolidation]]",
      "![[image.png|200]]",
      "[md link](Sleep%20and%20consolidation.md)",
      "[md link](Sleep%20and%20consolidation.md#Heading)",
      "[[Sleep and consolidation\\|shown]]",
      "[url with percent](https://example.com/a%20b)",
      "![alt](image.png)",
      "<https://example.com>",
      "https://example.com/bare",
    ].join("\n");
    const result = outline(source);
    expect(result.links.map((l) => text(source, l.range))).toEqual(
      source.split("\n").slice(0, 11).concat(["![alt](image.png)"])
    );
    expect(
      result.links.map((l) => [
        l.syntax,
        l.target,
        l.heading,
        l.blockId,
        l.alias,
        l.embed,
      ])
    ).toEqual([
      ["wikilink", "Sleep and consolidation", [], null, null, false],
      ["wikilink", "Sleep and consolidation", [], null, "alias", false],
      ["wikilink", "Sleep and consolidation", ["Heading"], null, null, false],
      ["wikilink", "Sleep and consolidation", ["H1", "H2"], null, null, false],
      ["wikilink", "Sleep and consolidation", [], "blockid", null, false],
      ["wikilink", "", ["Own heading"], null, null, false],
      ["wikilink", "Sleep and consolidation", [], null, null, true],
      ["wikilink", "image.png", [], null, "200", true],
      ["markdown", "Sleep and consolidation.md", [], null, "md link", false],
      [
        "markdown",
        "Sleep and consolidation.md",
        ["Heading"],
        null,
        "md link",
        false,
      ],
      ["wikilink", "Sleep and consolidation", [], null, "shown", false],
      ["markdown", "image.png", [], null, "alt", true],
    ]);
  });

  it("does not read a wikilink across lines or an empty one", () => {
    expect(outline("[[a\nb]] and [[]]\n").links).toEqual([]);
  });

  it("reads a wikilink inside a table cell", () => {
    const source = "| a |\n| - |\n| [[Target\\|shown]] |\n";
    expect(outline(source).links.map((l) => [l.target, l.alias])).toEqual([
      ["Target", "shown"],
    ]);
  });
});

describe("outline: line endings", () => {
  it("keeps CRLF offsets honest", () => {
    const source =
      "---\r\nkind: note\r\n---\r\n\r\n## Heading ^h1\r\n\r\ntext #tag\r\n\r\n- item\r\n";
    const result = outline(source);
    expect(text(source, result.frontmatter!.range)).toBe(
      "---\r\nkind: note\r\n---"
    );
    expect(text(source, result.headings[0]!.range)).toBe("## Heading ^h1");
    expect(text(source, result.headings[0]!.body)).toBe(
      "\r\ntext #tag\r\n\r\n- item\r\n"
    );
    expect(text(source, result.tags[0]!.range)).toBe("#tag");
    expect(text(source, result.listItems[0]!.range)).toBe("- item");
    expect(text(source, result.blockIds[0]!.marker)).toBe("^h1");
  });

  it("handles a file without a trailing newline (S5)", () => {
    const source = "Body. #tag";
    expect(text(source, outline(source).tags[0]!.range)).toBe("#tag");
  });
});
