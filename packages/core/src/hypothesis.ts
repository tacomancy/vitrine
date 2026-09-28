import type { Heading, Outline } from "markdown";
import { VaultError } from "./errors.js";
import {
  changedUnderneath,
  historyOperations,
  notExactlyOne,
  savePosition,
  unchanged,
  writeOwn,
  type PageContext,
  type PageKind,
  type SavedAnswer,
} from "./page-write.js";
import { asString } from "./question-kind.js";
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
  CRITERIA_FIELD,
  criterionField,
  derive,
  labelOf,
  LETTER,
  nameOf,
  type Derivation,
} from "./hypothesis-rule.js";
import {
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
      derivation: Derivation;
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
    derivation: derive(read.criteria),
    problems,
  };
}

// `criterion C2 · edited after evidence`, or `criterion ^c2 · …` for one
// that had no Relationship: the digit is the id, whatever the letter was.
const MARKED_FIELD = /^criterion (?:[CFD]|\^c)(\d+) · edited after evidence$/;

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
