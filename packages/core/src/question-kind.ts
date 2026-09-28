import { readFile } from "node:fs/promises";
import { errorMessage, errorMessageWithoutPath, VaultError } from "./errors.js";
import { RESULT_TAIL, type LoopResult } from "./hypothesis-rule.js";
import {
  analyseFile,
  locate,
  sha256,
  type FileOutline,
  type ShapeProblem,
} from "./vault-files.js";

export type QuestionStatus = "open" | "promoted" | "answered" | "abandoned";

/**
 * A Question as the Inbox lists it: frontmatter fields, nothing from the
 * body. Wider than the `Question` a capture writes (`questions.ts`), because
 * a file another tool wrote may lack an id and may carry any status.
 */
export type ListedQuestion = Omit<QuestionFields, "promotedTo"> & {
  path: string;
  /**
   * The result of the Hypothesis loop closed onto this Question, when its
   * newest write-back line is one (`answeredBy`), so an answered row can
   * say *answered — falsified*.
   */
  answeredWith?: LoopResult;
  /**
   * On a promoted Question: the `promoted_to` link as written, and the
   * page it resolves to (vault-relative) — null when the index finds no
   * such file, so the row can say it points at nothing rather than link
   * into the void — and that file's Kind, which says which surface it
   * opens on.
   */
  promotedTo?: { link: string; path: string | null; kind: string | null };
};

/** A `kind: question` file missing what a row needs; shown by name and mtime. */
export type PartialQuestion = { path: string; name: string; mtime: string };

export type Listing = {
  questions: ListedQuestion[];
  partial: PartialQuestion[];
  unreadable: Array<{ path: string; reason: string }>;
  /**
   * Files short of their Kind's structure, as `vault.outline` reports them.
   * Every read procedure carries the same three channels.
   */
  shape: ShapeProblem[];
};

export type Order = "newest" | "oldest";

const STATUSES: readonly QuestionStatus[] = [
  "open",
  "promoted",
  "answered",
  "abandoned",
];

/** The value when it is a string; a Kind reader's "present and readable" test. */
export const asString = (v: unknown) => (typeof v === "string" ? v : undefined);

/** The frontmatter keys the app reads on a Question: what the index stores per row. */
export type QuestionFields = {
  /** Absent on a file another tool wrote without one; the path identifies it. */
  id?: string;
  question: string;
  status: QuestionStatus;
  captured: string;
  context: string;
  from?: string;
  page?: number;
  annotation?: string;
  /** The `promoted_to` wikilink as the file holds it. */
  promotedTo?: string;
};

/**
 * The Question a frontmatter block describes (ADR 0009); null when
 * `question` or `captured` is missing (the file is Partial). A key that is
 * present but holds a value the vocabulary cannot read is a fault to
 * report, not a gap: the throw's message is the unreadable reason.
 */
export function readQuestion(
  fm: Record<string, unknown>
): QuestionFields | null {
  const question = asString(fm["question"]);
  const captured = asString(fm["captured"]);
  if (question === undefined || captured === undefined) return null;
  if (Number.isNaN(Date.parse(captured))) {
    throw new Error(`captured is not a date: ${captured}`);
  }
  // A Question that was never triaged is open, so a file with no status is.
  const status = fm["status"] === undefined ? "open" : fm["status"];
  if (!STATUSES.includes(status as QuestionStatus)) {
    throw new Error(
      `status is not open, promoted, answered, or abandoned: ${JSON.stringify(status)}`
    );
  }
  const q: QuestionFields = {
    question,
    status: status as QuestionStatus,
    captured,
    // No context recorded means nothing was open: time and place are the
    // whole Provenance, which is what `other` says.
    context: asString(fm["context"]) ?? "other",
  };
  const id = asString(fm["id"]);
  if (id !== undefined) q.id = id;
  const from = asString(fm["from"]);
  if (from !== undefined) q.from = from;
  if (typeof fm["page"] === "number") q.page = fm["page"];
  const annotation = asString(fm["annotation"]);
  if (annotation !== undefined) q.annotation = annotation;
  const promotedTo = asString(fm["promoted_to"]);
  if (promotedTo !== undefined) q.promotedTo = promotedTo;
  return q;
}

/**
 * A Question's *lead* — the body between its frontmatter and its first
 * `##` — as offsets into its BOM-less text: where every write-back line
 * lands (`appendToSection`'s `lead` target) and so where each reader of
 * one looks for it.
 */
export function leadRange(
  outline: Pick<FileOutline, "headings" | "frontmatter">,
  length: number
): { start: number; end: number } {
  return {
    start: outline.frontmatter?.range.end ?? 0,
    end: outline.headings.find((h) => h.level === 2)?.range.start ?? length,
  };
}

/**
 * The newest write-back line in the lead — `Answered by [[x]] — …` — as
 * the link it names and the result it carries, or null when there is
 * none (#338; ADR 0031 decision 8). Indexed beside the frontmatter keys so
 * the Inbox can say what a closed loop answered without reading a file
 * (ADR 0014 decision 3); the listing resolves `link` and shows the result
 * only when it lands on a Hypothesis. The newest is the last, since a
 * write-back only ever appends — and a newer line with no result word, a
 * resolved Research Question's, is the answer now, so it reads as none
 * rather than letting an older Hypothesis result show through.
 */
export function answeredBy(
  content: string,
  outline: Pick<FileOutline, "headings" | "frontmatter">
): { link: string; result: LoopResult | null } | null {
  // The outline's offsets are into the text without a BOM.
  const text = content.replace(/^﻿/, "");
  const { start, end } = leadRange(outline, text.length);
  let newest: { link: string; result: LoopResult | null } | null = null;
  for (const line of text.slice(start, end).split(/\r?\n/)) {
    const link = /^Answered by (\[\[[^\]]+\]\])/.exec(line);
    if (link === null) continue;
    const tail = RESULT_TAIL.exec(line.slice(link[0].length));
    newest = {
      link: link[1]!,
      result: tail === null ? null : (tail[1] as LoopResult),
    };
  }
  return newest;
}

/** A Question read from disk for a write: what every triage action needs of it. */
export type QuestionFile = {
  /** Vault-relative, as the index keys it. */
  path: string;
  /** SHA-256 of the bytes read: what the write is `basedOn`. */
  hash: string;
  /** The frontmatter as the file holds it, for a caller that copies keys. */
  frontmatter: Record<string, unknown>;
  /** The outline of those same bytes, so a range and its text never disagree. */
  outline: FileOutline;
  question: QuestionFields;
};

/**
 * Why the read could not open the file, in the app's own words (#285, the
 * same argument as #277). Every caller shows this message to the user — the
 * page prints it as *the Question was not marked: …*, the Inbox alerts it
 * under the row — and the message names the file already, so Node's errno
 * would only repeat the path and then add the machine's filesystem layout.
 *
 * ENOENT is one fact here and the whole of it: the Inbox listed the row, or
 * the page resolved its link, and the file is gone by the time the write
 * reads it. The write protocol one step later refuses that same absence
 * with *the file is no longer there* (`vault-files.write`), so the read
 * says it the same way. Deliberately not the page's *missing from the
 * vault* (#277): a page reached by a stale link and a row whose file went
 * out from under it are different absences. Every other failure is the case
 * where the cause genuinely helps, so it keeps one.
 */
const whyUnreadable = (cause: unknown): string =>
  cause instanceof Error && (cause as NodeJS.ErrnoException).code === "ENOENT"
    ? "the file is no longer there"
    : errorMessageWithoutPath(cause);

/**
 * The Question a triage key names, or the refusal the row shows. Every way
 * a triage action can be turned away is decided here — the file is not
 * readable, it is not a Question, its Status does not allow the action —
 * so promote, answer, drop and reopen say the same things for the same
 * reasons (§ Research Question view and triage). The Statuses each action
 * allows are that section's; the caller names them.
 */
export async function readQuestionForWrite(
  vaultPath: string,
  path: string,
  allowed: readonly QuestionStatus[]
): Promise<QuestionFile> {
  const { absolute, relativePath } = await locate(vaultPath, path);
  const bytes = await readFile(absolute).catch((cause: unknown) => {
    throw new VaultError(
      "unreadable",
      `Couldn't read ${relativePath}: ${whyUnreadable(cause)}`
    );
  });
  const read = analyseFile(relativePath, bytes.toString("utf8"), sha256(bytes));
  if (!read.readable) {
    throw new VaultError("unreadable", `${relativePath}: ${read.reason}`);
  }
  const frontmatter = (read.outline.frontmatter?.value ?? {}) as Record<
    string,
    unknown
  >;
  let question: QuestionFields | null;
  try {
    question = read.kind === "question" ? readQuestion(frontmatter) : null;
  } catch (cause) {
    // A key present but unreadable is a fault to report, not a gap: the
    // file says it is a Question and the app cannot act on it.
    throw new VaultError(
      "unreadable",
      `${relativePath}: ${errorMessage(cause)}`
    );
  }
  if (question === null) {
    throw new VaultError("refused", `${relativePath} is not a Question.`);
  }
  if (!allowed.includes(question.status)) {
    throw new VaultError(
      "refused",
      `${relativePath} is ${question.status}, not ${allowed.join(" or ")}.`
    );
  }
  return {
    path: relativePath,
    hash: read.hash,
    frontmatter,
    outline: read.outline,
    question,
  };
}
