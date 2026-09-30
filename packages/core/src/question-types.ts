// Types only, and no imports: Ingest names a Question, and Questions import
// the vault that imports Ingest.

/**
 * Where a Question came from (CONTEXT.md *Provenance*): Unattached;
 * captured on a Research Question's or a Hypothesis's page — `page` is that
 * page's vault-relative path, and the Question is a sub-question of it; or
 * the follow-up a Hypothesis's result raised (#339, CAP-5); or wondered
 * while observing a run — `experiment` is the Experiment's path (#373,
 * CAP-6).
 */
export type Provenance =
  | { context: "other" }
  | { context: "pursuing"; page: string }
  | { context: "resolving"; hypothesis: string }
  | { context: "observing"; experiment: string }
  | ReadingProvenance;

/**
 * Wondered while reading a Source (#427): its path and the 1-based page in
 * view. The annotation and its passage are present only when the Question
 * was made from a selection — that path is the core's own
 * (`sources.question`), never the window's, so the router's input omits them.
 */
export type ReadingProvenance = {
  context: "reading";
  source: string;
  page: number;
  annotation?: string;
  quote?: string;
};

/**
 * A `Q:` note read back by Ingest (#422): the Source's path, the 1-based
 * page, the annotation's block id, and the passage it marks. Kept apart from
 * `Provenance` because only Ingest makes one — the router's input and the
 * window's chords never carry it.
 */
export type IngestProvenance = {
  context: "ingest";
  source: string;
  page: number;
  annotation: string;
  quote: string;
};

export type Question = {
  id: string;
  path: string;
  question: string;
  status: "open";
  captured: string;
  /** The wikilink to what was open at capture; absent when Unattached. */
  from?: string;
  /** Sources only: the 1-based page and the annotation's block id. */
  page?: number;
  annotation?: string;
  /** The passage the annotation marks; written as the body, not a key. */
  quote?: string;
  context: (Provenance | IngestProvenance)["context"];
};
