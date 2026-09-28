import { useQuery } from "@tanstack/react-query";
import type {
  CriterionRead,
  Derivation,
  HypothesisFrontmatter,
  Revision,
} from "core";
import { formatAge } from "./age";
import styles from "./Hypothesis.module.css";
import { FrameLines, usePageFrame } from "./page-frame";
import { PositionField } from "./PositionField";
import { PositionHistory } from "./PositionHistory";
import {
  describeProblem,
  Lines,
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
          <State derivation={readable.derivation} />
          <Section name="Criteria" present={readable.sections.criteria.present}>
            <Criteria criteria={readable.sections.criteria.criteria} />
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
              }}
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
 */
function State({ derivation }: { derivation: Derivation }) {
  return (
    <section className={styles.state} aria-labelledby="hy-state">
      <h2 id="hy-state" className={rq.label}>
        Derived state
      </h2>
      <p className={styles.verdict}>
        <span className={styles.stateWord} data-state={derivation.state}>
          {derivation.state}
        </span>
        <span className={styles.because}>because {becauseOf(derivation)}</span>
      </p>
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

/**
 * The criteria as read. Falsifying ones get their own band above the rest
 * (story 24): they can settle the page on their own, so they carry more
 * weight. That is layout, not file order — the file keeps them where they
 * were written.
 */
function Criteria({ criteria }: { criteria: CriterionRead[] }) {
  if (criteria.length === 0) {
    return (
      <Outline>
        No criteria yet. Write what would confirm the claim and what would kill
        it before any run — that record is the point of the page.
      </Outline>
    );
  }
  const falsifying = criteria.filter((c) => c.relationship === "falsifying");
  const rest = criteria.filter((c) => c.relationship !== "falsifying");
  return (
    <div className={styles.criteria}>
      {falsifying.length > 0 && (
        <div
          role="group"
          aria-label="Falsifying criteria"
          className={styles.band}
        >
          <p className={styles.bandNote}>
            if met, any one of these decides the page alone
          </p>
          {falsifying.map((c) => (
            <Card key={c.id} criterion={c} />
          ))}
        </div>
      )}
      {rest.length > 0 && (
        <div role="group" aria-label="Other criteria" className={styles.rest}>
          {rest.map((c) => (
            <Card key={c.id} criterion={c} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One criterion: its Relationship and label, its chips, its text, and the
 * Evidence under it. *Awaiting evidence* is the absence of an Outcome (ADR
 * 0031 decision 2) and is drawn as its own chip, so *not yet tested* never
 * looks like *tested and inconclusive* (TEST-4). An Outcome with nothing
 * under it says no run is named, rather than showing an Outcome nobody can
 * trace.
 */
function Card({ criterion }: { criterion: CriterionRead }) {
  const { relationship, label, outcome, outcomeUnreadable, evidence } =
    criterion;
  const chips: Array<{ text: string; tone: "outcome" | "quiet" }> = [];
  if (outcomeUnreadable !== null) {
    chips.push({
      text: `outcome unreadable: ${outcomeUnreadable}`,
      tone: "quiet",
    });
  } else if (outcome === null) {
    chips.push({ text: "awaiting evidence", tone: "quiet" });
  } else {
    chips.push({ text: outcome, tone: "outcome" });
    if (evidence.length === 0)
      chips.push({ text: "no run named", tone: "quiet" });
  }
  if (relationship === null) {
    chips.push({ text: "does not count yet", tone: "quiet" });
  }
  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.relationship}>
          {relationship === null
            ? "no relationship"
            : `${relationship} · ${label}`}
        </span>
        <span className={styles.chips}>
          {chips.map(({ text, tone }) => (
            <span key={text} className={styles.chip} data-tone={tone}>
              {text}
            </span>
          ))}
        </span>
      </div>
      <p className={styles.criterionText}>{criterion.text}</p>
      {evidence.length > 0 && <Lines lines={evidence} empty="" />}
    </article>
  );
}
