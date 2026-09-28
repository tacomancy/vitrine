import { outline, type Heading } from "markdown";
import {
  formatRevision,
  topLevelItems,
  type Revision,
} from "./position-history.js";
import {
  deriveKind,
  type Criterion,
  type Relationship,
} from "./vault-files.js";

/**
 * What a Hypothesis's criteria mean for the record (ADR 0031; `CONTEXT.md`
 * § Testing): the Derived state, the labels a Revision names a criterion
 * by, and the entries an edit to `## Criteria` owes the history. Apart from
 * `hypothesis.ts` because the page writes' own path (`page-write.ts`)
 * needs it too — to judge the criteria an Obsidian edit changed when its
 * parked Revision is spliced (#336) — and `hypothesis.ts` imports that path.
 */

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
  /** What the criteria say, by the rule alone. */
  state: DerivedState;
  /**
   * What the page reads: *supported* while a live Override stands over a
   * derived *inconclusive*, and the derived state otherwise.
   */
  effective: DerivedState;
  /** The live Override the effective state rests on, or null. */
  override: { at: string; why: string } | null;
  clause: Clause;
  /**
   * The criteria the clause is about, by label — or `^c<n>` for one with no
   * Relationship, which has no label: the met falsifying criteria, the ones
   * that disagree, the ones awaiting, or every deciding one when supported.
   */
  named: string[];
  /**
   * Every criterion keeping the state from *supported*, by name, whatever
   * the clause: a deciding one that has not landed for the claim — awaiting
   * evidence, or read the wrong way — and one with no Relationship. What an
   * Override overrules, so the form can list it (spec #327 story 58).
   */
  unlanded: string[];
  /** Over every criterion, diagnostic ones included: the shape of the evidence, not the rule. */
  census: {
    met: number;
    notMet: number;
    inconclusive: number;
    awaiting: number;
  };
};

export const LETTER: Record<Relationship, string> = {
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
export const nameOf = (c: Pick<Criterion, "id" | "relationship">) =>
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
  criteria: ReadonlyArray<Pick<Criterion, "id" | "relationship" | "outcome">>,
  /** The history's live Override (`liveOverride`), for the effective state; none when omitted. */
  live: Revision | null = null
): Derivation {
  const census = { met: 0, notMet: 0, inconclusive: 0, awaiting: 0 };
  for (const { outcome } of criteria) {
    if (outcome === "met") census.met++;
    else if (outcome === "not met") census.notMet++;
    else if (outcome === "inconclusive") census.inconclusive++;
    else census.awaiting++;
  }
  // What a deciding criterion must read for the claim to stand: confirming
  // met, falsifying not met (the correction above).
  const supports = (c: (typeof criteria)[number]) =>
    c.outcome === (c.relationship === "confirming" ? "met" : "not met");
  const unlanded = criteria
    .filter(
      (c) =>
        c.relationship === null ||
        (c.relationship !== "diagnostic" && !supports(c))
    )
    .map(nameOf);
  const result = (
    state: DerivedState,
    clause: Clause,
    named: string[] = []
  ): Derivation => {
    // The Override is only ever *inconclusive → supported* (decision 7).
    // Anything that could move the derived state voids it in the same
    // write, so a live one over another state is an Obsidian edit still
    // parked, not yet spliced — and a result the criteria reached is not
    // the Override's to contradict meanwhile.
    const standing =
      live !== null && live.why !== null && state === "inconclusive"
        ? { at: live.at, why: live.why }
        : null;
    return {
      state,
      effective: standing === null ? state : "supported",
      override: standing,
      clause,
      named,
      unlanded,
      census,
    };
  };

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

/** The field an Override is written under, and the one its void is (§ Vault layout (Hypothesis)). The renderer's `history.ts` repeats both literals. */
export const OVERRIDE = "override";
export const OVERRIDE_VOIDED = "override voided";

/**
 * The Override that stands, from the history's entries in file order,
 * newest first: the newest `· override` with a why that no
 * `· override voided` names by its timestamp. An entry typed by hand
 * without a why is not one — an Override exists only as a considered act
 * with its reason written (`CONTEXT.md` *Override*) — and it stays in the
 * history, loud, saying no why was written, so it is not lost either.
 */
export function liveOverride(entries: readonly Revision[]): Revision | null {
  const newest = entries.find((e) => e.field === OVERRIDE && e.why !== null);
  if (newest === undefined) return null;
  const voided = entries.some(
    (e) => e.field === OVERRIDE_VOIDED && e.from.trim() === newest.at
  );
  return voided ? null : newest;
}

/**
 * Why an Override cannot be made on this derivation, or null when it can
 * (ADR 0031 decision 7). One function for the page's offer and the core's
 * refusal, so the line under the rule is never offered for a write the
 * core would refuse. A why is the write's own check: it is the one
 * condition the page cannot read off the file.
 */
export function overrideRefusal(derivation: Derivation): string | null {
  if (derivation.override !== null) {
    return "An override is already live; it stands until something it judged changes, and a new one needs a new why.";
  }
  if (derivation.state !== "inconclusive") {
    return `The criteria derive ${derivation.state}; only an inconclusive hypothesis can be overridden, and only to supported.`;
  }
  const { met, notMet, inconclusive } = derivation.census;
  if (met + notMet + inconclusive === 0) {
    return "No criterion carries an outcome yet, so there is nothing to be partial about.";
  }
  return null;
}

/**
 * The void the Override is owed when a write revises what it judged: its
 * own entry, `from:` the Override's timestamp, stamped with the write that
 * caused it. Load-bearing (`CLAUDE.md` § Code standard; ADR 0031 decision
 * 7): an Override is a call made on the criteria and the claim as they
 * stood, so it must not outlive them — otherwise a page could read
 * *supported* on evidence nobody ever judged. Design notes never void it:
 * they describe how the test is run, not what it claims or what counts.
 */
export const voidOf = (override: Revision, at: string): string =>
  formatRevision({ at, field: OVERRIDE_VOIDED, why: null, from: override.at });

/**
 * The suffix a criterion Revision carries when it moved the bar (§ Vault
 * layout (Hypothesis)). The renderer's `history.ts` reads the same literal
 * to keep these entries out of the quiet trail — it imports only types from
 * the core, so a change here must be made there too.
 */
export const AFTER_EVIDENCE = " · edited after evidence";

/** The field a criterion's Revisions carry: `criterion F1`, or `criterion ^c3` while it has no Relationship and so no label. */
export const criterionField = (c: Pick<Criterion, "id" | "relationship">) =>
  `criterion ${nameOf(c)}`;

/**
 * The key `## Criteria` is diffed under in the index's `positions`, and so
 * the field a Revision parked by an Obsidian edit to it carries until the
 * splice turns it into per-criterion entries (`hypothesisPositions`).
 */
export const CRITERIA_FIELD = "criteria";

/**
 * The suffix of the loudest entry there is (§ Vault layout (Hypothesis)): a
 * criterion that had Evidence under it, gone from the file. The page never
 * writes it — it refuses to delete a tested criterion (ADR 0031 decision 5)
 * — so only an edit made outside the app can earn it. The renderer's
 * `history.ts` repeats the literal, as it does `AFTER_EVIDENCE`'s.
 */
export const DELETED_AFTER_EVIDENCE = " · deleted after evidence";

/** One criterion as a `## Criteria` text holds it: its block, and whether any line sits under its heading. */
type Block = { criterion: Criterion; text: string; tested: boolean };

/**
 * A `## Criteria` body read the way the file's own reader reads it — the
 * same vocabulary, the same `^c<n>` rule — so a block judged here is the
 * block the page shows. The index keeps only the section's text, which is
 * all the previous state an Obsidian edit leaves behind.
 */
function blocksOf(body: string): Block[] {
  const doc = `## Criteria\n\n${body}\n`;
  const parsed = outline(doc);
  const taken = new Set<Heading>();
  return deriveKind("", "hypothesis", parsed).criteria.flatMap((criterion) => {
    const heading = parsed.headings.find(
      (h) => h.level === 3 && h.blockId === criterion.id && !taken.has(h)
    );
    if (heading === undefined) return [];
    taken.add(heading);
    return [
      {
        criterion,
        text: doc.slice(heading.range.start, heading.body.end).trim(),
        tested: topLevelItems(parsed, heading).length > 0,
      },
    ];
  });
}

/**
 * The history entries an edit made to `## Criteria` outside the app owes
 * (#336; spec #327 stories 51, 52, 87), from the section as it was to the
 * section as it is, stamped with the parked Revision's time. In the order
 * `prependEntry` takes them, so the last is the newest-looking.
 * Load-bearing (`CLAUDE.md` § Code standard): this is the guard against
 * post-hoc storytelling for every edit the page did not make, and it must
 * write what the page's own writes would have (`hypothesis.ts`).
 *
 * Criteria are paired by the id's number, which never moves (ADR 0031
 * decision 3): a Relationship changed in Obsidian is the same criterion
 * relabelled, not one deleted and another added, and its entry names the
 * label as it stood. Each criterion changed gets its own Revision; one gone
 * gets *deleted after evidence* if it was tested, and a quiet Revision if it
 * was a draft, as the page's delete writes; one new gets its first, from
 * empty. When `derive` on the two sides disagrees, a `· state` entry, `from:`
 * the state it left, goes on top, as the page's criterion writes do.
 *
 * *Edited after evidence* is judged on Evidence under the criterion before
 * **or** after. The page judges before alone, because it sees each edit as
 * it is made. A parked Revision sees only the ends of a window in which
 * Obsidian may have saved many times, so a run named and the wording then
 * changed to fit it — the exact move the mark exists for — would read as
 * an untested criterion reworded if only the first end counted. Marking the
 * rarer honest order too (reword, then name the run) is the loud side of an
 * ambiguity the window cannot resolve, and the page offers a why on it
 * like any marked entry (ADR 0034).
 */
export function criteriaEntries(
  was: string,
  now: string,
  at: string
): string[] {
  const before = blocksOf(was);
  const after = blocksOf(now);
  const entries: string[] = [];
  const revision = (field: string, from: string) =>
    entries.push(formatRevision({ at, field, why: null, from }));

  for (const old of before) {
    const still = after.find((b) => b.criterion.id === old.criterion.id);
    const field = criterionField(old.criterion);
    if (still === undefined) {
      revision(old.tested ? field + DELETED_AFTER_EVIDENCE : field, old.text);
      continue;
    }
    if (still.text === old.text) continue;
    const movedTheBar =
      still.criterion.text !== old.criterion.text ||
      still.criterion.relationship !== old.criterion.relationship;
    revision(
      movedTheBar && (old.tested || still.tested)
        ? field + AFTER_EVIDENCE
        : field,
      old.text
    );
  }
  for (const added of after) {
    if (!before.some((b) => b.criterion.id === added.criterion.id)) {
      revision(criterionField(added.criterion), "");
    }
  }

  const left = derive(before.map((b) => b.criterion)).state;
  if (left !== derive(after.map((b) => b.criterion)).state) {
    revision("state", left);
  }
  return entries;
}
