import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  LooseEndGroupName,
  LooseEndRow,
  StalledResearchQuestion,
} from "core";
import { useState, type ReactNode } from "react";
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
 * be told "this one is fine" fills with noise and stops being opened. That
 * one changes state, so it stays undoable for as long as the row is on
 * screen (#266) — the row it resolves keeps its place and says so, rather
 * than vanishing out from under the click.
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

/**
 * What a resolved row says, in prototype 9's own words. *Mark deliberate* is
 * the only resolution that changes state today, so it is the only thing a
 * resolved row has to say.
 */
const MARKED =
  "marked deliberate — permanently out of this list, still in the vault";

/** One row: what a resolution is asked for, and what this visit remembers it by. */
type Resolving = { subject: string; kind: string };
const keyOf = (row: Resolving) => `${row.kind}:${row.subject}`;

export function LooseEnds({ onAttach }: { onAttach: (path: string) => void }) {
  const trpc = useTRPC();
  const ends = useQuery(trpc.looseEnds.rows.queryOptions());
  // Which rows were resolved during this visit, and what a resolution was
  // refused for. Both are this visit's alone: the resolution is in the vault
  // from the click onward, so the row is gone on the dashboard's next read —
  // until then this is what keeps it on screen with a way back.
  const [resolved, setResolved] = useState<ReadonlySet<string>>(new Set());
  const [refused, setRefused] = useState<Record<string, string>>({});
  const forgetRefusal = (key: string) =>
    setRefused((refusals) => {
      const rest = { ...refusals };
      delete rest[key];
      return rest;
    });

  // Both resolutions answer the same way: a refusal lands on the row it was
  // about, so one that failed cannot pass for a quiet success. And neither
  // invalidates the rows — a re-read would drop the row just resolved, and
  // with it the undo this is all for.
  const onRow = {
    onMutate: (row: Resolving) => forgetRefusal(keyOf(row)),
    // Only the message: what the core refused with is what the row says.
    onError: (error: { message: string }, row: Resolving) =>
      setRefused((refusals) => ({ ...refusals, [keyOf(row)]: error.message })),
  };
  const dismiss = useMutation(
    trpc.looseEnds.dismiss.mutationOptions({
      ...onRow,
      onSuccess: (_reply, row) =>
        setResolved((marked) => new Set(marked).add(keyOf(row))),
    })
  );
  const undo = useMutation(
    trpc.looseEnds.undismiss.mutationOptions({
      ...onRow,
      onSuccess: (_reply, row) =>
        setResolved((marked) => {
          const rest = new Set(marked);
          rest.delete(keyOf(row));
          return rest;
        }),
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
      {groups.length === 0 && !ends.isPending && !ends.isError && (
        <p className={styles.quiet}>
          Nothing to tidy that the app can see yet.
        </p>
      )}
      <div className={styles.scroll}>
        {groups.map(({ group, rows }) => {
          // The count is of the rows still open: it drops as one is resolved
          // and returns with its undo. *Clear* rather than a zero, because a
          // group only still drawn for a row just resolved has nothing to
          // count (prototype 9).
          const open = rows.filter((row) => !resolved.has(keyOf(row))).length;
          return (
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
                  {open === 0
                    ? "clear"
                    : open === 1
                      ? "1 item"
                      : `${open} items`}
                </span>
                <span className={styles.note}>{GROUPS[group].note}</span>
              </div>
              <ul className={styles.rows}>
                {rows.map((row) => (
                  <Row
                    key={keyOf(row)}
                    row={row}
                    now={now}
                    onAttach={() => onAttach(row.path)}
                    resolved={resolved.has(keyOf(row))}
                    refused={refused[keyOf(row)]}
                    onDismiss={() =>
                      dismiss.mutate({ subject: row.subject, kind: row.kind })
                    }
                    onUndo={() =>
                      undo.mutate({ subject: row.subject, kind: row.kind })
                    }
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </section>
  );
}

/**
 * One row, drawn around its kind's own face. Everything the frame holds is
 * the same for every kind — *mark deliberate*, what a resolved row says,
 * *undo*, and a refused resolution's line — so a row a later beat adds
 * inherits the undo rather than deciding it again (#266).
 */
function Row({
  row,
  now,
  onAttach,
  resolved,
  refused,
  onDismiss,
  onUndo,
}: {
  row: LooseEndRow;
  now: Date;
  onAttach: () => void;
  /** Whether this row was resolved during this visit. */
  resolved: boolean;
  /** A resolution the core refused, on the row it was refused about. */
  refused: string | undefined;
  onDismiss: () => void;
  onUndo: () => void;
}) {
  const { meta, title, href, why, actions } = face(row, now, onAttach);
  return (
    <li className={styles.row}>
      <div className={styles.body}>
        <p className={styles.meta}>{meta}</p>
        <a className={styles.rowTitle} href={href}>
          {title}
        </a>
        {/* A resolved row keeps its place and its link, and says what
            happened in place of why it was here. */}
        {resolved ? (
          <p className={styles.resolved}>{MARKED}</p>
        ) : (
          <p className={styles.why}>{why}</p>
        )}
        {refused !== undefined && (
          <p className={styles.refused} role="alert">
            <span className={styles.problemGlyph} aria-hidden="true">
              !
            </span>{" "}
            {refused}
          </p>
        )}
      </div>
      <div className={styles.actions}>
        {resolved ? (
          <button type="button" className={styles.action} onClick={onUndo}>
            undo
          </button>
        ) : (
          <>
            {actions}
            <button type="button" className={styles.action} onClick={onDismiss}>
              mark deliberate
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/** What one row kind words for itself; the frame around it is `Row`'s. */
type RowFace = {
  meta: string;
  title: string;
  href: string;
  /** Why the row is here — suppressed once it has been resolved. */
  why: ReactNode;
  /** This kind's own resolutions; *mark deliberate* belongs to every row. */
  actions: ReactNode;
};

/**
 * One face per row kind: each kind words its own line and names the
 * resolutions only it has. The switch is exhaustive on purpose — a later
 * beat's row kind is a type error here until it has a face of its own, rather
 * than falling silently into another kind's wording.
 */
function face(row: LooseEndRow, now: Date, onAttach: () => void): RowFace {
  switch (row.kind) {
    case "stalled-research-question":
      return stalled(row, now, onAttach);
  }
}

/** *Promoted, then quiet*: the page, how long it has been waiting, and the way out. */
function stalled(
  row: StalledResearchQuestion,
  now: Date,
  onAttach: () => void
): RowFace {
  return {
    meta: `research question · promoted ${formatAge(row.since, now)}`,
    title: row.title,
    href: hashOf({ surface: "questions", path: row.path }),
    why: "No source on either side since it was promoted.",
    actions: (
      <button type="button" className={styles.primary} onClick={onAttach}>
        attach a source
      </button>
    ),
  };
}
