import type { Range } from "./range.js";

export interface FrontmatterLocation {
  /** From the opening `---` through the closing `---`, without the line ending after it. */
  range: Range;
  /** The YAML between the fences: after the opening fence line, up to the closing fence line. */
  content: Range;
}

export const BOM = "﻿";

// A fence line is `---` alone, trailing whitespace allowed, ending at a line
// ending or at the end of the file.
const OPENING_FENCE = /^---[ \t]*(?:\r\n|\n|\r|$)/;
const CLOSING_FENCE = /^---[ \t]*(?=\r\n|\n|\r|$)/gm;

/**
 * Obsidian's fence rule: `---` at offset 0 — after a BOM if there is one
 * (S4a) — closed by a line that is `---`. A blank line before it is body
 * (S2); no closing fence is no frontmatter. Locates only; `yaml` parses.
 */
export function locateFrontmatter(source: string): FrontmatterLocation | null {
  const start = source.startsWith(BOM) ? BOM.length : 0;
  const opening = OPENING_FENCE.exec(source.slice(start));
  if (!opening) return null;
  const contentStart = start + opening[0].length;
  // Searching from the content start keeps the opening fence from closing itself.
  CLOSING_FENCE.lastIndex = contentStart;
  const closing = CLOSING_FENCE.exec(source);
  if (!closing) return null;
  return {
    range: { start, end: closing.index + closing[0].length },
    content: { start: contentStart, end: closing.index },
  };
}
