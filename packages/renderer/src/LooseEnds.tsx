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

/** What a row marked deliberate says, in prototype 9's own words. */
const MARKED =
  "marked deliberate — permanently out of this list, still in the vault";

/** What a row's resolution and its refusal are remembered by, for this visit. */
const keyOf = (row: { kind: string; subject: string }) =>
  `${row.kind}:${row.subject}`;

/** The same map of rows without this one. */
const omit = <T,>(map: Record<string, T>, key: string): Record<string, T> => {
  const rest = { ...map };
  delete rest[key];
  return rest;
};

export function LooseEnds({ onAttach }: { onAttach: (path: string) => void }) {
  const trpc = useTRPC();
  const ends = useQuery(trpc.looseEnds.rows.queryOptions());
  // What was resolved during this visit, and what a resolution was refused
  // for. Both are this visit's alone: the resolution is in the vault from the
  // click onward, so the row is gone on the next read — until then this is
  // what keeps it on screen with a way back.
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [refused, setRefused] = useState<Record<string, string>>({});
  const forget = (key: string) => setRefused((refusals) => omit(refusals, key));

  // Neither resolution invalidates the rows: a re-read would drop the row
  // the user just resolved, and with it the undo this whole slice is for.
  const dismiss = useMutation(
    trpc.looseEnds.dismiss.mutationOptions({
      onMutate: (input) => forget(keyOf(input)),
      onSuccess: (_reply, input) =>
        setResolved((marked) => ({ ...marked, [keyOf(input)]: MARKED })),
      onError: (error, input) =>
        setRefused((refusals) => ({
          ...refusals,
          [keyOf(input)]: error.message,
        })),
    })
  );
  const undo = useMutation(
    trpc.looseEnds.undismiss.mutationOptions({
      onMutate: (input) => forget(keyOf(input)),
      onSuccess: (_reply, input) =>
        setResolved((marked) => omit(marked, keyOf(input))),
      onError: (error, input) =>
        setRefused((refusals) => ({
          ...refusals,
          [keyOf(input)]: error.message,
        })),
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
          const open = rows.filter(
            (row) => resolved[keyOf(row)] === undefined
          ).length;
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
                    resolved={resolved[keyOf(row)]}
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
  /** What this row says now it is resolved; undefined while it is still open. */
  resolved: string | undefined;
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
        {resolved === undefined ? (
          <p className={styles.why}>{why}</p>
        ) : (
          <p className={styles.resolved}>{resolved}</p>
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
        {resolved === undefined ? (
          <>
            {actions}
            <button type="button" className={styles.action} onClick={onDismiss}>
              mark deliberate
            </button>
          </>
        ) : (
          <button type="button" className={styles.action} onClick={onUndo}>
            undo
          </button>
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
