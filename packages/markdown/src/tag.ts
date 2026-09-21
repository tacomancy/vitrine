// Obsidian's tag grammar, help.obsidian.md/tags plus the corpus rows in
// docs/architecture.md § Markdown. Shared by the micromark tokenizer (which
// sees UTF-16 code units) and the frontmatter reader (which sees strings), so
// the character rule is written once, on code units.

/**
 * May this UTF-16 code unit appear in a tag? Letters, digits, `_`, `-`, `/`,
 * and any other non-whitespace character that is not ASCII punctuation or
 * general Unicode punctuation (U+2000–U+206F, U+2E00–U+2E7F) — which is how
 * emoji and non-Latin scripts get in and `.`, `,`, `)` end a tag.
 */
export function isTagCharacter(code: number): boolean {
  if (code <= 0x20 || code === 0x7f) return false;
  if (code < 0x80) return !ASCII_PUNCTUATION_OUTSIDE_TAGS.has(code);
  if (code === 0xa0 || code === 0x2028 || code === 0x2029) return false; // whitespace
  if (code >= 0x2000 && code <= 0x206f) return false;
  if (code >= 0x2e00 && code <= 0x2e7f) return false;
  return true;
}

const ASCII_PUNCTUATION_OUTSIDE_TAGS: ReadonlySet<number> = new Set(
  [..."'!\"#$%&()*+,.:;<=>?@^`{|}~[]\\"].map((c) => c.charCodeAt(0))
);

/** How far a tag starting at `from` runs: the index of its first non-tag character. */
export function tagEnd(text: string, from: number): number {
  let i = from;
  while (i < text.length && isTagCharacter(text.charCodeAt(i))) i++;
  return i;
}

/** NFC, then lowercased, trailing slashes dropped: `#ML/Probing` and `#ml/probing` are one tag (T1b). */
export function canonicalTag(text: string): string {
  return stripTrailingSlashes(text.normalize("NFC")).toLowerCase();
}

function stripTrailingSlashes(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === SLASH) end--;
  return text.slice(0, end);
}

const SLASH = "/".charCodeAt(0);

export type ParsedTag = { canonical: string } | { invalid: string };

/**
 * Is `text` (a tag as written, without its `#`) something Obsidian would count?
 * `tag/` is the tag `tag` (T2b); `a//b` keeps its empty segment (T2c); a run
 * of digits alone is not a tag (T2a); whitespace anywhere is not (F8).
 */
export function parseTag(text: string): ParsedTag {
  if (text.length === 0) return { invalid: "empty" };
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isTagCharacter(code)) continue;
    if (/\s/.test(text[i]!)) return { invalid: "contains whitespace" };
    return { invalid: `contains '${text[i]!}'` };
  }
  const stripped = stripTrailingSlashes(text);
  if (/^[0-9]*$/.test(stripped)) return { invalid: "only digits" };
  return { canonical: canonicalTag(text) };
}
