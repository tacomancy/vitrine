import { basename } from "node:path";

/**
 * The Display name (`CONTEXT.md`): the one string a file is named by on
 * screen, as opposed to the name it is stored under. The Global command
 * matches this, because a word legible on a row must always find it
 * (ADR 0027 decision 5).
 *
 * The two names diverge in the middle and not only at the tail: a file
 * name drops the characters Obsidian forbids and is cut at 80 characters
 * (`questions.ts` `fileName`), and a promoted Research Question keeps the
 * file name of the Question it came from, which may say something else
 * entirely. Written by the indexer, per file, so a keystroke matches a
 * column on `files` rather than scanning `fields`.
 */

/**
 * The frontmatter key each Kind's Display name is written in. Absent from
 * this table and the next — a Note, anything the app has yet to meet —
 * means the file name is the name, which is what a Note's is.
 */
const NAMED_BY: Record<string, string> = {
  question: "question",
  "research-question": "question",
  source: "title",
  "source-stub": "title",
};

/**
 * The Position each Kind's Display name is read from, for a Kind whose
 * name is something the user revises in the body. A Hypothesis is named by
 * its current claim (spec #327 story 78) and never by a frontmatter copy
 * of it: a copy is a second place the claim lives, and the file itself is
 * named once, from the claim as typed, so wikilinks to it survive every
 * narrowing (story 13).
 */
const NAMED_BY_POSITION: Record<string, string> = {
  hypothesis: "claim",
};

/**
 * What this file is called on screen. The stored name is the fallback,
 * never nothing: a Question whose `question:` is missing is Partial, and
 * the Inbox is where that is reported — here it is still a file with an
 * Address, and a row it can be reached by beats a silent omission.
 */
export function displayName(
  path: string,
  kind: string | null,
  frontmatter: Record<string, unknown>,
  positions: readonly { field: string; text: string }[] = []
): string {
  const key = kind === null ? undefined : NAMED_BY[kind];
  const declared = key === undefined ? undefined : frontmatter[key];
  if (typeof declared === "string" && declared.trim() !== "") {
    return declared.trim();
  }
  const field = kind === null ? undefined : NAMED_BY_POSITION[kind];
  const position = positions.find((p) => p.field === field)?.text;
  // A claim is a paragraph, and one Obsidian wrapped across lines is still
  // one line on a row.
  const written = position?.replace(/\s+/g, " ").trim();
  if (written !== undefined && written !== "") return written;
  return basename(path, ".md");
}

/**
 * The form a Display name and a query are compared in: lower case, words
 * separated by one space, nothing else. Both sides pass through it, so
 * typing the colon a Question's text carries finds the row whose file
 * name had to drop it.
 *
 * A run of punctuation becomes a space rather than nothing, so *slow-wave
 * density* is found by typing either half of the word as well as the whole
 * of it — a word legible on a row must always find it (ADR 0027 decision
 * 5), and a hyphen is not a word boundary the reader can see. An
 * apostrophe is the exception and goes, because *sleep's role* is one word
 * to anyone typing it. Letters and digits of every script survive:
 * dropping the ones outside ASCII would lose a name to the punctuation
 * rule for having an umlaut in it.
 *
 * Stored as `files.ldisplay`, which is therefore a lookup key and not
 * merely the lowercased name, as `links.ltarget` is.
 */
export const matchKey = (text: string): string =>
  text
    .toLowerCase()
    .replace(/['\u2019]+/gu, "")
    // Whitespace is outside the class too, so this collapses runs as well.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
