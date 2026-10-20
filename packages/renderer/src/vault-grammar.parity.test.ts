import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { BOM, outline, parseInlineField, type Range } from "markdown";
import { itemsIn, vaultMarkdown } from "./vault-grammar";

// The editor's tags and links must be what the index counts (spec #680, *Parity
// of the two parsers*). Every Obsidian-written fixture is parsed both ways and
// the items compared at the same offsets, the CRLF one included. The core
// counts offsets into file bytes and the editor holds LF text, so the core's
// are carried across before they are compared.
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

/** The text the editor holds for these bytes: no BOM, every line break one `\n` (what CodeMirror counts). */
function editorText(source: string): string {
  return (source.startsWith(BOM) ? source.slice(1) : source).replace(
    /\r\n?/g,
    "\n"
  );
}

/** Where each byte offset of `source` lands in `editorText(source)`. */
function offsetMap(source: string): number[] {
  const map: number[] = [];
  let lost = source.startsWith(BOM) ? 1 : 0;
  for (let i = 0; i <= source.length; i++) {
    map.push(i - lost);
    if (source[i] === "\r" && source[i + 1] === "\n") lost++;
  }
  return map;
}

// Obsidian rewrote the corpus's one CRLF and one BOM fixture to LF (README S3,
// S4a), so those shapes are made here: every fixture is also read as the same
// file with CRLF line breaks, and with a BOM as well.
const variants: [string, (source: string) => string][] = [
  ["LF", (source) => source],
  ["CRLF", (source) => source.replace(/\n/g, "\r\n")],
  ["BOM + CRLF", (source) => BOM + source.replace(/\n/g, "\r\n")],
];

// The corpus holds no `key:: value` line, so these stand beside it: a field on
// a line of its own, mid-paragraph, in a list, in a heading and a callout (the
// last two are prose), with a block id after the value and a tag in it.
const extra: Record<string, string> = {
  "fields (synthetic)": [
    "### Criterion ^c1",
    "relationship:: supports",
    "outcome:: moved #ml/probing from [[Sleep]] ^c1",
    "",
    "Prose first",
    "key-2:: second line of a paragraph",
    "",
    "- item:: in a list",
    "",
    "## heading:: not a field",
    "",
    "> callout:: not a field",
    "",
    "a:b:: not a key",
    "",
  ].join("\n"),
};

const byStart = (a: Range, b: Range) => a.start - b.start;

describe("the editor's parsers find what the index counts", () => {
  const parser = vaultMarkdown().language.parser;

  const seen = { tags: 0, links: 0, blockIds: 0, inlineFields: 0 };

  const fixtures = [
    ...files(corpus).map(
      (path) => [relative(corpus, path), readFileSync(path, "utf8")] as const
    ),
    ...Object.entries(extra),
  ];

  for (const [shape, reshape] of variants)
    for (const [fixture, original] of fixtures) {
      const name = `${fixture} (${shape})`;
      const source = reshape(original);
      const text = editorText(source);
      const map = offsetMap(source);
      const at = (range: Range): Range => ({
        start: map[range.start]!,
        end: map[range.end]!,
      });

      it(`${name}: same tags, links, block ids and fields at the same offsets`, () => {
        const counted = outline(source);
        const found = itemsIn(parser.parse(text), text);
        seen.tags += found.tags.length;
        seen.links += found.links.length;
        seen.blockIds += found.blockIds.length;
        seen.inlineFields += found.inlineFields.length;

        expect(found.tags.sort(byStart)).toEqual(
          counted.tags
            .filter((tag) => tag.valid && tag.source === "inline")
            .map((tag) => at(tag.range))
            .sort(byStart)
        );
        expect(found.links.sort(byStart)).toEqual(
          counted.links.map((link) => at(link.range)).sort(byStart)
        );
        expect(found.blockIds.sort(byStart)).toEqual(
          counted.blockIds.map((id) => at(id.marker)).sort(byStart)
        );
        expect(
          found.inlineFields.map((f) => f.start).sort((a, b) => a - b)
        ).toEqual(
          counted.inlineFields
            .map((f) => at(f.range).start)
            .sort((a, b) => a - b)
        );
        for (const field of found.inlineFields) {
          const line = text.slice(field.start).split("\n", 1)[0]!;
          expect(parseInlineField(line)?.key).toBe(field.key);
        }
      });
    }

  // A comparison of two empty lists passes; the corpus has to give it all four.
  it("compared something of every kind", () => {
    expect(seen.tags).toBeGreaterThan(0);
    expect(seen.links).toBeGreaterThan(0);
    expect(seen.blockIds).toBeGreaterThan(0);
    expect(seen.inlineFields).toBeGreaterThan(0);
  });
});
