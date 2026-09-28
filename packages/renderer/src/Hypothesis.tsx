import { useQuery } from "@tanstack/react-query";
import type {
  CriterionRead,
  Derivation,
  HypothesisFrontmatter,
  Loop,
  Revision,
} from "core";
import { useState } from "react";
import { formatAge } from "./age";
import styles from "./Hypothesis.module.css";
import { hypothesisFilters } from "./history";
import { Criteria } from "./HypothesisCriteria";
import { LoopLine } from "./HypothesisLoop";
import { OverrideForm } from "./HypothesisOverride";
import { FrameLines, usePageFrame } from "./page-frame";
import { PositionField } from "./PositionField";
import { PositionHistory } from "./PositionHistory";
import {
  describeProblem,
  Outline,
  provenanceLine,
  Section,
} from "./ResearchQuestion";
import rq from "./ResearchQuestion.module.css";
import { localDate } from "./rows";
import { useTRPC } from "./trpc";
import { useVaultStatusLines } from "./VaultStatusLines";
import { WhyLine } from "./WhyLine";
import { linkLabel } from "./wikilink";

/**
 * The Hypothesis view (brief § Testing: Hypothesis and Experiment; prompt 4;
 * ADR 0031), at `#/hypothesis/<path>` (ADR 0026): where the claim was
 * first wondered, the claim itself, the Derived state with the rule that
 * computed it printed beside it, the criteria as read — falsifying ones in
 * their own band above the rest — then design notes and the Position
 * history. The claim and design notes are Positions edited in place like a
 * Working answer (#333, `PositionField.tsx`), each save a Revision in the
 * one timeline below. There is no status control anywhere on the
 * page: the state is the core's function of the criteria, and a control
 * would make it a label someone chose (spec #327 story 36).
 *
 * The frame — the page read's lines, the rename and removal handling, the
 * arrival that did not resolve — is `page-frame.tsx`, shared with the
 * Research Question view, so the two behave alike under external change.
 */
export function Hypothesis({ path }: { path: string }) {
  const trpc = useTRPC();
  const page = useQuery(trpc.hypotheses.page.queryOptions({ path }));
  const status = useVaultStatusLines();

  const data = page.data;
  const { sectionRef, removed, resolved } = usePageFrame(
    "hypothesis",
    path,
    data
  );

  const readable = removed === null && data?.readable === true ? data : null;
  const problems = readable?.problems ?? [];
  const hasFooter = problems.length > 0 || status.hasLines;

  return (
    <section
      ref={sectionRef}
      className={rq.page}
      aria-label="Hypothesis view"
      tabIndex={-1}
    >
      <FrameLines
        error={page.isError ? page.error : null}
        removed={removed}
        resolved={resolved}
        data={data}
      />
      {readable !== null && (
        <div className={rq.scroll}>
          <Header
            frontmatter={readable.frontmatter}
            entries={readable.sections.positionHistory.entries}
          />
          {/* The claim in the serif, as the page's lead — and a text field,
              because sharpening it must be as fast as editing text (spec
              #327 story 16). Its Revisions are the header's count. */}
          <Section name="Claim" present={readable.sections.claim.present}>
            <PositionField
              position={{ kind: "hypothesis", field: "claim" }}
              path={readable.path}
              hash={readable.hash}
              text={readable.sections.claim.text}
              labelledBy="rq-claim"
              className={styles.claim}
              empty={
                <Outline>
                  No claim written. A falsifiable statement goes here — one the
                  criteria below could show false.
                </Outline>
              }
            />
          </Section>
          <State
            derivation={readable.derivation}
            overridable={readable.overridable}
            loop={readable.loop}
            criteria={readable.sections.criteria.criteria}
            path={readable.path}
            hash={readable.hash}
          />
          <Section name="Criteria" present={readable.sections.criteria.present}>
            <Criteria
              path={readable.path}
              hash={readable.hash}
              criteria={readable.sections.criteria.criteria}
            />
          </Section>
          <Section
            name="Design notes"
            present={readable.sections.designNotes.present}
          >
            <PositionField
              position={{ kind: "hypothesis", field: "design notes" }}
              path={readable.path}
              hash={readable.hash}
              text={readable.sections.designNotes.text}
              labelledBy="rq-design-notes"
              empty={
                <Outline>
                  Nothing yet. What is varied, what is held constant, and the
                  confounds you know about — a paragraph, not a form.
                </Outline>
              }
            />
          </Section>
          <Section
            name="Position history"
            present={readable.sections.positionHistory.present}
          >
            <PositionHistory
              entries={readable.sections.positionHistory.entries}
              current={{
                claim: readable.sections.claim.text,
                "design notes": readable.sections.designNotes.text,
                // A `· state` entry's `from:` is the state it left (#334),
                // so what it moved to, for the newest, is the state now.
                state: readable.derivation.state,
              }}
              filters={hypothesisFilters(
                readable.sections.positionHistory.entries
              )}
              // A why onto any entry, months later (spec #327 story 54): the
              // page's own hash, because no save of the page's stands
              // between the read and this write.
              whyLine={({ at, field }, close) => (
                <WhyLine
                  kind="hypothesis"
                  path={readable.path}
                  at={at}
                  field={field}
                  basedOn={readable.hash}
                  onClose={close}
                />
              )}
            />
            <p className={rq.baseLine}>{baseLine(readable.frontmatter)}</p>
          </Section>
        </div>
      )}
      {hasFooter && (
        <footer className={rq.footer}>
          {problems.length > 0 && (
            <span className={rq.footerLine}>
              could not show: {problems.map(describeProblem).join(" · ")}
            </span>
          )}
          {status.lines}
        </footer>
      )}
    </section>
  );
}

/** Where the claim was first wondered, and how settled it is. */
function Header({
  frontmatter,
  entries,
}: {
  frontmatter: HypothesisFrontmatter;
  entries: Revision[];
}) {
  const now = new Date();
  return (
    <header className={rq.header}>
      <div className={rq.kicker}>
        <span>Hypothesis</span>
        {frontmatter.promoted !== undefined && (
          <span>promoted {formatAge(frontmatter.promoted, now)}</span>
        )}
        <span>{claimRevisions(entries)}</span>
      </div>
      <p className={rq.provenance}>{provenance(frontmatter)}</p>
    </header>
  );
}

/**
 * `claim revision 3 of 3 · held since 2 August 2026`, derived from the
 * history (spec #327 story 19), as the Research Question's header derives
 * its answer's: the claim on the page is always the latest revision, held
 * since the newest `claim` entry recorded it. Design-note and criterion
 * entries share the timeline but are not the claim moving.
 */
function claimRevisions(entries: Revision[]): string {
  const ofClaim = entries.filter((e) => e.field === "claim");
  const newest = ofClaim[0];
  if (newest === undefined) return "no claim revisions yet";
  return `claim revision ${ofClaim.length} of ${ofClaim.length} · held since ${localDate(newest.at)}`;
}

/**
 * A Hypothesis promoted from a capture carries its Provenance; one written
 * directly in Obsidian may carry none, and says so rather than borrowing the
 * word *unattached*, which is a capture's (`CONTEXT.md`).
 */
function provenance(fm: HypothesisFrontmatter): string {
  if (fm.captured === undefined && fm.from === undefined) {
    return fm.promotedFrom === undefined
      ? "written directly — no capture behind it"
      : `promoted from ${linkLabel(fm.promotedFrom)}`;
  }
  return provenanceLine(fm);
}

/** The history's floor, derived from the frontmatter and never written as an entry. */
function baseLine(fm: HypothesisFrontmatter): string {
  if (fm.promotedFrom === undefined) return "written directly, not promoted";
  const when = fm.promoted === undefined ? "" : `, ${localDate(fm.promoted)}`;
  return `promoted from ${linkLabel(fm.promotedFrom)}${when}`;
}

/**
 * The Derived state (TEST-2, TEST-3; ADR 0031 decision 1). The word, the
 * clause that produced it, the census, and the rule itself in the words
 * decision 1 fixes — not the prototype's "all criteria met → supported",
 * which is the defect the ADR corrects. Every state is drawn by one class:
 * *falsified* is a result as finished as *supported*, never greyed or
 * struck (TEST-7).
 *
 * Overridden (#337; decision 7), the word is *supported* and never loses
 * its qualifier: *overrides inconclusive*, the derived state and its
 * *because* printed beside it, and the why — so a reader sees both what
 * the criteria said and what was decided instead (story 59). The Override
 * is reached from the line under the rule, offered only when the core says
 * one can be made, never as a control beside the state.
 *
 * Below it, the loop (#338): the result written back to where the
 * Hypothesis came from, or why it cannot be (`HypothesisLoop.tsx`).
 */
function State({
  derivation,
  overridable,
  loop,
  criteria,
  path,
  hash,
}: {
  derivation: Derivation;
  overridable: boolean;
  loop: Loop;
  criteria: CriterionRead[];
  path: string;
  hash: string;
}) {
  const [overriding, setOverriding] = useState(false);
  const { override } = derivation;
  return (
    <section className={styles.state} aria-label="Derived state">
      <h2 className={rq.label}>
        {override === null
          ? "Derived state"
          : `State · asserted ${localDate(override.at)}`}
      </h2>
      <p className={styles.verdict}>
        <span className={styles.stateWord} data-state={derivation.effective}>
          {derivation.effective}
        </span>
        {override === null ? (
          <span className={styles.because}>
            because {becauseOf(derivation)}
          </span>
        ) : (
          <span className={styles.because}>overrides inconclusive</span>
        )}
      </p>
      {override !== null && (
        <>
          <p className={styles.derived}>
            derived {derivation.state}, because {becauseOf(derivation)}
          </p>
          <blockquote className={styles.overrideQuote}>
            “{override.why}”
          </blockquote>
        </>
      )}
      <p className={styles.census}>{censusWords(derivation.census)}</p>
      <ul className={styles.rule} aria-label="The rule">
        <li>any falsifying criterion met → falsified</li>
        <li>
          every confirming criterion met, every falsifying one not met, and at
          least one of either → supported
        </li>
        <li>otherwise → inconclusive</li>
        <li>diagnostic criteria never decide</li>
      </ul>
      {overridable && !overriding && (
        <button
          type="button"
          className={`${rq.edit} ${styles.offer}`}
          onClick={() => setOverriding(true)}
        >
          disagree with this? override…
        </button>
      )}
      {derivation.state === "falsified" && (
        <p className={styles.offerNote}>
          not overridable — a met falsifying criterion is a result
        </p>
      )}
      {overridable && overriding && (
        <OverrideForm
          path={path}
          hash={hash}
          criteria={criteria}
          unlanded={derivation.unlanded}
          onClose={() => setOverriding(false)}
        />
      )}
      <LoopLine loop={loop} path={path} hash={hash} />
    </section>
  );
}

/** `F1 and C8`, `F1, C2 and C3`. */
function and(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The *because* line: which clause of the rule applied (spec #327 story 39). */
function becauseOf({ clause, named }: Derivation): string {
  switch (clause) {
    case "falsifyingMet":
      return `${and(named)} met`;
    case "noCriteria":
      return "nothing has been tested yet — no criteria are written";
    case "nothingTested":
      return "nothing has been tested yet";
    case "mixed":
      return `the criteria disagree: ${named.join(", ")}`;
    case "awaitingEvidence":
      return `awaiting evidence on ${and(named)}`;
    case "noRelationship":
      return `${and(named)} ${named.length > 1 ? "have" : "has"} no relationship yet`;
    case "onlyDiagnostic":
      return "no criterion decides — every one is diagnostic";
    case "allLanded":
      return `every deciding criterion landed: ${named.join(", ")}`;
  }
}

const WORDS = [
  "nothing",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
];
const inWords = (n: number) => WORDS[n] ?? String(n);

/** The census in words — the shape of the evidence, never mistaken for the rule (story 43). */
function censusWords(census: Derivation["census"]): string {
  return [
    `${inWords(census.met)} met`,
    `${inWords(census.notMet)} not met`,
    `${inWords(census.inconclusive)} inconclusive`,
    `${inWords(census.awaiting)} awaiting evidence`,
  ].join(" · ");
}
