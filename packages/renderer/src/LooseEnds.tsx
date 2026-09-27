import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LooseEndGroupName,
  LooseEndRow,
  StalledResearchQuestion,
} from "core";
import { formatAge } from "./age";
import styles from "./LooseEnds.module.css";
import { hashOf } from "./router";
import { useTRPC } from "./trpc";

/**
 * The Loose Ends dashboard (brief § Loose Ends; prompt 9): a punch list of
 * what is incomplete or broken, so none of it has to be remembered. Counts
 * per group and never a total — one figure for everything turns maintenance
 * into debt — and a group with no rows is not drawn at all rather than
 * shown as a cheerful zero.
 *
 * Every row is a link to the object it names and carries its one-click
 * resolutions, one of which is always *mark deliberate*: a list that cannot
 * be told "this one is fine" fills with noise and stops being opened.
 */

/** Each group's glyph and the line beside it, from prompt 9's punch-list reading. */
const GROUPS: Record<LooseEndGroupName, { glyph: string; note: string }> = {
  "Broken plumbing": { glyph: "!", note: "these worsen while ignored" },
  "Unfinished reading": { glyph: "◇", note: "acquired but not yet read" },
  "Disconnected material": {
    glyph: "·",
    note: "in the vault, wired to nothing",
  },
  "Stalled questions": { glyph: "◆", note: "promoted, then quiet" },
};

export function LooseEnds({ onAttach }: { onAttach: (path: string) => void }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const ends = useQuery(trpc.looseEnds.rows.queryOptions());
  const dismiss = useMutation(
    trpc.looseEnds.dismiss.mutationOptions({
      // A dismissal changes no vault file, so nothing on the event stream
      // announces it: the dashboard re-reads itself.
      onSettled: () =>
        void queryClient.invalidateQueries(trpc.looseEnds.rows.pathFilter()),
    })
  );

  const groups = ends.data?.groups ?? [];
  const problems = ends.data?.problems ?? [];
  const now = new Date();

  return (
    <section className={styles.dashboard} aria-labelledby="loose-ends-title">
      <div className={styles.header}>
        <h1 id="loose-ends-title" className={styles.title}>
          Loose Ends
        </h1>
      </div>
      {ends.isError && (
        <p className={styles.problem} role="alert">
          {ends.error.message}
        </p>
      )}
      {/* What the dashboard could not judge — a row the user silenced may
          be here, or one that belongs here may be missing. A failure to
          report, not one to swallow. */}
      {problems.map((problem) => (
        <p key={problem} className={styles.problem} role="alert">
          <span className={styles.problemGlyph} aria-hidden="true">
            !
          </span>{" "}
          {problem}
        </p>
      ))}
      {dismiss.isError && (
        <p className={styles.problem} role="alert">
          {dismiss.error.message}
        </p>
      )}
      {groups.length === 0 && !ends.isPending && !ends.isError && (
        <p className={styles.quiet}>
          Nothing to tidy that the app can see yet.
        </p>
      )}
      <div className={styles.scroll}>
        {groups.map(({ group, rows }) => (
          <section
            key={group}
            className={styles.group}
            aria-labelledby={`loose-ends-${group}`}
          >
            <div className={styles.groupHeader}>
              <span className={styles.glyph} aria-hidden="true">
                {GROUPS[group].glyph}
              </span>
              <h2 id={`loose-ends-${group}`} className={styles.groupTitle}>
                {group}
              </h2>
              <span className={styles.count}>
                {rows.length === 1 ? "1 item" : `${rows.length} items`}
              </span>
              <span className={styles.note}>{GROUPS[group].note}</span>
            </div>
            <ul className={styles.rows}>
              {rows.map((row) => (
                <Row
                  key={`${row.kind}:${row.subject}`}
                  row={row}
                  now={now}
                  onAttach={() => onAttach(row.path)}
                  onDismiss={() =>
                    dismiss.mutate({ subject: row.subject, kind: row.kind })
                  }
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}

/**
 * One component per row kind: each kind words its own line and carries its
 * own resolutions. The switch is exhaustive on purpose — a later beat's row
 * kind is a type error here until it has been given a row of its own, rather
 * than falling silently into another kind's wording.
 */
function Row(props: {
  row: LooseEndRow;
  now: Date;
  onAttach: () => void;
  onDismiss: () => void;
}) {
  switch (props.row.kind) {
    case "stalled-research-question":
      return <Stalled {...props} row={props.row} />;
  }
}

/** *Promoted, then quiet*: the page, how long it has been waiting, and the two ways out. */
function Stalled({
  row,
  now,
  onAttach,
  onDismiss,
}: {
  row: StalledResearchQuestion;
  now: Date;
  onAttach: () => void;
  onDismiss: () => void;
}) {
  return (
    <li className={styles.row}>
      <div className={styles.body}>
        <p className={styles.meta}>
          research question · promoted {formatAge(row.since, now)}
        </p>
        <a
          className={styles.rowTitle}
          href={hashOf({ surface: "questions", path: row.path })}
        >
          {row.title}
        </a>
        <p className={styles.why}>
          No source on either side since it was promoted.
        </p>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onAttach}>
          attach a source
        </button>
        <button type="button" className={styles.action} onClick={onDismiss}>
          mark deliberate
        </button>
      </div>
    </li>
  );
}
