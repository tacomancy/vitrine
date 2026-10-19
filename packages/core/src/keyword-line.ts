/**
 * The keyword line printed under a paper's abstract (ADR 0018 decision 3;
 * `docs/architecture.md` § Lexicon). Ingest records what this returns in the
 * Source's sidecar, raw, and the Lexicon's phrase normaliser does every
 * judgement about length and wording — so this makes none about relevance.
 */

/** The printed line sits under the abstract; the second page covers long abstracts and two-column layouts without reaching the references. */
const PAGES_SEARCHED = 2;

/** A hostile page with a label and no end must not become a megabyte sidecar. */
const MAX_LIST_CHARS = 1_000;

// At the start of a line only: "the keywords: a, b" mid-sentence is prose.
// A plain hyphen needs a space before it, or "Keyword-based methods" is a label.
const LABEL =
  /^\s*(?:author\s+)?key\s*words?(?:\s*[:：–—]|\s+-)|^\s*index\s+terms\s*[:：\-–—]/i;

// A heading ends the list: "1 Introduction", "2.1 Method", "I. INTRODUCTION",
// or the bare word. A keyword that merely starts with a digit ("3D mapping")
// has no space after it, so it is not caught.
const HEADING = /^\s*(?:(?:\d+(?:\.\d+)*\.?|[IVX]+\.)\s+\S|introduction\b)/i;

const SEPARATORS = /[,;·•∙⋅●▪|]/;

/** The raw keywords the first pages print, or an empty list when they print none. */
export function printedKeywords(pages: readonly string[]): string[] {
  try {
    for (const text of pages.slice(0, PAGES_SEARCHED)) {
      if (typeof text !== "string") continue;
      const found = fromPage(text);
      if (found !== null) return found;
    }
  } catch {
    // Total by contract: a page that cannot be read contributes nothing and
    // never costs the Ingest it rode in on.
  }
  return [];
}

function fromPage(text: string): string[] | null {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => LABEL.test(line));
  if (at < 0) return null;

  let joined = lines[at]!.replace(LABEL, "");
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === "" || HEADING.test(line)) break;
    if (joined.length > MAX_LIST_CHARS) break;
    // A hyphen at a line end is a word broken for the margin, not a hyphen
    // in the word — PDFium drops it the same way in the page's own text.
    joined = /\w-$/.test(joined.trimEnd())
      ? joined.trimEnd().slice(0, -1) + line.trimStart()
      : `${joined} ${line.trim()}`;
  }

  return joined
    .slice(0, MAX_LIST_CHARS)
    .split(SEPARATORS)
    .map((item) => item.replace(/\s+/g, " ").replace(/\.$/, "").trim())
    .filter((item) => item !== "");
}
