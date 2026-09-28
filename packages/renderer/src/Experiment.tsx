import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CameFrom, ExperimentFrontmatter, ExperimentStatus } from "core";
import { useState } from "react";
import styles from "./Experiment.module.css";
import { addressOf, markOf } from "./kinds";
import { FrameLines, usePageFrame } from "./page-frame";
import { PositionField } from "./PositionField";
import { PositionHistory } from "./PositionHistory";
import { describeProblem, Outline, Section } from "./ResearchQuestion";
import rq from "./ResearchQuestion.module.css";
import { localDate } from "./rows";
import { useTRPC } from "./trpc";
import { useVaultStatusLines } from "./VaultStatusLines";

/**
 * The Experiment view (brief § Experiment; prompt 5; prototype 05), at
 * `#/experiment/<path>` (ADR 0026): the hand-set status, the name, Purpose,
 * Design, Artifacts and Observations in the column, and *where it ran*,
 * *came from* and the history in the rail beside it. Purpose and *where it
 * ran* are Edited sections, saved as typed with no Revision (spec #362
 * story 18); Design and Observations are Positions, shown here as the file
 * holds them until their own editing lands with their history (#365).
 *
 * A planned run is a finished plan, not a page with gaps (TEST-9): every
 * empty region says what will go in it.
 *
 * The frame — the page read's lines, the rename and removal handling, the
 * arrival that did not resolve — is `page-frame.tsx`, as every page's is.
 */
export function Experiment({ path }: { path: string }) {
  const trpc = useTRPC();
  const page = useQuery(trpc.experiments.page.queryOptions({ path }));
  const status = useVaultStatusLines();

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
            />
            <Section name="Purpose" present={readable.sections.purpose.present}>
              <PositionField
                position={{ kind: "experiment", field: "purpose" }}
                path={readable.path}
                hash={readable.hash}
                text={readable.sections.purpose.text}
                labelledBy="rq-purpose"
                withWhy={false}
                // A run with no purpose written is one just made, or one
                // asking for it: the keyboard goes where the writing starts
                // (spec #362 story 5).
                autoFocus={readable.sections.purpose.text === ""}
                empty={
                  <Outline>
                    Nothing yet. What you are trying to find out — looser than a
                    claim is fine: see whether X matters at all.
                  </Outline>
                }
              />
            </Section>
            <Section name="Design" present={readable.sections.design.present}>
              <Written
                text={readable.sections.design.text}
                empty="Written before the run: what is varied, what is held, and how it is measured. Its revisions are kept, so a design changed after the run shows."
              />
            </Section>
            <Section
              name="Artifacts"
              present={readable.sections.artifacts.present}
            >
              <Written
                text={readable.sections.artifacts.text}
                empty="Nothing yet. Plots and snippets added here are stored in the vault beside the run; anything over 25 MB is linked, with a warning."
              />
            </Section>
            <Section
              name="Observations"
              present={readable.sections.observations.present}
            >
              <Written
                text={readable.sections.observations.text}
                empty="Written after the run, and revisable — interpretation changes more often than data does."
              />
            </Section>
          </div>
          <aside className={styles.rail} aria-label="About this run">
            <Section
              name="Where it ran"
              present={readable.sections.whereItRan.present}
            >
              <PositionField
                position={{ kind: "experiment", field: "where it ran" }}
                path={readable.path}
                hash={readable.hash}
                text={readable.sections.whereItRan.text}
                labelledBy="rq-where-it-ran"
                withWhy={false}
                className={styles.where}
                empty={
                  <Outline>
                    One line each, labels your own — repo, commit, entry,
                    config, w&amp;b, out.
                  </Outline>
                }
              />
            </Section>
            {readable.cameFrom !== null && (
              <CameFromSection cameFrom={readable.cameFrom} />
            )}
            <Section
              name="Position history"
              present={readable.sections.positionHistory.present}
            >
              <PositionHistory
                entries={readable.sections.positionHistory.entries}
                current={{
                  design: readable.sections.design.text,
                  observations: readable.sections.observations.text,
                }}
              />
              <p className={rq.baseLine}>{baseLine(readable.frontmatter)}</p>
            </Section>
          </aside>
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

/**
 * The kicker: the Kind, the four statuses the user sets, and the caption
 * that says whose call it is (TEST-10) — then the name the run goes by in
 * the user's code and W&B, in the mono it is typed in there.
 */
function Header({
  path,
  hash,
  frontmatter,
}: {
  path: string;
  hash: string;
  frontmatter: ExperimentFrontmatter;
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
              name="experiment-status"
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

/** A section the page shows as the file holds it, or the sentence on what will go there. */
function Written({ text, empty }: { text: string; empty: string }) {
  if (text === "") return <Outline>{empty}</Outline>;
  return <p className={styles.written}>{text}</p>;
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

/** The history's floor, derived from the frontmatter and never written as an entry. */
function baseLine(fm: ExperimentFrontmatter): string {
  return fm.created === undefined
    ? "written directly"
    : `created ${localDate(fm.created)}`;
}
