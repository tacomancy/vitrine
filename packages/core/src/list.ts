import { basename, join } from "node:path";
import { parseWikilink } from "markdown";
import type {
  ListedQuestion,
  Listing,
  Order,
  QuestionFields,
} from "./question-kind.js";
import type { LoopResult } from "./hypothesis-rule.js";
import type { answeredBy } from "./question-kind.js";
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

  // Assembled key by key: `readQuestion` and `answeredBy` are the only
  // writers of `fields` rows for a Question, so every key here is one of
  // theirs and every value has already passed its vocabulary.
  type Stored = QuestionFields & { answeredBy?: ReturnType<typeof answeredBy> };
  const fields = new Map<string, Stored>();
  for (const row of index.select<{ path: string; key: string; value: string }>(
    "SELECT path, key, value FROM fields WHERE path IN (SELECT path FROM files WHERE kind = 'question') ORDER BY path"
  )) {
    const q = fields.get(row.path) ?? ({} as Stored);
    (q as Record<string, unknown>)[row.key] = JSON.parse(row.value) as unknown;
    fields.set(row.path, q);
  }
  // Where `promoted_to` lands is the index's to say, by the same rule every
  // `links` row is resolved by — never a guess from the link's text.
  const questions = [...fields].map(
    ([path, { promotedTo, answeredBy: by, ...rest }]): ListedQuestion => {
      const result = resultOf(path, rest.status, by);
      return {
        ...rest,
        path: absolute(path),
        ...(promotedTo === undefined
          ? {}
          : { promotedTo: { link: promotedTo, ...pageOf(path, promotedTo) } }),
        ...(result === null ? {} : { answeredWith: result }),
      };
    }
  );
  // A closed loop's result (#338), shown only while the Question is
  // answered — a reopened or dropped one no longer is, whatever its lead
  // still says — and only when the line's link lands on a Hypothesis, so
  // a line typed by hand in the same words about a note is not a result.
  function resultOf(
    path: string,
    status: QuestionFields["status"],
    by: Stored["answeredBy"]
  ): LoopResult | null {
    if (status !== "answered" || by == null || by.result === null) {
      return null;
    }
    return pageOf(path, by.link).kind === "hypothesis" ? by.result : null;
  }
  // The page's Kind comes with it: a Question promoted to a Hypothesis
  // points at a different surface than one promoted to a Research Question.
  function pageOf(
    path: string,
    link: string
  ): { path: string | null; kind: string | null; display: string | null } {
    const nowhere = { path: null, kind: null, display: null };
    const inner = /^\[\[(.*)\]\]$/.exec(link)?.[1];
    if (inner === undefined) return nowhere;
    const { resolvedPath } = index.resolve(path, parseWikilink(inner));
    if (resolvedPath === null) return nowhere;
    const [file] = index.select<{ kind: string | null; display: string }>(
      "SELECT kind, display FROM files WHERE path = ?",
      resolvedPath
    );
    return {
      path: resolvedPath,
      kind: file?.kind ?? null,
      display: file?.display ?? null,
    };
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
    questions: questions.sort((a, b) => byTime(a.captured, b.captured)),
    partial: partial.sort((a, b) => byTime(a.mtime, b.mtime)),
    unreadable,
    shape,
  };
  return listing;
}
