import type { Document } from "yaml";

import type { Range } from "./range.js";

/**
 * What the locator returns for one file: ranges and structure, never a tree
 * to print back (ADR 0008 decision 1). Nothing Vitrine-specific — which
 * sections are owned or what `^c<n>` means is the core's business.
 */
export interface Outline {
  /** Null when the file has none by the fence rule (`locateFrontmatter`). */
  frontmatter: Frontmatter | null;
  /** Top-level headings in document order; one inside a list or callout is not a section. */
  headings: Heading[];
  /** Every `^id`, app-written or not, with the block it names. */
  blockIds: BlockId[];
  /** Internal links only — wikilinks, embeds, and Markdown links without a scheme — as written. */
  links: Link[];
  /** Frontmatter `tags:` entries first, then inline `#tags` in document order. */
  tags: (Tag | InvalidTag)[];
  /** `key:: value` lines, with the `###` block id they sit under. */
  inlineFields: InlineField[];
  /** Every list item at any depth, in document order. */
  listItems: ListItem[];
}

export type Frontmatter = ParsedFrontmatter | UnparsableFrontmatter;

export interface ParsedFrontmatter {
  parsed: true;
  /** From the opening `---` through the closing `---`. */
  range: Range;
  /** The YAML between the fences. */
  content: Range;
  document: Document;
}

/** The fence rule found a block but `yaml` could not read it; the rest of the outline stands. */
export interface UnparsableFrontmatter {
  parsed: false;
  range: Range;
  content: Range;
  reason: string;
}

export interface Heading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** The heading's source text, markers and a trailing `^id` removed, trimmed. */
  text: string;
  /** The heading line. */
  range: Range;
  /** After the heading line, up to the next heading of equal or higher level or the end of the file. */
  body: Range;
  /** A `^id` on the heading line (B2). */
  blockId: string | null;
}

export interface BlockId {
  id: string;
  /** The block the id names: a paragraph, list item, callout, table, or heading line. */
  range: Range;
  /** The `^id` text itself. */
  marker: Range;
}

export interface Link {
  syntax: "wikilink" | "markdown";
  /** As written, decoded for a Markdown link; `""` for a link into the same file. */
  target: string;
  /** `[[note#H1#H2]]` → `["H1", "H2"]`, kept as written. */
  heading: string[];
  blockId: string | null;
  /** The alias of a wikilink, the text of a Markdown link, the alt of an image. */
  alias: string | null;
  embed: boolean;
  range: Range;
}

export type TagSource = "frontmatter" | "inline";

export interface Tag {
  valid: true;
  /** As written, without a leading `#`. */
  text: string;
  /** `canonicalTag(text)`: the identity the index counts by. */
  canonical: string;
  source: TagSource;
  range: Range;
}

/** A `tags:` entry Obsidian would drop — recorded, not ignored (ADR 0008 decision 8). */
export interface InvalidTag {
  valid: false;
  text: string;
  reason: string;
  source: TagSource;
  range: Range;
}

export interface InlineField {
  key: string;
  /** The value as written, trailing whitespace dropped. */
  value: string;
  /** The whole `key:: value` line, without its line ending. */
  range: Range;
  /** The value only: what `setInlineField` replaces. */
  valueRange: Range;
  /** The block id of the `###` heading whose section holds the field, if it has one. */
  under: string | null;
}

export interface ListItem {
  range: Range;
}
