import { normalise } from "./annotation-matcher.js";

/**
 * Whether two files are the same document (`docs/architecture.md` §
 * Annotation identity, *Document fingerprint*; ADR 0007 decision 9).
 *
 * The fingerprint is a page count and, per page, the set of words of four
 * letters or more. It is not a hash of the page text, because PDFKit's save
 * re-encodes the content and 7 of 8 page hashes changed across one: a hash
 * would have made every Preview save a document-changed event, and the
 * event exists so that a wholesale replacement is *one* decision instead of
 * fifty. Word-set similarity measured ≥ 0.95 on every page across a save
 * and ≤ 0.24 between neighbouring pages, which is what the threshold sits
 * between.
 */
export const SAME_DOCUMENT = 0.9;

export type Fingerprint = {
  /** Trailer /ID[0]. Equal means the same file; different means nothing (PDFKit replaces it on every save). */
  id: string;
  pages: number;
  /** Per page: sorted, unique. Absent on a sidecar written before the fingerprint had words. */
  page_words?: string[][];
};

/** The words of four letters or more on one page, normalised, sorted and unique. */
export function pageWords(text: string): string[] {
  const words = normalise(text).match(/\p{L}{4,}/gu) ?? [];
  return [...new Set(words)].sort();
}

const jaccard = (a: string[], b: string[]) => {
  // A page with no text on either side (a scan) has nothing to disagree about.
  if (a.length === 0 && b.length === 0) return 1;
  const seen = new Set(a);
  const shared = b.filter((w) => seen.has(w)).length;
  return shared / (a.length + b.length - shared);
};

export function sameDocument(before: Fingerprint, after: Fingerprint): boolean {
  if (before.id !== "" && before.id === after.id) return true;
  if (before.pages !== after.pages) return false;
  // Nothing to compare against: an older sidecar cannot show the document
  // changed, and calling every one changed would raise the event on files
  // that were only ever re-saved.
  if (before.page_words === undefined || after.page_words === undefined) {
    return true;
  }
  return before.page_words.every(
    (words, page) =>
      jaccard(words, after.page_words![page] ?? []) >= SAME_DOCUMENT
  );
}
