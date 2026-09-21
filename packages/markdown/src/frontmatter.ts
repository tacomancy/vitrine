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

function openingFence(
  source: string
): { start: number; contentStart: number } | null {
  const start = source.startsWith(BOM) ? BOM.length : 0;
  const opening = OPENING_FENCE.exec(source.slice(start));
  return opening ? { start, contentStart: start + opening[0].length } : null;
}

/**
 * Whether the text opens a frontmatter block, by the same rule as
 * `locateFrontmatter`: for a reader holding only the head of a file, which
 * has to know whether a closing fence is worth waiting for.
 */
export function opensFrontmatter(source: string): boolean {
  return openingFence(source) !== null;
}

/**
 * Obsidian's fence rule: `---` at offset 0 — after a BOM if there is one
 * (S4a) — closed by a line that is `---`. A blank line before it is body
 * (S2); no closing fence is no frontmatter. Locates only; `yaml` parses.
 */
export function locateFrontmatter(source: string): FrontmatterLocation | null {
  const opening = openingFence(source);
  if (!opening) return null;
  const { start, contentStart } = opening;
  // Searching from the content start keeps the opening fence from closing itself.
  CLOSING_FENCE.lastIndex = contentStart;
  const closing = CLOSING_FENCE.exec(source);
  if (!closing) return null;
  return {
    range: { start, end: closing.index + closing[0].length },
    content: { start: contentStart, end: closing.index },
  };
}
