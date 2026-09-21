import { basename, join } from "node:path";
import type { ListedQuestion, Listing, Order } from "./question-kind.js";
import type { ShapeProblem } from "./vault-files.js";
import type { VaultIndex } from "./vault-index.js";

export type {
  ListedQuestion,
  Listing,
  Order,
  PartialQuestion,
  QuestionStatus,
} from "./question-kind.js";

/**
 * Every Question in the vault, wherever it sits (ADR 0006 decision 1), as a
 * query over the index (ADR 0014 decision 3): no file is read here. The
 * three problem channels come from the `problems` table the indexer filled
 * in the same transaction as each file's rows. Paths are absolute, as the
 * Inbox has always shown them; the index keys by vault-relative path.
 */
export function listQuestions(
  index: VaultIndex,
  vaultPath: string,
  order: Order
): Listing {
  const absolute = (path: string) => join(vaultPath, path);

  // Assembled key by key: `readQuestion` is the only writer of `fields`
  // rows for a Question, so every key here is one of `ListedQuestion`'s and
  // every value has already passed its vocabulary.
  const questions = new Map<string, ListedQuestion>();
  for (const row of index.select<{ path: string; key: string; value: string }>(
    "SELECT path, key, value FROM fields WHERE path IN (SELECT path FROM files WHERE kind = 'question') ORDER BY path"
  )) {
    const q =
      questions.get(row.path) ??
      ({ path: absolute(row.path) } as ListedQuestion);
    (q as Record<string, unknown>)[row.key] = JSON.parse(row.value) as unknown;
    questions.set(row.path, q);
  }

  const partial = index
    .select<{ path: string; mtime: number }>(
      "SELECT p.path, f.mtime FROM problems p JOIN files f USING (path) WHERE p.channel = 'partial'"
    )
    .map(({ path, mtime }) => ({
      path: absolute(path),
      name: basename(path, ".md"),
      mtime: new Date(mtime).toISOString(),
    }));

  const unreadable = index
    .select<{ path: string; problem: string }>(
      "SELECT path, problem FROM problems WHERE channel = 'unreadable' ORDER BY path"
    )
    .map(({ path, problem }) => ({ path: absolute(path), reason: problem }));

  const shape = index
    .select<{
      path: string;
      kind: string;
      problem: string;
      block: string | null;
    }>(
      "SELECT path, kind, problem, block FROM problems WHERE channel = 'shape' ORDER BY path"
    )
    .map(({ path, kind, problem, block }): ShapeProblem => ({
      path,
      kind,
      problem: problem as ShapeProblem["problem"],
      ...(block === null ? {} : { block }),
    }));

  const byTime = (a: string, b: string) =>
    (order === "newest" ? -1 : 1) * (Date.parse(a) - Date.parse(b));
  const listing: Listing = {
    questions: [...questions.values()].sort((a, b) =>
      byTime(a.captured, b.captured)
    ),
    partial: partial.sort((a, b) => byTime(a.mtime, b.mtime)),
    unreadable,
    shape,
  };
  return listing;
}
