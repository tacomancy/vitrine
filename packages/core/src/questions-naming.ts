import { resolvesTo } from "./link-text.js";
import type { VaultIndex } from "./vault-index.js";

/** A Question whose `from:` names a page, as that page's rail lists it. */
export type RelatedQuestion = {
  /** Vault-relative, as the index keys it. */
  path: string;
  question: string;
  status: string;
  context: string;
  captured: string;
};

/**
 * Every Question whose `from:` lands on `path`, newest captured first, as
 * the Inbox lists them. A page that is captured from — a Hypothesis (#339),
 * an Experiment (#373) — writes nothing onto itself, so this query over
 * the links is the whole of the edge: a Question retargeted in Obsidian
 * leaves the page as soon as the index sees it.
 */
export function questionsNaming(
  index: VaultIndex,
  path: string
): RelatedQuestion[] {
  // Only the Questions whose `from:` lands here are read whole: the page is
  // read on every capture, and the vault's Questions are the Inbox's
  // hundreds. A Question's `fields` rows are its reader's (`readQuestion`),
  // so each value has passed its vocabulary; a Partial Question has none
  // and is the Inbox's to report, not the page's.
  const naming = index
    .select<{ path: string; value: string }>(
      `SELECT path, value FROM fields WHERE key = 'from'
       AND path IN (SELECT path FROM files WHERE kind = 'question')`
    )
    .filter(
      ({ path: at, value }) =>
        resolvesTo(index, at, (JSON.parse(value) as string).trim()) === path
    );
  const questions: RelatedQuestion[] = naming.map(({ path: at }) => {
    const fields: Record<string, unknown> = {};
    for (const row of index.select<{ key: string; value: string }>(
      "SELECT key, value FROM fields WHERE path = ?",
      at
    )) {
      fields[row.key] = JSON.parse(row.value) as unknown;
    }
    return {
      path: at,
      question: String(fields["question"]),
      status: String(fields["status"]),
      context: String(fields["context"]),
      captured: String(fields["captured"]),
    };
  });
  questions.sort((a, b) => Date.parse(b.captured) - Date.parse(a.captured));
  return questions;
}
