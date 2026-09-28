import type { Heading } from "markdown";
import { asString } from "./question-kind.js";
import {
  bodyText,
  linkLine,
  readPageFile,
  revisionsOf,
  section,
  type LinkLine,
} from "./page-file.js";
import { topLevelItems, type Revision } from "./position-history.js";
import type {
  Criterion,
  Outcome,
  Relationship,
  ShapeProblem,
} from "./vault-files.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * The Hypothesis Kind (`docs/architecture.md` § Vault layout (Hypothesis),
 * § Hypothesis view; ADR 0031; `CONTEXT.md` § Testing): how the page is read
 * from a `kind: hypothesis` file, and the one function the testing half of
 * the app rests on — the Derived state, computed from the criteria and never
 * stored.
 */

export const KIND = "hypothesis";

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
};

export type DerivedState = "supported" | "falsified" | "inconclusive";

/**
 * Which clause of the rule applied — what the page's *because* line says,
 * so the one word *inconclusive* never hides two different situations
 * (spec #327 story 39).
 */
export type Clause =
  /** A falsifying criterion is met: falsified, whatever the rest say. */
  | "falsifyingMet"
  /** Nothing is written under `## Criteria`. */
  | "noCriteria"
  /** Criteria exist and not one carries an Outcome. */
  | "nothingTested"
  /** A deciding criterion landed the wrong way for support — a confirming one not met or inconclusive, a falsifying one inconclusive. */
  | "mixed"
  /** A deciding criterion has no Outcome yet. */
  | "awaitingEvidence"
  /** A criterion has no Relationship: it blocks support and cannot falsify. */
  | "noRelationship"
  /** Every criterion is diagnostic, and diagnostic criteria never decide. */
  | "onlyDiagnostic"
  /** Every confirming criterion met, every falsifying one not met: supported. */
  | "allLanded";

export type Derivation = {
  state: DerivedState;
  clause: Clause;
  /**
   * The criteria the clause is about, by label — or `^c<n>` for one with no
   * Relationship, which has no label: the met falsifying criteria, the ones
   * that disagree, the ones awaiting, or every deciding one when supported.
   */
  named: string[];
  /** Over every criterion, diagnostic ones included: the shape of the evidence, not the rule. */
  census: {
    met: number;
    notMet: number;
    inconclusive: number;
    awaiting: number;
  };
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

const LETTER: Record<Relationship, string> = {
  confirming: "C",
  falsifying: "F",
  diagnostic: "D",
};

/**
 * `F1`, `C2`, `D5` — the Relationship's letter and the id's number, so a
 * relabelled criterion changes its letter and never its number, and nothing
 * ever renumbers (ADR 0031 decision 3). The prototype's per-Relationship run
 * (`F1 · C1 · C2`) was rejected there: deleting one would rename the rest.
 */
export function labelOf(
  criterion: Pick<Criterion, "id" | "relationship">
): string | null {
  if (criterion.relationship === null) return null;
  return LETTER[criterion.relationship] + criterion.id.slice(1);
}

/** How a clause names a criterion: its label, or its id when it has none. */
const nameOf = (c: Pick<Criterion, "id" | "relationship">) =>
  labelOf(c) ?? `^${c.id}`;

/**
 * The Derived state of a Hypothesis (ADR 0031 decision 1; `CONTEXT.md`
 * *Derived state*). Load-bearing (`CLAUDE.md` § Code standard): this is the
 * function the page prints its rule beside, so a reader checking the rule
 * against the criteria must find it right.
 *
 * The rule is corrected from the brief, not transcribed. The brief says
 * "all criteria met → supported", which read literally makes a falsifying
 * criterion a trap: *met* kills the claim, and *not met* — the claim
 * surviving the test written to kill it — fails "all met", so a Hypothesis
 * with the most honest criterion there is could never be supported. So a
 * falsifying criterion **not met** counts toward support here, exactly as a
 * confirming one met does. Do not "fix" this back to the brief's wording.
 * Diagnostic criteria never decide — the brief defines them that way, and
 * the literal rule let an unmet sanity check block support. With no
 * deciding criterion at all nothing is supported by default: inconclusive.
 *
 * Takes criteria as the core's criteria reader gives them, so a field
 * outside its vocabulary has already become absent: an unreadable Outcome
 * is *awaiting evidence* to the rule, and an unreadable Relationship is none.
 */
export function derive(
  criteria: ReadonlyArray<Pick<Criterion, "id" | "relationship" | "outcome">>
): Derivation {
  const census = { met: 0, notMet: 0, inconclusive: 0, awaiting: 0 };
  for (const { outcome } of criteria) {
    if (outcome === "met") census.met++;
    else if (outcome === "not met") census.notMet++;
    else if (outcome === "inconclusive") census.inconclusive++;
    else census.awaiting++;
  }
  const result = (
    state: DerivedState,
    clause: Clause,
    named: string[] = []
  ) => ({
    state,
    clause,
    named,
    census,
  });

  const falsifiedBy = criteria.filter(
    (c) => c.relationship === "falsifying" && c.outcome === "met"
  );
  if (falsifiedBy.length > 0) {
    return result("falsified", "falsifyingMet", falsifiedBy.map(nameOf));
  }
  if (criteria.length === 0) return result("inconclusive", "noCriteria");
  if (criteria.every((c) => c.outcome === null)) {
    return result("inconclusive", "nothingTested");
  }

  const deciding = criteria.filter(
    (c) => c.relationship === "confirming" || c.relationship === "falsifying"
  );
  // What a deciding criterion must read for the claim to stand: confirming
  // met, falsifying not met (the correction above).
  const supports = (c: (typeof deciding)[number]) =>
    c.outcome === (c.relationship === "confirming" ? "met" : "not met");
  const against = deciding.filter((c) => c.outcome !== null && !supports(c));
  if (against.length > 0) {
    return result("inconclusive", "mixed", against.map(nameOf));
  }
  const awaiting = deciding.filter((c) => c.outcome === null);
  if (awaiting.length > 0) {
    return result("inconclusive", "awaitingEvidence", awaiting.map(nameOf));
  }
  // A criterion someone wrote without saying what it means for the claim
  // does not count yet: it cannot falsify (above), and it blocks support.
  const unrelated = criteria.filter((c) => c.relationship === null);
  if (unrelated.length > 0) {
    return result("inconclusive", "noRelationship", unrelated.map(nameOf));
  }
  if (deciding.length === 0) return result("inconclusive", "onlyDiagnostic");
  return result("supported", "allLanded", deciding.map(nameOf));
}

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
  const read = await readPageFile(vaultPath, path, KIND, "a Hypothesis");
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
    };
  });

  const history = revisionsOf(
    relativePath,
    KIND,
    content,
    outline,
    found["Position history"]
  );
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
