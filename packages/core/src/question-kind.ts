import type { ShapeProblem } from "./vault-files.js";

export type QuestionStatus = "open" | "promoted" | "answered" | "abandoned";

/**
 * A Question as the Inbox lists it: frontmatter fields, nothing from the
 * body. Wider than the `Question` a capture writes (`questions.ts`), because
 * a file another tool wrote may lack an id and may carry any status.
 */
export type ListedQuestion = Omit<QuestionFields, "promotedTo"> & {
  path: string;
  /**
   * On a promoted Question: the `promoted_to` link as written, and the
   * page it resolves to (vault-relative) — null when the index finds no
   * such file, so the row can say it points at nothing rather than link
   * into the void.
   */
  promotedTo?: { link: string; path: string | null };
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
