import { basename } from "node:path";
import type { Heading, Outline } from "markdown";
import { errorMessage, VaultError } from "./errors.js";
import { fileName } from "./file-name.js";
import { resolvesTo } from "./link-text.js";
import {
  changedUnderneath,
  historyEntries,
  historyOperations,
  notExactlyOne,
  savePosition,
  unchanged,
  writeOwn,
  type PageContext,
  type PageKind,
  type SavedAnswer,
} from "./page-write.js";
import { asString, leadRange, readQuestionForWrite } from "./question-kind.js";
import {
  copiedKeys,
  dateOf,
  markPromoted,
  orTakeBack,
  PAGE as RESEARCH_QUESTION,
  quoted,
  readResearchQuestion,
  resolvePromotedFrom,
  writeToQuestion,
} from "./research-question.js";
import { localIso } from "./time.js";
import {
  bodyText,
  linkLine,
  readPageFile,
  revisionsOf,
  section,
  type LinkLine,
  type PageFile,
} from "./page-file.js";
import {
  formatRevision,
  onOneLine,
  topLevelItems,
  type Revision,
} from "./position-history.js";
import {
  AFTER_EVIDENCE,
  closeRefusal,
  CRITERIA_FIELD,
  criterionField,
  derive,
  labelOf,
  LETTER,
  liveOverride,
  nameOf,
  OVERRIDE,
  overrideRefusal,
  RESULT_TAIL,
  resultOf,
  type Derivation,
  type LoopResult,
} from "./hypothesis-rule.js";
import {
  createFile,
  nextCriterionId,
  type Criterion,
  type Operation,
  type Outcome,
  type Relationship,
  type ShapeProblem,
  type WriteResult,
} from "./vault-files.js";
import type { Position, ReadableOutline, VaultIndex } from "./vault-index.js";

/**
 * The Hypothesis Kind (`docs/architecture.md` § Vault layout (Hypothesis),
 * § Hypothesis view; ADR 0031; `CONTEXT.md` § Testing): how the page is read
 * from a `kind: hypothesis` file, and the one function the testing half of
 * the app rests on — the Derived state, computed from the criteria and never
 * stored.
 */

export const KIND = "hypothesis";

/** What this Kind's writes expect the file to be (`page-write.ts`). */
export const PAGE: PageKind = { kind: KIND, noun: "a Hypothesis" };

/** The four headings, in the order promotion writes them. */
export const SECTIONS = [
  "Claim",
  "Criteria",
  "Design notes",
  "Position history",
] as const;

/**
 * The page's frontmatter. Nothing is required: a Hypothesis written by hand
 * in Obsidian may carry `kind:` and nothing else, and is still a page
 * (spec #327 story 20). A Provenance key the file lacks is a gap, not a fault.
 */
export type HypothesisFrontmatter = {
  id?: string;
  promotedFrom?: string;
  promoted?: string;
  captured?: string;
  context: string;
  from?: string;
  page?: number;
  annotation?: string;
  tags: string[];
};

/** One `### <text> ^c<n>` under `## Criteria`, as the page draws it. */
export type CriterionRead = {
  /** `c3`: the block id, whose number is the Criterion's identity (ADR 0031 decision 3). */
  id: string;
  /** `F1`, `C2`, `D5`: never written, drawn from the Relationship and the id. Null with no Relationship. */
  label: string | null;
  text: string;
  relationship: Relationship | null;
  /** Null is *awaiting evidence* — no Outcome recorded (ADR 0031 decision 2). */
  outcome: Outcome | null;
  /**
   * An `outcome::` the vocabulary cannot read, verbatim — `mett`. It counts
   * as no Outcome for the rule, but the criterion must not look untouched:
   * someone did record something (spec #327 story 34).
   */
  outcomeUnreadable: string | null;
  /** The `- [[run]] — what it shows` lines under the criterion, each whether or not its link resolves (decision 10). */
  evidence: LinkLine[];
  /**
   * Every time the criterion's text or Relationship changed while Evidence
   * sat under it, newest first — read from the history, so the mark lasts
   * as long as the entry does (TEST-5; ADR 0031 decision 4).
   */
  editedAfterEvidence: AfterEvidenceMark[];
};

/**
 * One *edited after evidence* entry as the criterion shows it: when, the
 * why if one was written, and what the criterion said before — so the page
 * cannot be read as though it had always said this.
 */
export type AfterEvidenceMark = {
  at: string;
  why: string | null;
  was: { text: string; relationship: Relationship | null };
};

export type HypothesisSections = {
  claim: { present: boolean; text: string };
  criteria: { present: boolean; criteria: CriterionRead[] };
  designNotes: { present: boolean; text: string };
  positionHistory: { present: boolean; text: string; entries: Revision[] };
};

export type HypothesisPage =
  | {
      readable: true;
      /** Vault-relative, as the index keys it. */
      path: string;
      /** SHA-256 of the bytes read: what the page's later writes are `basedOn`. */
      hash: string;
      frontmatter: HypothesisFrontmatter;
      sections: HypothesisSections;
      /** The derived state, and the effective one a live Override makes of it. */
      derivation: Derivation;
      /** Whether an Override can be made now (`overrideRefusal`): the page offers its line only then. */
      overridable: boolean;
      /** Where the result would be written, and whether it has been — read from that object, never from this one. */
      loop: Loop;
      /** The related rail: a query, never a section the page keeps (ADR 0031 decision 11). */
      related: Related;
      /** What could not be shown: the file's shape problems, then a section missing or doubled, then history lines that are not entries. */
      problems: ShapeProblem[];
    }
  | { readable: false; path: string; reason: string };

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

/** The page's frontmatter from the file's; lenient throughout, as a Question's reader is (ADR 0009). */
export function readHypothesis(
  fm: Record<string, unknown>
): HypothesisFrontmatter {
  const out: HypothesisFrontmatter = {
    // No context recorded means nothing was open, as on a Question.
    context: asString(fm["context"]) ?? "other",
    tags: stringList(fm["tags"]),
  };
  const id = asString(fm["id"]);
  if (id !== undefined) out.id = id;
  const promotedFrom = asString(fm["promoted_from"]);
  if (promotedFrom !== undefined) out.promotedFrom = promotedFrom;
  const promoted = asString(fm["promoted"]);
  if (promoted !== undefined) out.promoted = promoted;
  const captured = asString(fm["captured"]);
  if (captured !== undefined) out.captured = captured;
  const from = asString(fm["from"]);
  if (from !== undefined) out.from = from;
  if (typeof fm["page"] === "number") out.page = fm["page"];
  const annotation = asString(fm["annotation"]);
  if (annotation !== undefined) out.annotation = annotation;
  return out;
}

/**
 * The page as the file holds it (spec #327 § The page's read contract, the
 * part this beat's first ticket needs). Like the Research Question's, the
 * body is read from disk and outlined from those same bytes; the index
 * supplies only where each Evidence link lands.
 */
export async function readHypothesisPage(
  index: VaultIndex,
  vaultPath: string,
  path: string
): Promise<HypothesisPage> {
  const read = await readPageFile(vaultPath, path, [PAGE.kind], PAGE.noun);
  if (!read.readable) return read;
  const { relativePath, content, outline } = read;
  const frontmatter = readHypothesis(
    (outline.frontmatter?.value ?? {}) as Record<string, unknown>
  );

  const problems: ShapeProblem[] = [...read.shape];
  const found = {} as Record<(typeof SECTIONS)[number], Heading | undefined>;
  for (const name of SECTIONS) {
    const { heading, count } = section(outline, name);
    found[name] = heading;
    // A missing `## Criteria` is the file's shape problem already
    // (`criteriaMissing`), and a duplicated owned section too.
    if (count === 0 && name !== "Criteria") {
      problems.push({
        path: relativePath,
        kind: KIND,
        problem: "sectionMissing",
        block: name,
      });
    } else if (count > 1 && name !== "Position history") {
      problems.push({
        path: relativePath,
        kind: KIND,
        problem: "sectionDuplicated",
        block: name,
      });
    }
  }

  const history = revisionsOf(
    relativePath,
    KIND,
    content,
    outline,
    found["Position history"]
  );

  // The criteria reader (`vault-files.ts`) has already decided which `###`
  // is a criterion and read its fields; what it leaves out — the heading's
  // range for the Evidence under it, and the verbatim value of an Outcome
  // it could not read — is taken from the same outline.
  const criteriaSection = found["Criteria"];
  const criteria: CriterionRead[] = read.criteria.map((criterion) => {
    const heading = outline.headings.find(
      (h) =>
        h.level === 3 &&
        h.blockId === criterion.id &&
        criteriaSection !== undefined &&
        h.range.start >= criteriaSection.body.start &&
        h.range.end <= criteriaSection.body.end
    );
    const rawOutcome =
      criterion.outcome === null
        ? outline.inlineFields.find(
            (f) =>
              f.under === criterion.id &&
              f.key === "outcome" &&
              heading !== undefined &&
              f.range.start >= heading.body.start &&
              f.range.end <= heading.body.end
          )?.value
        : undefined;
    return {
      id: criterion.id,
      label: labelOf(criterion),
      text: criterion.text,
      relationship: criterion.relationship,
      outcome: criterion.outcome,
      outcomeUnreadable: rawOutcome ?? null,
      evidence:
        heading === undefined
          ? []
          : topLevelItems(outline, heading).map((item) =>
              linkLine(index, relativePath, outline, content, item)
            ),
      editedAfterEvidence: marksOf(criterion.id, history.entries),
    };
  });

  problems.push(...history.problems);
  const derivation = derive(read.criteria, liveOverride(history.entries));
  const loop = await loopOf(
    index,
    vaultPath,
    relativePath,
    frontmatter.promotedFrom,
    derivation
  );

  return {
    readable: true,
    path: relativePath,
    hash: read.hash,
    frontmatter,
    sections: {
      claim: {
        present: found["Claim"] !== undefined,
        text: bodyText(content, found["Claim"]),
      },
      criteria: { present: criteriaSection !== undefined, criteria },
      designNotes: {
        present: found["Design notes"] !== undefined,
        text: bodyText(content, found["Design notes"]),
      },
      positionHistory: {
        present: found["Position history"] !== undefined,
        text: bodyText(content, found["Position history"]),
        entries: history.entries,
      },
    },
    derivation,
    overridable: overrideRefusal(derivation) === null,
    loop,
    related: relatedOf(index, relativePath, frontmatter.promotedFrom),
    problems,
  };
}

/**
 * The Hypothesis's neighbours (#339; spec #327 story 18): the object it was
 * promoted from, and every Question whose `from:` names it — the follow-up
 * its result raised (`resolving`) and the sub-questions captured on the page
 * (`pursuing`). Derived from the links alone, so there is no
 * related-questions section to keep, and a Question retargeted in Obsidian
 * leaves the rail as soon as the index sees it.
 */
export type Related = {
  /** Null when promoted from nothing; `path` null when the link lands nowhere, which is shown rather than dropped. */
  promotedFrom: {
    link: string;
    path: string | null;
    kind: string | null;
    display: string | null;
  } | null;
  /** Newest captured first, as the Inbox lists them. */
  questions: RelatedQuestion[];
};

export type RelatedQuestion = {
  /** Vault-relative, as the index keys it. */
  path: string;
  question: string;
  status: string;
  context: string;
  captured: string;
};

function relatedOf(
  index: VaultIndex,
  path: string,
  promotedFrom: string | undefined
): Related {
  let parent: Related["promotedFrom"] = null;
  if (promotedFrom !== undefined) {
    const landed = resolvesTo(index, path, promotedFrom.trim());
    const [file] =
      landed === null
        ? []
        : index.select<{ kind: string | null; display: string | null }>(
            "SELECT kind, display FROM files WHERE path = ?",
            landed
          );
    parent = {
      link: promotedFrom,
      path: landed,
      kind: file?.kind ?? null,
      display: file?.display ?? null,
    };
  }

  // A Question's `fields` rows are its reader's (`readQuestion`), so each
  // value has passed its vocabulary; a Partial Question has none and is
  // the Inbox's to report, not the rail's.
  const byPath = new Map<string, Record<string, unknown>>();
  for (const row of index.select<{ path: string; key: string; value: string }>(
    `SELECT path, key, value FROM fields
     WHERE path IN (SELECT path FROM files WHERE kind = 'question')`
  )) {
    const fields = byPath.get(row.path) ?? {};
    fields[row.key] = JSON.parse(row.value) as unknown;
    byPath.set(row.path, fields);
  }
  const questions: RelatedQuestion[] = [];
  for (const [at, fields] of byPath) {
    const from = fields["from"];
    if (
      typeof from !== "string" ||
      resolvesTo(index, at, from.trim()) !== path
    ) {
      continue;
    }
    questions.push({
      path: at,
      question: String(fields["question"]),
      status: String(fields["status"]),
      context: String(fields["context"]),
      captured: String(fields["captured"]),
    });
  }
  questions.sort((a, b) => Date.parse(b.captured) - Date.parse(a.captured));
  return { promotedFrom: parent, questions };
}

// `criterion C2 · edited after evidence`, or `criterion ^c2 · …` for one
// that had no Relationship: the digit is the id, whatever the letter was.
const MARKED_FIELD = new RegExp(
  `^criterion (?:[CFD]|\\^c)(\\d+)${AFTER_EVIDENCE}$`
);

/**
 * The criterion's *edited after evidence* entries, matched by the id's
 * number rather than the label, because a Relationship change — making it
 * diagnostic, the way out of the rule — moves the letter the entry named
 * (ADR 0031 decision 3). The previous wording is the `### ` line of the
 * block the entry records as `from:`; an entry written by hand whose
 * `from:` has no heading shows its first line rather than nothing.
 */
function marksOf(id: string, entries: Revision[]): AfterEvidenceMark[] {
  const number = id.slice(1);
  return entries.flatMap(({ at, why, field, from }) => {
    if (MARKED_FIELD.exec(field)?.[1] !== number) return [];
    const firstLine = from.split("\n")[0] ?? "";
    const heading = /^###\s+(.*?)(?:\s+\^c\d+)?\s*$/.exec(firstLine);
    const related = /^relationship::\s*(.*?)\s*$/m.exec(from)?.[1];
    return [
      {
        at,
        why,
        was: {
          text: heading?.[1] ?? firstLine.trim(),
          relationship:
            related !== undefined && related in LETTER
              ? (related as Relationship)
              : null,
        },
      },
    ];
  });
}

/**
 * The two Positions that are also Edited sections (ADR 0020 decision 4;
 * spec #327 stories 16–17): each field's Revisions name it, and each lives
 * under its own heading. The criteria are Positions too, but are written
 * through their own operations (#334), never saved whole as typing.
 */
export const FIELDS = {
  claim: "Claim",
  "design notes": "Design notes",
} as const;
export type EditedField = keyof typeof FIELDS;

/**
 * The Kind's Positions, for the index's `positions` diff (#217): the claim,
 * the design notes, and `## Criteria` whole. A section whose heading was
 * retyped reports nothing rather than an empty text that would read as
 * "cleared" when the heading comes back, as the Research Question's does.
 *
 * The criteria are one Position here, not one per criterion, because the
 * diff is generic and counts only a field the file held before and still
 * holds: keyed per criterion, a criterion deleted in Obsidian — the loudest
 * edit there is — would be a field gone and so no change at all, and a
 * Relationship changed there would move the label the field was keyed by.
 * The section's previous text is what the splice judges the edit against,
 * criterion by criterion, and turns into the entries the page's own writes
 * would have made (`criteriaEntries`, #336). The history still names each
 * criterion by its label; this key never reaches it.
 */
export function hypothesisPositions(
  { outline }: ReadableOutline,
  content: string
): Position[] {
  const positions: Position[] = [];
  const claim = section(outline, FIELDS.claim).heading;
  if (claim !== undefined) {
    positions.push({ field: "claim", text: bodyText(content, claim) });
  }
  const notes = section(outline, FIELDS["design notes"]).heading;
  if (notes !== undefined) {
    positions.push({ field: "design notes", text: bodyText(content, notes) });
  }
  const criteria = section(outline, "Criteria").heading;
  if (criteria !== undefined) {
    positions.push({
      field: CRITERIA_FIELD,
      text: bodyText(content, criteria),
    });
  }
  return positions;
}

/** One criterion where the file holds it: its `###` and its Position — the whole block, heading to the next heading. */
type CriterionBlock = { criterion: Criterion; heading: Heading; text: string };

/**
 * The criteria reader's list, each matched to its `###` under `## Criteria`
 * in file order — so an id written twice yields two blocks rather than the
 * first one twice, and a write naming that id can see it is not one.
 */
function criterionBlocks(
  outline: Pick<Outline, "headings">,
  criteria: readonly Criterion[],
  content: string
): CriterionBlock[] {
  const within = section(outline, "Criteria").heading;
  if (within === undefined) return [];
  const taken = new Set<Heading>();
  const blocks: CriterionBlock[] = [];
  for (const criterion of criteria) {
    const heading = outline.headings.find(
      (h) =>
        h.level === 3 &&
        h.blockId === criterion.id &&
        !taken.has(h) &&
        h.range.start >= within.body.start &&
        h.range.end <= within.body.end
    );
    if (heading === undefined) continue;
    taken.add(heading);
    blocks.push({
      criterion,
      heading,
      text: content.slice(heading.range.start, heading.body.end).trim(),
    });
  }
  return blocks;
}

/**
 * The claim or the design notes saved, with the Revision it records, by
 * the same write the Working answer's save makes (`savePosition`): one
 * queue, one coalescing rule keyed by field, and whatever an Obsidian edit
 * left parked folded in. An empty claim is refused rather than saved —
 * promotion never writes a Hypothesis without one (spec #327 story 5), and
 * clearing the field is not a way to un-claim what the page is testing.
 * Empty design notes are a save: the paragraph is optional.
 */
export async function saveHypothesisPosition(
  ctx: PageContext,
  path: string,
  input: {
    field: EditedField;
    text: string;
    basedOn: string;
    was: string;
    at: Date;
    coalesceMs: number;
  }
): Promise<SavedAnswer> {
  if (input.field === "claim" && input.text.trim() === "") {
    throw new VaultError(
      "refused",
      "The claim is empty; a Hypothesis is never without one."
    );
  }
  return savePosition(ctx, path, PAGE, {
    ...input,
    section: FIELDS[input.field],
    // The claim is what an Override judged; design notes are how the test
    // is run, and tidying them never undoes the call (spec #327 story 61).
    judged: input.field === "claim",
  });
}

/** What every criterion write carries besides its own input: the page's view of the file, and the clock. */
type CriterionWriteInput = { basedOn: string; at: Date; coalesceMs: number };

/**
 * What a criterion write changes, as its plan decides it against the file
 * as read: the operations on `## Criteria`, the Revision they record — the
 * field names the criterion by its label *as it stood*, which is what an
 * entry records (ADR 0031 decision 3) — and the criteria as they will
 * read afterwards, so the Derived state can be compared before and after
 * without re-reading the file the write has not yet made.
 */
type CriterionChange = {
  operations: Operation[];
  field: string;
  from: string;
  after: Criterion[];
};

/**
 * One criterion write through the page's own-write queue (`writeOwn`), so
 * it meets a Revision parked by an Obsidian edit in one write as a claim
 * save does. Load-bearing (`CLAUDE.md` § Code standard, derived Hypothesis
 * state): every change to a criterion is a Revision (ADR 0031 decision 4),
 * and when the Derived state before and after the change differ, the same
 * operation list records a `· state` entry — `from:` the state it left —
 * because the state is never stored and *when the rule began returning a
 * different answer* is a fact no later recomputation can recover (decision
 * 6). It is stamped with the criterion Revision's own timestamp and sits
 * directly above it: that pairing is what attributes the move to the
 * criterion that caused it (spec #327 story 45), and sitting above means a
 * later edit to the same criterion cannot coalesce past the move and
 * re-stamp the entry out of its pair.
 */
async function writeCriterion(
  ctx: PageContext,
  path: string,
  { basedOn, at, coalesceMs }: CriterionWriteInput,
  plan: (
    read: PageFile,
    blocks: CriterionBlock[]
  ) => CriterionChange | WriteResult
): Promise<SavedAnswer> {
  const recorded: { at: string | null } = { at: null };
  const result = await writeOwn(ctx, path, PAGE, (read, waiting) => {
    const change = plan(
      read,
      criterionBlocks(read.outline, read.criteria, read.content)
    );
    if ("written" in change) return change;
    const history = historyOperations(
      read.content,
      read.outline,
      { field: change.field, from: change.from, at },
      // A parked Obsidian edit closes the window, as it does for a claim
      // save (`savePosition` says why). So does an edit after evidence: the
      // criteria are "versioned more loudly than anything else" (brief §
      // The falsification commitment), and folding a second rewording into
      // the first would lose the wording between them.
      waiting.length > 0 || change.field.endsWith(AFTER_EVIDENCE)
        ? 0
        : coalesceMs
    );
    recorded.at = history.at;
    const before = derive(read.criteria).state;
    const after = derive(change.after).state;
    const moved: Operation[] =
      before === after
        ? []
        : [
            {
              op: "prependEntry",
              section: "Position history",
              entry: formatRevision({
                at: history.at,
                field: "state",
                why: null,
                from: before,
              }),
            },
          ];
    return {
      operations: [...change.operations, ...history.operations, ...moved],
      basedOn,
      // Every criterion Revision — an Outcome, a Relationship, a
      // rewording, one added or deleted — voids a live Override (ADR 0031
      // decision 7): the call was made on the criteria as they stood.
      revisesJudged: history.at,
    };
  });
  return result.written
    ? { ...result, revision: recorded.at }
    : { ...result, revision: null };
}

/**
 * The one block a write names by its id, or the refusal: an id the file no
 * longer carries, or carries twice, where which was meant would be a guess
 * written to disk.
 */
function theOne(
  blocks: CriterionBlock[],
  id: string
): CriterionBlock | WriteResult {
  const found = blocks.filter((b) => b.criterion.id === id);
  const [only] = found;
  if (found.length !== 1 || only === undefined) {
    return notExactlyOne(found.length, {
      none: `no criterion carries ^${id}`,
      several: `${found.length} criteria carry ^${id}`,
    });
  }
  return only;
}

/** Whether any line sits under the criterion's heading: Evidence, read as found (ADR 0031 decision 10). */
const tested = (read: PageFile, heading: Heading) =>
  topLevelItems(read.outline, heading).length > 0;

/**
 * The field a criterion Revision is written under. Load-bearing (TEST-5;
 * ADR 0031 decision 4; `CLAUDE.md` § Code standard): runs are cheap, and
 * the risk the brief names is running two hundred and then rewording the
 * criterion to fit whichever result looks best. So a change to what the
 * criterion *says* — its text, or its Relationship, which is what it means
 * for the claim — made while Evidence was under it when the file was read
 * carries ` · edited after evidence`, and that entry is never collapsed and
 * never expires. Recording an Outcome is what Evidence is for, so it is
 * never marked (story 49). A marked entry never coalesces (`writeCriterion`),
 * so each rewording keeps the wording it replaced; and since the suffix is
 * part of the field, an Outcome recorded minutes later opens its own entry
 * rather than absorbing the mark.
 */
function revisionField(
  read: PageFile,
  { criterion, heading }: CriterionBlock,
  movesTheBar: boolean
): string {
  const field = criterionField(criterion);
  return movesTheBar && tested(read, heading) ? field + AFTER_EVIDENCE : field;
}

/** A criterion's text as it is written: one line, since it is a heading, and never empty. */
function criterionText(typed: string): string {
  const text = onOneLine(typed);
  if (text === "") {
    throw new VaultError(
      "refused",
      "The criterion is empty; write what would show the claim true or false."
    );
  }
  return text;
}

/**
 * `## Criteria` with one criterion's block rewritten or removed, every
 * other byte of it — the other criteria, a line of prose above them —
 * spliced back as it was. The operation set has no "edit one block"
 * (ADR 0008 decision 2), so rewording and deleting replace the section
 * whole, naming the criterion by its id rather than its place.
 */
function criteriaWith(
  read: PageFile,
  range: { start: number; end: number },
  replacement: string
): Operation {
  const within = section(read.outline, "Criteria").heading!;
  const { content } = read;
  return {
    op: "replaceSection",
    name: "Criteria",
    body: (
      content.slice(within.body.start, range.start) +
      replacement +
      content.slice(range.end, within.body.end)
    ).trim(),
  };
}

/**
 * A criterion added from the page (spec #327 story 21, TEST-1): the heading,
 * then its Relationship — required, with no default, because choosing what
 * the criterion means for the claim is part of writing it. Appended to
 * `## Criteria`; the page's falsifying band is layout, not file order. The
 * id is one past the highest the file or its history has ever named
 * (`nextCriterionId`), and its first Revision's `from:` is empty: there was
 * no criterion before.
 */
export async function addCriterion(
  ctx: PageContext,
  path: string,
  input: CriterionWriteInput & { text: string; relationship: Relationship }
): Promise<SavedAnswer & { id: string | null }> {
  const text = criterionText(input.text);
  const added: { id: string | null } = { id: null };
  const result = await writeCriterion(ctx, path, input, (read) => {
    const id = nextCriterionId(read.outline, read.content);
    added.id = id;
    const criterion: Criterion = {
      id,
      text,
      relationship: input.relationship,
      outcome: null,
    };
    return {
      operations: [
        {
          op: "appendToSection",
          target: { section: "Criteria" },
          line: `### ${text} ^${id}\n\nrelationship:: ${input.relationship}`,
        },
      ],
      field: criterionField(criterion),
      from: "",
      after: [...read.criteria, criterion],
    };
  });
  return { ...result, id: result.written ? added.id : null };
}

/**
 * An Outcome recorded, or a Relationship changed, on one criterion (spec
 * #327 stories 26, 30): `setInlineField`, which replaces the value alone —
 * or adds the line, which is how a first Outcome is written. Changing the
 * Relationship moves the label's letter and never its number. A value the
 * criterion already holds is not a change and records nothing.
 */
export async function setCriterionField(
  ctx: PageContext,
  path: string,
  input: CriterionWriteInput & { id: string } & (
      | { field: "outcome"; value: Outcome }
      | { field: "relationship"; value: Relationship }
    )
): Promise<SavedAnswer> {
  return writeCriterion(ctx, path, input, (read, blocks) => {
    const block = theOne(blocks, input.id);
    if ("written" in block) return block;
    const { criterion } = block;
    if (criterion[input.field] === input.value) return unchanged(read);
    const changed: Criterion = { ...criterion, [input.field]: input.value };
    return {
      operations: [
        // Two arms that differ only by the literal, so each narrows the
        // value to its own field's vocabulary.
        input.field === "outcome"
          ? {
              op: "setInlineField",
              blockId: input.id,
              field: "outcome",
              value: input.value,
            }
          : {
              op: "setInlineField",
              blockId: input.id,
              field: "relationship",
              value: input.value,
            },
      ],
      field: revisionField(read, block, input.field === "relationship"),
      from: block.text,
      after: read.criteria.map((c) => (c === criterion ? changed : c)),
    };
  });
}

/**
 * A criterion reworded on the page (spec #327 story 29): its heading line
 * rewritten with the same id, the rest of `## Criteria` as it was. The page
 * sends the text it was editing (`was`), because the section is replaced
 * whole and a criterion reworded in Obsidian since the page read it would
 * otherwise be overwritten with nothing said (`changedUnderneath`).
 */
export async function editCriterion(
  ctx: PageContext,
  path: string,
  input: CriterionWriteInput & { id: string; text: string; was: string }
): Promise<SavedAnswer> {
  const text = criterionText(input.text);
  return writeCriterion(ctx, path, input, (read, blocks) => {
    const block = theOne(blocks, input.id);
    if ("written" in block) return block;
    const { criterion, heading } = block;
    if (criterion.text === text) return unchanged(read);
    const conflict = changedUnderneath(criterion.text, input.was);
    if (conflict !== null) return conflict;
    return {
      operations: [
        criteriaWith(read, heading.range, `### ${text} ^${criterion.id}`),
      ],
      field: revisionField(read, block, true),
      from: block.text,
      after: read.criteria.map((c) => (c === criterion ? { ...c, text } : c)),
    };
  });
}

/**
 * A criterion deleted (spec #327 story 31) — only while nothing tests it.
 * Before Evidence exists a criterion is a draft; once a run is named under
 * it, taking it out of the rule is making it diagnostic, which keeps it on
 * the page where a reader will see it (ADR 0031 decision 5). Its number is
 * never reused: the Revision this write records names it, and
 * `nextCriterionId` reads the history.
 */
export async function deleteCriterion(
  ctx: PageContext,
  path: string,
  input: CriterionWriteInput & { id: string }
): Promise<SavedAnswer> {
  return writeCriterion(ctx, path, input, (read, blocks) => {
    const block = theOne(blocks, input.id);
    if ("written" in block) return block;
    const { criterion, heading } = block;
    // A refusal of the act, not a disk conflict: `changedAndUnreapplyable`
    // is what a page reads as *changed on disk*, which this is not.
    if (tested(read, heading)) {
      throw new VaultError(
        "refused",
        `${nameOf(criterion)} has evidence under it; a tested criterion leaves the rule by becoming diagnostic, not by being deleted`
      );
    }
    return {
      operations: [
        criteriaWith(
          read,
          { start: heading.range.start, end: heading.body.end },
          ""
        ),
      ],
      field: criterionField(criterion),
      from: block.text,
      after: read.criteria.filter((c) => c !== criterion),
    };
  });
}

/**
 * An inconclusive Hypothesis called supported on partial evidence (spec
 * #327 stories 56–59, 63; TEST-6; ADR 0031 decision 7). Not a state set:
 * an entry in the history, `· override` with its why and `from:
 * inconclusive`, beside the derived state it contradicts, which the page
 * goes on printing. Refused without a why, and wherever `overrideRefusal`
 * refuses — judged inside the queue, against the file as re-read. There is
 * no way to override to *falsified*: concluding "no" goes through a
 * falsifying criterion's Outcome, where it is recorded like any other.
 */
export async function overrideState(
  ctx: PageContext,
  path: string,
  input: { why: string; basedOn: string; at: Date }
): Promise<SavedAnswer> {
  const why = onOneLine(input.why);
  if (why === "") {
    throw new VaultError(
      "refused",
      "An override needs a why: it lands in the history and stays there."
    );
  }
  const at = localIso(input.at);
  const result = await writeOwn(ctx, path, PAGE, (read) => {
    const refusal = overrideRefusal(
      derive(read.criteria, liveOverride(historyEntries(read)))
    );
    if (refusal !== null) throw new VaultError("refused", refusal);
    return {
      operations: [
        {
          op: "prependEntry",
          section: "Position history",
          entry: formatRevision({
            at,
            field: OVERRIDE,
            why,
            from: "inconclusive",
          }),
        },
      ],
      basedOn: input.basedOn,
    };
  });
  return result.written
    ? { ...result, revision: at }
    : { ...result, revision: null };
}

/** Where promotion writes a Hypothesis (§ Vault layout). */
const FOLDER = "hypotheses";

/**
 * The page promotion creates, whole (§ Vault layout (Hypothesis)): the
 * page's own keys, the Question's Provenance and tags copied — not
 * re-derived, so the Hypothesis still reads as something wondered on a
 * particular day (PROM-5) — and the four headings, all written now so the
 * page's later writes always find their section. The claim's first
 * Revision has an empty `from:`: before promotion there was no claim, and
 * the history says so rather than leaving its base to be inferred. Pure,
 * so the file can be read off a table of cases.
 */
export function composeHypothesis(
  question: Record<string, unknown>,
  tags: string[],
  page: { id: string; promotedFrom: string; promoted: string; claim: string }
): string {
  return [
    "---",
    `id: ${page.id}`,
    `kind: ${KIND}`,
    `promoted_from: ${quoted(page.promotedFrom)}`,
    `promoted: ${page.promoted}`,
    ...copiedKeys(question, tags),
    "---",
    "",
    "## Claim",
    "",
    page.claim,
    "",
    "## Criteria",
    "",
    "## Design notes",
    "",
    "## Position history",
    "",
    formatRevision({ at: page.promoted, field: "claim", why: null, from: "" }),
    "",
  ].join("\n");
}

/**
 * Promote an open Question to a Hypothesis (#331; ADR 0031 decision 9): the
 * page written first and whole, named from the claim as typed, then the
 * Question marked — or the page taken back (`markPromoted`). A name already
 * taken refuses rather than taking ` (2)`: the claim is the name, and two
 * Hypotheses claiming the same thing is something to decide, not to file.
 * The caller serialises this with every other write that picks a name.
 */
export async function promoteToHypothesis(
  vaultPath: string,
  index: VaultIndex,
  path: string,
  typed: string,
  /** The timestamp for `promoted:`, formatted by the caller's clock, and the id source. */
  { promoted, newId }: { promoted: string; newId: () => string }
): Promise<{ path: string }> {
  const claim = claimOf(typed);
  const {
    path: questionPath,
    hash,
    frontmatter: fm,
    outline,
  } = await readQuestionForWrite(vaultPath, path, ["open"]);

  const created = await createHypothesis(vaultPath, fm, outline, {
    promotedFrom: questionPath,
    promoted,
    claim,
    id: newId(),
  });
  const marked = await markPromoted(
    vaultPath,
    questionPath,
    hash,
    created.path
  );
  await index.own(created.path, created.content);
  await index.own(questionPath, marked);
  return { path: created.path };
}

/**
 * Sharpen an open Research Question into a Hypothesis from its page (#332;
 * brief § Hypothesis vs Research Question: the expected route). The same
 * page a Question's promotion writes, `promoted_from` naming the Research
 * Question, then one line under its `## Related questions` —
 * `- [[hypothesis]] — sharpened into a hypothesis, <date>` — and nothing
 * else: the Research Question stays open, because reading goes on beside
 * the test (spec #327 story 8). When that line cannot be written the
 * Hypothesis is taken back, as a Question's promotion takes it back: a
 * Hypothesis nothing points at is a stray the user never asked for.
 *
 * The line goes through the page's own write queue, so an Obsidian edit
 * still owed the page's history is spliced in the same write. The caller
 * serialises this with every other write that picks a name — the Question
 * service's queue — since the Hypothesis's name is picked in `hypotheses/`
 * as a Question's promotion picks it.
 */
export async function promoteResearchQuestionToHypothesis(
  ctx: PageContext,
  path: string,
  typed: string,
  /** The timestamp for `promoted:`, formatted by the caller's clock, and the id source. */
  { promoted, newId }: { promoted: string; newId: () => string }
): Promise<{ path: string }> {
  const claim = claimOf(typed);
  const { vaultPath, index } = ctx;
  const read = await readPageFile(
    vaultPath,
    path,
    [RESEARCH_QUESTION.kind],
    RESEARCH_QUESTION.noun
  );
  if (!read.readable) {
    throw new VaultError(
      "refused",
      `Couldn't read ${read.path}: ${read.reason}`
    );
  }
  const fm = (read.outline.frontmatter?.value ?? {}) as Record<string, unknown>;
  // The page's own status reader, so a status it would refuse is refused
  // here in its words. A resolved pursuit is reopened first: sharpening
  // one that is closed would leave a test hanging off a finished question.
  let status: string;
  try {
    status = readResearchQuestion(fm).status;
  } catch (cause) {
    throw new VaultError(
      "refused",
      `Couldn't read ${read.relativePath}: ${errorMessage(cause)}`
    );
  }
  if (status !== "open") {
    throw new VaultError(
      "refused",
      `${read.relativePath} is ${status}; only an open Research Question sharpens into a Hypothesis`
    );
  }

  const created = await createHypothesis(vaultPath, fm, read.outline, {
    promotedFrom: read.relativePath,
    promoted,
    claim,
    id: newId(),
  });
  const line = `- [[${basename(created.path, ".md")}]] \u2014 sharpened into a hypothesis, ${dateOf(promoted)}`;
  await orTakeBack(
    vaultPath,
    created.path,
    `Couldn't add the line to ${read.relativePath}`,
    () =>
      writeOwn(ctx, read.relativePath, RESEARCH_QUESTION, (now) => ({
        operations: [
          {
            op: "appendToSection",
            target: { section: "Related questions" },
            line,
          },
        ],
        basedOn: now.hash,
      }))
  );
  await index.own(created.path, created.content);
  return { path: created.path };
}

/** The claim as typed, trimmed; an empty one refuses, whichever route asked. */
function claimOf(typed: string): string {
  const claim = typed.trim();
  if (claim === "") {
    throw new VaultError(
      "refused",
      "A Hypothesis needs a claim: type the statement to test."
    );
  }
  return claim;
}

/**
 * The Hypothesis file, created whole from the object it was promoted from —
 * a Question or a Research Question, whose Provenance and tags it copies
 * (PROM-5) — or the refusal that says why not. Not told to the index: the
 * caller does that once the second write has landed, so a page taken back
 * is never read.
 */
async function createHypothesis(
  vaultPath: string,
  from: Record<string, unknown>,
  outline: Pick<Outline, "tags">,
  {
    promotedFrom,
    promoted,
    claim,
    id,
  }: { promotedFrom: string; promoted: string; claim: string; id: string }
): Promise<{ path: string; content: string }> {
  const tags = outline.tags
    .filter((t) => t.valid && t.source === "frontmatter")
    .map((t) => t.text);
  const content = composeHypothesis(from, tags, {
    id,
    promotedFrom: `[[${basename(promotedFrom, ".md")}]]`,
    promoted,
    claim,
  });
  const path = `${FOLDER}/${fileName(claim, id)}.md`;
  const created = await createFile(vaultPath, path, content);
  if (!created.written) {
    throw new VaultError(
      created.reason === "alreadyExists" ? "refused" : "writeFailed",
      created.reason === "alreadyExists"
        ? `Couldn't write ${path}: a file by that name is already in the vault`
        : `Couldn't write ${path}: ${created.detail}`
    );
  }
  return { path, content: created.content };
}

/** The object a Hypothesis was promoted from, as the loop writes to it. */
export type LoopParent = {
  /** Vault-relative, as the index keys it. */
  path: string;
  kind: "question" | "research-question";
};

/**
 * The loop as the page reads it (ADR 0031 decision 8; spec #327 stories
 * 69, 70, 74, 75). Nothing about it is stored on the Hypothesis: `closed`
 * means a Write-back line naming this page stands in the parent, and
 * `written` is the newest one's result and date — which the page compares
 * with `result`, the word closing now would write, to say the line no
 * longer matches. `refusal` is `closeRefusal` on the derivation — null
 * when the state is closable — whatever the parent: a Hypothesis written
 * by hand can still be *tested and undecided*, and only the write needs
 * somewhere to go. The page prints it, so the act that is not offered
 * always says why.
 */
export type Loop = { refusal: string | null; result: LoopResult } & (
  | { status: "none" }
  | { status: "unresolved"; reason: string }
  | { status: "open"; parent: LoopParent }
  | {
      status: "closed";
      parent: LoopParent;
      written: { result: LoopResult; date: string };
    }
);

const isParentKind = (kind: string): kind is LoopParent["kind"] =>
  kind === "question" || kind === "research-question";

/**
 * The parent `promoted_from` names, resolved as every write-back resolves
 * it (`resolvePromotedFrom`) and read from disk, or why there is none to
 * write to. Two files by one name are refused rather than one picked
 * (story 75): the app never guesses where an answer belongs.
 */
async function parentOf(
  index: VaultIndex,
  vaultPath: string,
  path: string,
  promotedFrom: string | undefined
): Promise<
  | { status: "none" }
  | { status: "unresolved"; reason: string }
  | { status: "found"; parent: LoopParent; read: PageFile }
> {
  if (promotedFrom === undefined) return { status: "none" };
  const resolved = resolvePromotedFrom(index, path, promotedFrom);
  if ("reason" in resolved) {
    return { status: "unresolved", reason: resolved.reason };
  }
  const read = await readPageFile(
    vaultPath,
    resolved.path,
    ["question", "research-question"],
    "a Question or a Research Question"
  );
  if (!read.readable || !isParentKind(read.kind)) {
    return {
      status: "unresolved",
      reason: `${promotedFrom} cannot take the result: ${
        read.readable ? `kind is ${read.kind}` : read.reason
      }`,
    };
  }
  return {
    status: "found",
    parent: { path: read.relativePath, kind: read.kind },
    read,
  };
}

/**
 * The newest Write-back line naming this Hypothesis in its parent, or
 * null. Found through the parent's links — each one the index resolves to
 * this page — and then the line's text, which must be the line the close
 * writes, in the place it writes it: the lead of a Question (`Answered by
 * [[h]] — <result>, <date>`), or a list item under a Research Question's
 * `## Related questions`. The newest is the last in the file, since a
 * close only ever appends.
 */
function newestLine(
  index: VaultIndex,
  { relativePath, content, outline, kind }: PageFile,
  path: string
): { result: LoopResult; date: string } | null {
  const region =
    kind === "question"
      ? leadRange(outline, content.length)
      : section(outline, "Related questions").heading?.body;
  if (region === undefined) return null;
  const prefix = kind === "question" ? /^Answered by $/ : /^\s*[-*+] $/;
  let newest: { result: LoopResult; date: string } | null = null;
  for (const link of outline.links) {
    if (
      link.syntax !== "wikilink" ||
      link.range.start < region.start ||
      link.range.end > region.end
    ) {
      continue;
    }
    if (index.resolve(relativePath, link).resolvedPath !== path) continue;
    const lineStart = content.lastIndexOf("\n", link.range.start - 1) + 1;
    const newline = content.indexOf("\n", link.range.end);
    const lineEnd = newline === -1 ? content.length : newline;
    const tail = RESULT_TAIL.exec(
      content.slice(link.range.end, lineEnd).replace(/\r$/, "")
    );
    if (!prefix.test(content.slice(lineStart, link.range.start)) || !tail) {
      continue;
    }
    newest = { result: tail[1] as LoopResult, date: tail[2]! };
  }
  return newest;
}

async function loopOf(
  index: VaultIndex,
  vaultPath: string,
  path: string,
  promotedFrom: string | undefined,
  derivation: Derivation
): Promise<Loop> {
  const now = {
    refusal: closeRefusal(derivation),
    result: resultOf(derivation),
  };
  const found = await parentOf(index, vaultPath, path, promotedFrom);
  if (found.status !== "found") return { ...now, ...found };
  const written = newestLine(index, found.read, path);
  return written === null
    ? { ...now, status: "open", parent: found.parent }
    : { ...now, status: "closed", parent: found.parent, written };
}

/**
 * Close the loop (#338; ADR 0031 decision 8; spec #327 stories 64–68, 70,
 * 75): the result written one hop up, to the object the Hypothesis was
 * promoted from, and nothing written to the Hypothesis — whether the loop
 * is closed is read back from the line (`loopOf`). Never automatic: the
 * state is live and may move again, and a write into another file is the
 * user's to make.
 *
 * - **A Question** becomes *answered* — `status`, `answered`, and one line
 *   in its lead, by the same write a Research Question's write-back makes
 *   (`writeToQuestion`), whatever its Status: the close is the user's act,
 *   and a Question answered once is answered again.
 * - **A Research Question** gains the line under `## Related questions` and
 *   keeps its Status: a test of a sharpened claim has not answered the
 *   broader question.
 *
 * Closing again after the state moved appends a second line; a line
 * already written is true of its date and is never rewritten. `basedOn` is
 * the Hypothesis as the page read it, so the result written is the one the
 * user was looking at when they chose to write it.
 */
export async function closeLoop(
  ctx: PageContext,
  path: string,
  input: { basedOn: string; at: Date }
): Promise<{ path: string }> {
  const { index, vaultPath } = ctx;
  const page = await readHypothesisPage(index, vaultPath, path);
  if (!page.readable) {
    throw new VaultError(
      "refused",
      `Couldn't read ${page.path}: ${page.reason}`
    );
  }
  if (page.hash !== input.basedOn) {
    throw new VaultError(
      "refused",
      `${page.path} changed on disk since the page read it; nothing was written back.`
    );
  }
  const { loop } = page;
  if (loop.refusal !== null) throw new VaultError("refused", loop.refusal);
  if (loop.status === "none") {
    throw new VaultError(
      "refused",
      "This Hypothesis was written directly, promoted from nothing: there is nothing to write back to."
    );
  }
  if (loop.status === "unresolved") {
    throw new VaultError("refused", loop.reason);
  }

  const at = localIso(input.at);
  const link = `[[${basename(page.path, ".md")}]]`;
  const tail = ` — ${loop.result}, ${dateOf(at)}`;
  const { parent } = loop;
  if (parent.kind === "research-question") {
    const result = await writeOwn(
      ctx,
      parent.path,
      RESEARCH_QUESTION,
      (now) => ({
        operations: [
          {
            op: "appendToSection",
            target: { section: "Related questions" },
            line: `- ${link}${tail}`,
          },
        ],
        basedOn: now.hash,
      })
    );
    if (!result.written) {
      throw new VaultError(
        "refused",
        `Couldn't write the result to ${parent.path}: ${result.detail}`
      );
    }
    return { path: parent.path };
  }

  const written = await writeToQuestion(index, vaultPath, parent.path, {
    keys: { status: "answered", answered: at },
    line: `Answered by ${link}${tail}`,
  });
  if (!written.written) {
    throw new VaultError(
      "refused",
      `Couldn't write the result back: ${written.reason}`
    );
  }
  return { path: written.path };
}
