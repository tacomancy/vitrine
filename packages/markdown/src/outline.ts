import type { Nodes, Parents, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import {
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Document,
  type Node,
} from "yaml";

import { BOM, locateFrontmatter } from "./frontmatter.js";
import type { InvalidTag, Outline, Tag } from "./outline-types.js";
import { parseMarkdownLinkTarget } from "./link.js";
import type { Range } from "./range.js";
import { blockIds, blockIdsFromMarkdown } from "./syntax/block-ids.js";
import {
  inlineFields,
  inlineFieldsFromMarkdown,
} from "./syntax/inline-fields.js";
import { math } from "./syntax/math.js";
import { tags, tagsFromMarkdown } from "./syntax/tags.js";
import { wikilinks, wikilinksFromMarkdown } from "./syntax/wikilinks.js";
import { canonicalTag, parseTag } from "./tag.js";

/**
 * What Obsidian would understand about one file's text. Offsets are UTF-16
 * code units into `source` as handed in, BOM included: `source.slice(start,
 * end)` is every node's text. Line endings are left as they are.
 */
export function outline(source: string): Outline {
  const result: Outline = {
    frontmatter: null,
    headings: [],
    blockIds: [],
    links: [],
    tags: [],
    inlineFields: [],
    listItems: [],
  };

  let bodyStart = source.startsWith(BOM) ? BOM.length : 0;
  const fence = locateFrontmatter(source);
  if (fence) {
    const text = source.slice(fence.content.start, fence.content.end);
    const document = parseDocument(text);
    const error = document.errors[0];
    result.frontmatter = error
      ? { parsed: false, ...fence, reason: error.message }
      : { parsed: true, ...fence, document };
    if (!error)
      result.tags.push(...frontmatterTags(document, text, fence.content.start));
    bodyStart = fence.range.end;
  }

  // The frontmatter is cut off before micromark sees it: its `---` would be a
  // thematic break and a `#` in a text property would be a tag (F7).
  const body = source.slice(bodyStart);
  const tree = fromMarkdown(body, {
    extensions: [
      gfm(),
      math(),
      tags(),
      wikilinks(),
      blockIds(),
      inlineFields(),
    ],
    mdastExtensions: [
      gfmFromMarkdown(),
      tagsFromMarkdown(),
      wikilinksFromMarkdown(),
      blockIdsFromMarkdown(),
      inlineFieldsFromMarkdown(),
    ],
  });

  const rangeOf = (node: Nodes): Range => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) {
      throw new Error(`mdast ${node.type} node without offsets`);
    }
    return { start: start + bodyStart, end: end + bodyStart };
  };

  // Headings first: block ids on heading lines and the `###` an inline field
  // sits under both need them, and section bodies need the next heading.
  const headings = tree.children.filter((node) => node.type === "heading");
  headings.forEach((node, index) => {
    const range = rangeOf(node);
    const last = node.children[node.children.length - 1];
    const blockId = last?.type === "blockId" ? last : null;
    const first = node.children[0];
    const textEnd = blockId
      ? rangeOf(blockId).start
      : last
        ? rangeOf(last).end
        : range.start;
    const text = first
      ? source.slice(rangeOf(first).start, textEnd).trim()
      : "";
    const next = headings.slice(index + 1).find((h) => h.depth <= node.depth);
    result.headings.push({
      level: node.depth,
      text,
      range,
      body: {
        start: afterLineEnding(source, range.end),
        end: next ? rangeOf(next).start : source.length,
      },
      blockId: blockId?.id ?? null,
    });
  });

  const visit = (node: Nodes, ancestors: Parents[]): void => {
    switch (node.type) {
      case "tag": {
        const range = rangeOf(node);
        result.tags.push({
          valid: true,
          text: node.text,
          canonical: canonicalTag(node.text),
          source: "inline",
          range,
        });
        break;
      }
      case "wikilink":
        result.links.push({
          syntax: "wikilink",
          target: node.target,
          heading: node.heading,
          blockId: node.blockId,
          alias: node.alias,
          embed: node.embed,
          range: rangeOf(node),
        });
        break;
      case "link":
      case "image": {
        const parsed = parseMarkdownLinkTarget(node.url);
        if (parsed.external) break;
        const alias =
          node.type === "image"
            ? node.alt || null
            : node.children.length > 0
              ? source.slice(
                  rangeOf(node.children[0]!).start,
                  rangeOf(node.children[node.children.length - 1]!).end
                )
              : null;
        result.links.push({
          syntax: "markdown",
          target: parsed.target,
          heading: parsed.heading,
          blockId: parsed.blockId,
          alias,
          embed: node.type === "image",
          range: rangeOf(node),
        });
        break;
      }
      case "blockId": {
        const named = blockNamedBy(node, ancestors, body);
        if (named)
          result.blockIds.push({
            id: node.id,
            range: rangeOf(named),
            marker: rangeOf(node),
          });
        break;
      }
      case "inlineField": {
        const marker = rangeOf(node);
        const lineEnd = endOfLine(source, marker.end);
        const value = source.slice(marker.end, lineEnd).trimEnd();
        const start = marker.start;
        const under = result.headings.find(
          (h) => h.level === 3 && h.range.start <= start && start < h.body.end
        );
        result.inlineFields.push({
          key: node.key,
          value,
          range: { start, end: lineEnd },
          valueRange: { start: marker.end, end: marker.end + value.length },
          under: under?.blockId ?? null,
        });
        break;
      }
      case "listItem":
        result.listItems.push({ range: rangeOf(node) });
        break;
      default:
        break;
    }
    if ("children" in node) {
      for (const child of node.children) visit(child, [...ancestors, node]);
    }
  };
  visit(tree, []);

  return result;
}

/**
 * The block a `^id` names (B1a–d, B2, B3): its paragraph, or the list item or
 * callout the paragraph sits in; a heading when on the heading line; the
 * previous block when the id is alone on its own line. A `^id` that is not
 * at the end of its paragraph is not a block id, and one alone at the top of
 * a file names nothing.
 */
function blockNamedBy(
  node: RootContent,
  ancestors: Parents[],
  body: string
): Nodes | null {
  const parent = ancestors[ancestors.length - 1];
  if (!parent) return null;
  if (parent.type === "heading") return parent;
  if (parent.type !== "paragraph") return null;
  // At the end of its paragraph, trailing whitespace aside (the paragraph's
  // position keeps the spaces CommonMark strips).
  const nodeEnd = node.position?.end.offset ?? 0;
  const parentEnd = parent.position?.end.offset ?? 0;
  if (/\S/.test(body.slice(nodeEnd, parentEnd))) return null;
  const container = ancestors[ancestors.length - 2];
  if (container?.type === "listItem" || container?.type === "blockquote")
    return container;
  const alone = parent.children.length === 1;
  if (!alone) return parent;
  if (!container) return null;
  const siblings: Nodes[] = container.children;
  const index = siblings.indexOf(parent);
  return index > 0 ? (siblings[index - 1] ?? null) : null;
}

function afterLineEnding(source: string, offset: number): number {
  if (source.startsWith("\r\n", offset)) return offset + 2;
  if (source[offset] === "\n" || source[offset] === "\r") return offset + 1;
  return offset;
}

function endOfLine(source: string, offset: number): number {
  const match = /\r\n|\n|\r/g;
  match.lastIndex = offset;
  const found = match.exec(source);
  return found ? found.index : source.length;
}

/**
 * The `tags:` key as Obsidian reads it (F2, F3, F7, F8): only `tags`, never
 * `tag`; a list entry is split at commas and a piece with whitespace in it is
 * dropped by Obsidian — `- alpha, beta` counts `alpha` alone — so it is
 * recorded as invalid here; the legacy scalar `tags: a, b` splits at commas
 * and whitespace both. Ranges are into the file, not the YAML.
 */
function frontmatterTags(
  document: Document,
  yaml: string,
  base: number
): (Tag | InvalidTag)[] {
  if (!isMap(document.contents)) return [];
  const node: unknown = document.contents.get("tags", true);
  if (node === undefined || node === null) return [];
  const found: (Tag | InvalidTag)[] = [];
  const invalid = (text: string, reason: string, range: Range): void => {
    found.push({ valid: false, text, reason, source: "frontmatter", range });
  };
  const entry = (text: string, range: Range): void => {
    if (text.length === 0) return;
    const written = text.startsWith("#") ? text.slice(1) : text;
    const parsed = parseTag(written);
    if ("invalid" in parsed) invalid(written, parsed.invalid, range);
    else
      found.push({
        valid: true,
        text: written,
        canonical: parsed.canonical,
        source: "frontmatter",
        range,
      });
  };
  const pieces = (scalar: Node, separator: RegExp): void => {
    const raw = nodeRange(scalar, base);
    const rawText = yaml.slice(raw.start - base, raw.end - base);
    const value: unknown = isScalar(scalar) ? scalar.value : scalar;
    if (value === null || value === undefined) return;
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      // A collection's range runs to the next line; the text recorded does not.
      invalid(rawText.trim(), "not a string", raw);
      return;
    }
    let cursor = 0;
    for (const piece of String(value).split(separator)) {
      // Locate the piece inside the scalar's own source so a quoted or flow
      // entry still gets a range; fall back to the whole scalar.
      const at = rawText.indexOf(piece, cursor);
      const range =
        at >= 0 && piece.length > 0
          ? { start: raw.start + at, end: raw.start + at + piece.length }
          : raw;
      if (at >= 0) cursor = at + piece.length;
      entry(piece, range);
    }
  };
  if (isSeq(node)) {
    for (const item of node.items) pieces(item as Node, /,/);
  } else if (isScalar(node)) {
    pieces(node, /[,\s]+/);
  } else {
    const range = nodeRange(node as Node, base);
    invalid(
      yaml.slice(range.start - base, range.end - base).trim(),
      "not a list",
      range
    );
  }
  return found;
}

function nodeRange(node: Node, base: number): Range {
  const [start, end] = node.range ?? [0, 0];
  return { start: base + start, end: base + end };
}
