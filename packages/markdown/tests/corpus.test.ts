import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { outline, type Outline } from "../src/index.js";

// Golden tests over the Obsidian-written corpus (#112): one snapshot per
// file, and every README row whose answer is about one file's contents
// asserted by its id. The README's Observed column is the oracle.
const corpus = join(import.meta.dirname, "../../core/fixtures/obsidian-corpus");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .flatMap((entry) =>
      entry.isDirectory()
        ? files(join(dir, entry.name))
        : [join(dir, entry.name)]
    )
    .filter((path) => path.endsWith(".md") && !path.endsWith("README.md"))
    .sort();
}

const read = (name: string) => readFileSync(join(corpus, name), "utf8");
const of = (name: string) => outline(read(name));
const slice = (
  source: string,
  { start, end }: { start: number; end: number }
) => source.slice(start, end);

// The parsed yaml Document is not snapshot material; its plain value is.
function snapshotOf(result: Outline) {
  const frontmatter = result.frontmatter?.parsed
    ? {
        ...result.frontmatter,
        document: result.frontmatter.document.toJS() as unknown,
      }
    : result.frontmatter;
  return { ...result, frontmatter };
}

describe("corpus", () => {
  for (const path of files(corpus)) {
    const name = relative(corpus, path);
    const source = readFileSync(path, "utf8");

    it(`${name}: outline snapshot`, () => {
      expect(snapshotOf(outline(source))).toMatchSnapshot();
    });

    it(`${name}: source.slice(start, end) is every node's text`, () => {
      const result = outline(source);
      if (result.frontmatter) {
        expect(slice(source, result.frontmatter.range)).toMatch(
          /^---[\s\S]*---$/
        );
      }
      for (const heading of result.headings) {
        expect(slice(source, heading.range)).toContain(heading.text);
        expect(heading.body.start).toBeGreaterThanOrEqual(heading.range.end);
      }
      for (const block of result.blockIds) {
        expect(slice(source, block.marker)).toBe(`^${block.id}`);
        // An own-line id sits after the block it names, not inside it.
        if (block.marker.start < block.range.end) {
          expect(slice(source, block.range)).toContain(`^${block.id}`);
        } else {
          expect(source.slice(block.range.end, block.marker.start)).toMatch(
            /^\s+$/
          );
        }
      }
      for (const link of result.links) {
        const text = slice(source, link.range);
        if (link.syntax === "wikilink") expect(text).toMatch(/^!?\[\[.*\]\]$/);
        else expect(text).toMatch(/^!?\[.*\]\(.*\)$/);
      }
      for (const tag of result.tags) {
        const text = slice(source, tag.range);
        expect(
          tag.source === "inline" ? `#${tag.text}` : text.replace(/^#/, "")
        ).toBe(tag.source === "inline" ? text : tag.text);
      }
      for (const field of result.inlineFields) {
        expect(slice(source, field.range)).toMatch(
          new RegExp(`^${field.key}::`)
        );
        expect(slice(source, field.valueRange)).toBe(field.value);
      }
      for (const item of result.listItems) {
        expect(slice(source, item.range)).toMatch(/^([-*+]|\d+[.)])\s/);
      }
    });
  }
});

const canonical = (result: Outline) =>
  result.tags.map((tag) => (tag.valid ? tag.canonical : `invalid:${tag.text}`));

describe("README rows: frontmatter", () => {
  it("F1 — a two-entry list with a nested tag", () => {
    expect(canonical(of("props-list-tags.md"))).toEqual([
      "alpha",
      "ml/probing",
    ]);
  });

  it("F2b — `alpha, beta` yields alpha; beta is not counted, and is recorded as invalid here", () => {
    expect(canonical(of("props-comma-tags.md"))).toEqual([
      "alpha",
      "invalid: beta",
      "gamma",
    ]);
  });

  it("F3b — `tag:` is ignored", () => {
    const result = of("props-legacy-tag-key.md");
    expect(result.frontmatter?.parsed).toBe(true);
    expect(canonical(result)).toEqual([]);
  });

  it("F4b — key order is the file's", () => {
    const result = of("props-comment-and-order.md");
    if (!result.frontmatter?.parsed) throw new Error("unreadable");
    expect(Object.keys(result.frontmatter.document.toJS() as object)).toEqual([
      "zebra",
      "kind",
      "apple",
      "tags",
      "mango",
    ]);
    expect(canonical(result)).toEqual(["alpha", "beta/nested"]);
  });

  it("F5 — a wikilink in a text property is a string, not a link", () => {
    const result = of("props-link-value.md");
    if (!result.frontmatter?.parsed) throw new Error("unreadable");
    expect(result.frontmatter.document.get("related")).toBe(
      "[[Sleep and consolidation]]"
    );
    expect(result.links).toEqual([]);
  });

  it("F6 — property types as Obsidian writes them", () => {
    const result = of("props-types.md");
    if (!result.frontmatter?.parsed) throw new Error("unreadable");
    expect(result.frontmatter.document.toJS()).toEqual({
      title: "Types demo",
      aliases: ["td"],
      priority: 3,
      done: true,
      due: "1988-11-18",
      reviewed: "1988-11-18T12:34:00",
    });
  });

  it("F7 — a hashtag in a text property is not counted", () => {
    expect(canonical(of("props-hashtag-in-text-property.md"))).toEqual([]);
  });

  it("F8 — `[machine learning, other]` counts other only; the space entry is invalid here", () => {
    expect(canonical(of("props-tag-with-space.md"))).toEqual([
      "invalid:machine learning",
      "other",
    ]);
  });
});

describe("README rows: body tags", () => {
  it("T1a–d — the distinct tags of tags-valid.md, one for both casings, emoji counted", () => {
    const result = of("tags-valid.md");
    expect(new Set(canonical(result))).toEqual(
      new Set([
        "simple",
        "with-dash",
        "with_underscore",
        "nested/two/levels",
        "y1984",
        "émoji🙂",
        "ml/probing", // T1b: one entry, T1c: lowercase
      ])
    );
    expect(
      result.tags
        .filter((t) => t.valid && t.canonical === "ml/probing")
        .map((t) => t.text)
    ).toEqual(["ML/Probing", "ml/probing"]);
  });

  it("T2a–e — the invalid forms", () => {
    expect(canonical(of("tags-invalid.md"))).toEqual(["tag", "a//b"]);
  });

  it("T3a–k — excluded and included contexts", () => {
    expect(canonical(of("tags-excluded-contexts.md"))).toEqual([
      "control",
      "incomment",
    ]);
  });

  it("T4a–c — an unclosed backtick fence runs to the next backtick fence, ~~~ notwithstanding", () => {
    expect(canonical(of("fence-unclosed.md"))).toEqual(["afterfence"]);
  });

  it("T5, T5b — `a < b` and inline HTML are not excluded contexts", () => {
    expect(canonical(of("lt-before-tag.md"))).toEqual([
      "comparison",
      "insidehtml",
    ]);
  });
});

describe("README rows: links, as parsed", () => {
  it("L1a–l — every form in links-all-forms.md", () => {
    const result = of("links-all-forms.md");
    expect(
      result.links.map((l) => [
        l.target,
        l.heading,
        l.blockId,
        l.alias,
        l.embed,
      ])
    ).toEqual([
      ["Sleep and consolidation", [], null, null, false], // L1a
      ["Sleep and consolidation", [], null, "alias", false], // L1b
      ["Sleep and consolidation", ["Heading"], null, null, false], // L1c
      ["Sleep and consolidation", ["H1", "H2"], null, null, false], // L1d
      ["Sleep and consolidation", [], "blockid", null, false], // L1e
      ["", ["Own heading"], null, null, false], // L1f
      ["Sleep and consolidation", [], null, null, true], // L1g
      ["image.png", [], null, "200", true], // L1h
      ["Sleep and consolidation.md", [], null, "md link", false], // L1i
      ["Sleep and consolidation.md", ["Heading"], null, "md link", false], // L1j
      ["Sleep and consolidation", [], null, "shown", false], // L1k, L1l
      // the URL with %20 is external and not an internal link
    ]);
    expect(result.headings.map((h) => h.text)).toEqual(["Own heading"]);
  });

  it("L2a — a bare basename, for the index to find ambiguous", () => {
    expect(of("links-same-name.md").links.map((l) => l.target)).toEqual([
      "Klinzing 2019",
    ]);
  });

  it("L3 — the target keeps its casing; resolution is case-insensitive elsewhere", () => {
    expect(of("links-case.md").links.map((l) => l.target)).toEqual([
      "sleep AND consolidation",
    ]);
  });

  it("L4a–c — heading fragments are kept as written", () => {
    expect(of("links-heading-fragment.md").links.map((l) => l.heading)).toEqual(
      [["heading"], [" Heading "], ["HEADING"]]
    );
  });
});

describe("README rows: block ids", () => {
  it("B1a–e — where Obsidian places its generated ids", () => {
    const source = read("blocks-generated.md");
    const result = outline(source);
    expect(result.blockIds.map((b) => [b.id, slice(source, b.range)])).toEqual([
      ["6ea9c9", "A plain paragraph to link to. ^6ea9c9"], // B1a end-of-line
      ["aa75c2", "- list item two ^aa75c2"], // B1b end-of-line
      ["e4e371", "| col a | col b |\n| ----- | ----- |\n| 1     | 2     |"], // B1c own-line-after
      ["86acd3", "> [!note]\n> A callout to link to."], // B1d own-line-after
    ]);
    for (const block of result.blockIds)
      expect(block.id).toMatch(/^[0-9a-f]{6}$/); // B1e
  });

  it("B2 — ^c1 on a ### line names that heading", () => {
    const source = read("blocks-on-heading.md");
    const result = outline(source);
    expect(result.blockIds.map((b) => [b.id, slice(source, b.range)])).toEqual([
      ["c1", "### Criterion text ^c1"],
    ]);
    expect(result.headings[1]).toMatchObject({
      level: 3,
      text: "Criterion text",
      blockId: "c1",
    });
    expect(of("blocks-on-heading-link.md").links[0]).toMatchObject({
      target: "blocks-on-heading",
      blockId: "c1",
    });
  });

  it("B3a–c — hand-written ids are found like generated ones", () => {
    const source = read("blocks-handwritten.md");
    expect(
      outline(source).blockIds.map((b) => [b.id, slice(source, b.range)])
    ).toEqual([
      ["h12", "First paragraph. ^h12"],
      ["c3", "Second paragraph. ^c3"],
      ["my-own-id", "- a list item ^my-own-id"],
    ]);
    expect(of("blocks-generated-links.md").links.map((l) => l.blockId)).toEqual(
      ["6ea9c9", "aa75c2", "e4e371", "86acd3", "h12", "c3", "my-own-id"]
    );
  });
});

describe("README rows: file shape", () => {
  it("S1 — no frontmatter", () => {
    expect(of("shape-no-frontmatter.md").frontmatter).toBeNull();
  });

  it("S2 — frontmatter after a blank line is body", () => {
    const result = of("shape-frontmatter-not-at-top.md");
    expect(result.frontmatter).toBeNull();
    // As CommonMark reads the body: a thematic break, then `kind: note`
    // underlined by `---` is a setext heading.
    expect(result.headings.map((h) => [h.level, h.text])).toEqual([
      [2, "kind: note"],
    ]);
  });

  it("S3 — the file is LF after Obsidian's edit, with the literal \\n text intact", () => {
    const source = read("shape-crlf.md");
    expect(source).not.toContain("\r");
    expect(source).toContain("\\n");
    expect(outline(source).frontmatter).toBeNull();
  });

  it("S4a, S4b — the committed file has lost its BOM; with one restored it still reads", () => {
    const source = read("shape-bom.md");
    expect(source.startsWith("﻿")).toBe(false);
    for (const variant of [source, `﻿${source}`]) {
      const result = outline(variant);
      if (!result.frontmatter?.parsed) throw new Error("unreadable");
      expect(result.frontmatter.document.get("kind")).toBe("note");
    }
  });

  it("S5 — no trailing newline is no trouble", () => {
    const source = read("shape-no-trailing-newline.md");
    expect(source.endsWith("\n")).toBe(false);
    expect(outline(source).headings).toEqual([]);
  });
});
