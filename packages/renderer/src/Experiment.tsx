import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CameFrom,
  EvidenceFor,
  ExperimentFrontmatter,
  ExperimentSections,
  ExperimentStatus,
  RelatedQuestion,
} from "core";
import { useEffect, useId, useRef, useState } from "react";
import { AttachEvidence, criterionName, standing } from "./AttachEvidence";
import styles from "./Experiment.module.css";
import { addressOf, markOf } from "./kinds";
import { Artifacts } from "./ExperimentArtifacts";
import { FrameLines, usePageFrame } from "./page-frame";
import { PositionField } from "./PositionField";
import { PositionHistory } from "./PositionHistory";
import {
  describeProblem,
  Outline,
  Section,
  sectionId,
} from "./ResearchQuestion";
import rq from "./ResearchQuestion.module.css";
import { localDate } from "./rows";
import { useTRPC } from "./trpc";
import { useVaultStatusLines } from "./VaultStatusLines";
import { WhyLine } from "./WhyLine";

/**
 * The Experiment view (brief § Experiment; prompt 5; prototype 05), at
 * `#/experiment/<path>` (ADR 0026): the hand-set status, the name, Purpose,
 * Design, Artifacts and Observations in the column, and *where it ran*,
 * *came from* and the history in the rail beside it. Purpose and *where it
 * ran* are Edited sections, saved as typed with no Revision (spec #362
 * story 18); Design and Observations are Positions, each save a Revision
 * in the one trail in the rail, with a why offered as on every page that
 * has a history (#365; TEST-8, TEST-11). The Artifacts are
 * `ExperimentArtifacts.tsx`; the page owns only the drop.
 *
 * A planned run is a finished plan, not a page with gaps (TEST-9): every
 * empty region says what will go in it.
 *
 * The frame — the page read's lines, the rename and removal handling, the
 * arrival that did not resolve — is `page-frame.tsx`, as every page's is.
 */
/** The field that takes the keyboard on an arrival that came to write. */
export type WriteOnArrival = "purpose" | "observations";

export function Experiment({
  path,
  writeOnArrival = null,
  onArrival,
}: {
  path: string;
  /**
   * Purpose, for a run just made; Observations, for the Experiment
   * Inbox's `O` (#372). That field takes the keyboard when it mounts.
   */
  writeOnArrival?: WriteOnArrival | null;
  onArrival?: () => void;
}) {
  const trpc = useTRPC();
  // Kept past the arrival that brought it, because the field it is for
  // mounts only once the page's read lands; the window's copy is spent now,
  // so coming back to this address later is an ordinary visit.
  const [writing] = useState(writeOnArrival);
  useEffect(() => {
    if (writeOnArrival !== null) onArrival?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);
  const page = useQuery(trpc.experiments.page.queryOptions({ path }));
  // The file waiting for its caption, from *+ artifact* or a drop.
  const [adding, setAdding] = useState<string | null>(null);
  const status = useVaultStatusLines();
  const [attaching, setAttaching] = useState(false);

  const data = page.data;
  const { sectionRef, removed, resolved } = usePageFrame(
    "experiment",
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
      aria-label="Experiment view"
      tabIndex={-1}
      // A file dropped anywhere on the page is an Artifact for this run
      // (story 28), and so is a link dragged from a browser — a W&B panel,
      // a bucket — which can only be linked. A file's path comes from the
      // preload: a page is never told where a dropped file lives.
      onDragOver={(event) => {
        const { types } = event.dataTransfer;
        if (
          readable !== null &&
          (types.includes("Files") || types.includes("text/uri-list"))
        ) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        if (readable === null) return;
        const file = event.dataTransfer.files[0];
        const source =
          file === undefined
            ? firstUri(event.dataTransfer.getData("text/uri-list"))
            : window.vitrine.pathOf(file);
        if (source === "") return;
        event.preventDefault();
        setAdding(source);
      }}
    >
      <FrameLines
        error={page.isError ? page.error : null}
        removed={removed}
        resolved={resolved}
        data={data}
      />
      {readable !== null && (
        <div className={styles.panes}>
          <div className={rq.scroll}>
            <Header
              path={readable.path}
              hash={readable.hash}
              frontmatter={readable.frontmatter}
              onAttach={() => setAttaching(true)}
            />
            <Section name="Purpose" present={readable.sections.purpose.present}>
              <PositionField
                position={{ kind: "experiment", field: "purpose" }}
                path={readable.path}
                hash={readable.hash}
                text={readable.sections.purpose.text}
                labelledBy={sectionId("Purpose")}
                withWhy={false}
                // A run just made opens where the writing starts (spec #362
                // story 5); any other arrival leaves the keyboard with the page.
                autoFocus={writing === "purpose"}
                empty={
                  <Outline>
                    Nothing yet. What you are trying to find out — looser than a
                    claim is fine: see whether X matters at all.
                  </Outline>
                }
              />
            </Section>
            <Section name="Design" present={readable.sections.design.present}>
              <PositionField
                position={{ kind: "experiment", field: "design" }}
                path={readable.path}
                hash={readable.hash}
                text={readable.sections.design.text}
                labelledBy={sectionId("Design")}
                empty={
                  <Outline>
                    Written before the run: what is varied, what is held, and
                    how it is measured. Its revisions are kept, so a design
                    changed after the run shows.
                  </Outline>
                }
              />
            </Section>
            <Artifacts
              path={readable.path}
              section={readable.sections.artifacts}
              adding={adding}
              onAdding={setAdding}
            />
            <Section
              name="Observations"
              present={readable.sections.observations.present}
            >
              <PositionField
                position={{ kind: "experiment", field: "observations" }}
                path={readable.path}
                hash={readable.hash}
                text={readable.sections.observations.text}
                labelledBy={sectionId("Observations")}
                autoFocus={writing === "observations"}
                empty={
                  <Outline>
                    Written after the run, and revisable — interpretation
                    changes more often than data does.
                  </Outline>
                }
              />
            </Section>
          </div>
          <aside className={styles.rail} aria-label="About this run">
            <WhereItRan
              path={readable.path}
              hash={readable.hash}
              section={readable.sections.whereItRan}
            />
            <AttachedAsEvidence evidence={readable.evidence} />
            {readable.cameFrom !== null && (
              <CameFromSection cameFrom={readable.cameFrom} />
            )}
            <QuestionsFromThisRun questions={readable.questions} />
            <Section
              name="Position history"
              present={readable.sections.positionHistory.present}
            >
              <PositionHistory
                rail
                entries={readable.sections.positionHistory.entries}
                current={{
                  design: readable.sections.design.text,
                  observations: readable.sections.observations.text,
                }}
                // A why onto any entry, months later (spec #362 story 15):
                // the page's own hash, because no save of the page's stands
                // between the read and this write.
                whyLine={({ at, field }, close) => (
                  <WhyLine
                    kind="experiment"
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
          </aside>
        </div>
      )}
      {readable !== null && attaching && (
        <AttachEvidence
          experiment={readable.path}
          onClose={() => setAttaching(false)}
        />
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

/**
 * The kicker: the Kind, the four statuses the user sets, and the caption
 * that says whose call it is (TEST-10) — then the name the run goes by in
 * the user's code and W&B, in the mono it is typed in there.
 */
function Header({
  path,
  hash,
  frontmatter,
  onAttach,
}: {
  path: string;
  hash: string;
  frontmatter: ExperimentFrontmatter;
  onAttach: () => void;
}) {
  return (
    <header className={rq.header}>
      <div className={rq.kicker}>
        <span>Experiment</span>
        <StatusChips
          path={path}
          hash={hash}
          status={frontmatter.status}
          unreadable={frontmatter.statusUnreadable}
        />
        <button type="button" className={styles.action} onClick={onAttach}>
          attach as evidence
        </button>
      </div>
      <p className={styles.name}>
        <span>{frontmatter.name}</span>
        {frontmatter.created !== undefined && (
          <span className={styles.created}>
            created {localDate(frontmatter.created)}
          </span>
        )}
      </p>
    </header>
  );
}

const STATUSES: readonly ExperimentStatus[] = [
  "planned",
  "running",
  "complete",
  "abandoned",
];

/**
 * The status as four chips, the file's one checked — none when the file
 * records none or one the vocabulary cannot read, which is then named
 * rather than shown as nothing chosen. A choice is one `setFrontmatter`
 * and never a Revision (spec #362 story 20); the page re-reads on the own
 * write's event, and a refusal is a line beside the chips.
 */
function StatusChips({
  path,
  hash,
  status,
  unreadable,
}: {
  path: string;
  hash: string;
  status: ExperimentStatus | null;
  unreadable: string | null;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [refusal, setRefusal] = useState<string | null>(null);
  // One group per page mounted, whatever else the window holds.
  const group = useId();
  const set = useMutation(
    trpc.experiments.setStatus.mutationOptions({
      onSuccess: (result) => {
        if (!result.written) {
          setRefusal(`could not set the status: ${result.detail}`);
          return;
        }
        setRefusal(null);
        void queryClient.invalidateQueries(
          trpc.experiments.page.queryFilter({ path })
        );
      },
      onError: (error) =>
        setRefusal(`could not set the status: ${error.message}`),
    })
  );
  return (
    <>
      <div role="radiogroup" aria-label="Status" className={styles.chips}>
        {STATUSES.map((value) => (
          <label key={value} className={styles.chip}>
            <input
              type="radio"
              name={group}
              value={value}
              checked={status === value}
              onChange={() =>
                set.mutate({ path, status: value, basedOn: hash })
              }
            />
            {value}
          </label>
        ))}
      </div>
      <span className={styles.caption}>
        you set this — the app never changes it
      </span>
      {unreadable !== null && (
        <span className={styles.caption}>status unreadable: {unreadable}</span>
      )}
      {refusal !== null && (
        <span role="status" className={rq.inKicker}>
          {refusal}
        </span>
      )}
    </>
  );
}

/**
 * *Where it ran* (spec #362 story 17): the file's `label: value` lines drawn
 * as labels and values, the labels the user's own; *edit* opens the lines
 * as text, saved whole with no Revision (story 18), and they are drawn
 * again once the field has nothing left to hold. With nothing written yet
 * the field is open from the start, since there is nothing else to show.
 */
function WhereItRan({
  path,
  hash,
  section,
}: {
  path: string;
  hash: string;
  section: ExperimentSections["whereItRan"];
}) {
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const reading = !editing && section.lines.length > 0;
  // The keyboard goes back to *edit* when the field closes on it.
  const wasEditing = useRef(false);
  useEffect(() => {
    if (!editing && wasEditing.current) editRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  return (
    <Section
      name="Where it ran"
      present={section.present}
      action={
        reading && (
          <button
            ref={editRef}
            type="button"
            className={rq.edit}
            onClick={() => setEditing(true)}
          >
            edit
          </button>
        )
      }
    >
      {reading ? (
        <dl className={styles.lines}>
          {section.lines.map(({ label, value }, i) => (
            <div key={i} className={styles.line}>
              {label === null ? (
                <dd className={styles.unlabelled}>{value}</dd>
              ) : (
                <>
                  <dt className={styles.lineLabel}>{label}</dt>
                  <dd className={styles.lineValue}>{value}</dd>
                </>
              )}
            </div>
          ))}
        </dl>
      ) : (
        <PositionField
          position={{ kind: "experiment", field: "where it ran" }}
          path={path}
          hash={hash}
          text={section.text}
          labelledBy={sectionId("Where it ran")}
          withWhy={false}
          autoFocus={editing}
          onDone={() => setEditing(false)}
          className={styles.where}
          empty={
            <Outline>
              One line each, labels your own — repo, commit, entry, config,
              w&amp;b, out.
            </Outline>
          }
        />
      )}
    </Section>
  );
}

/**
 * Every Criterion this run is Evidence for (spec #362 stories 22–24), read
 * back from the Hypotheses — each with its label, Relationship and Outcome,
 * the claim, and the note written for it, and each opening its Hypothesis.
 * A run that bears on no claim says so as a plain fact: most runs never
 * attach, and one that doesn't is not unfinished business (HOLD-6).
 */
function AttachedAsEvidence({ evidence }: { evidence: EvidenceFor[] }) {
  return (
    <Section name="Attached as evidence" present>
      {evidence.length === 0 ? (
        <p className={styles.quiet}>
          Nothing. Most runs never bear on a claim, and a run that doesn&rsquo;t
          is not unfinished.
        </p>
      ) : (
        <ul className={styles.evidence}>
          {evidence.map(({ hypothesis, criterion, note }, i) => (
            <li key={i}>
              <a
                className={styles.attachment}
                href={addressOf("hypothesis", hypothesis.path) ?? undefined}
                data-relationship={criterion.relationship ?? undefined}
              >
                <span className={styles.attachmentLabel}>
                  {criterionName(criterion)}
                </span>
                <span className={styles.caption}>{standing(criterion)}</span>
                <span className={styles.attachmentClaim}>
                  {hypothesis.claim}
                </span>
                <span className={styles.attachmentNote}>{note}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * What prompted the run (spec #362 story 25), named by its Display name
 * and opened where it has a page; a link that lands nowhere says so as
 * written rather than disappearing.
 */
function CameFromSection({ cameFrom }: { cameFrom: CameFrom }) {
  const address =
    cameFrom.path === null ? null : addressOf(cameFrom.kind, cameFrom.path);
  const name = cameFrom.display ?? cameFrom.text;
  const mark = cameFrom.kind === null ? undefined : markOf(cameFrom.kind);
  return (
    <Section name="Came from" present>
      <p className={styles.cameFrom}>
        {address === null ? <span>{name}</span> : <a href={address}>{name}</a>}
        <span className={styles.caption}>
          {cameFrom.path === null
            ? "lands on nothing in the vault"
            : (mark?.label ?? cameFrom.kind)}
        </span>
      </p>
    </Section>
  );
}

/**
 * The Questions that name this run (#373; spec #362 stories 68–71): read
 * by backlink, since a capture from a run writes nothing onto it. One
 * captured here or with `Q` in the Experiment Inbox is `observing`; a
 * `from:` written by hand only names the run, and is said so.
 */
function QuestionsFromThisRun({ questions }: { questions: RelatedQuestion[] }) {
  return (
    <Section name="Questions from this run" present>
      {questions.length === 0 ? (
        <p className={styles.quiet}>
          None yet. A question captured here lands in the Inbox, and is listed
          here.
        </p>
      ) : (
        <ul className={styles.questions}>
          {questions.map((q) => (
            <li key={q.path} className={styles.question}>
              <a href={addressOf("question", q.path) ?? undefined}>
                {q.question}
              </a>
              <span className={styles.caption}>
                {[
                  "question",
                  // Dated as prototype 05's rail dates it: when the
                  // wondering happened is part of where it came from.
                  q.context === "observing"
                    ? `captured ${localDate(q.captured)} from this run`
                    : "names this run",
                  ...(q.status === "open" ? [] : [q.status]),
                ].join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** The history's floor, derived from the frontmatter and never written as an entry. */
function baseLine(fm: ExperimentFrontmatter): string {
  return fm.created === undefined
    ? "written directly"
    : `created ${localDate(fm.created)}`;
}

/** A `text/uri-list`'s first URL: one per line, `#` lines are comments (RFC 2483). */
function firstUri(list: string): string {
  return (
    list
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line !== "" && !line.startsWith("#")) ?? ""
  );
}
