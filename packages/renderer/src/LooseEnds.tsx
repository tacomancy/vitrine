import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  AmbiguousLinks,
  LooseEndGroupName,
  LooseEndRow,
  MissingArtifacts,
  StalledExperiment,
  StalledHypothesis,
  StalledResearchQuestion,
} from "core";
import { formatAge } from "./age";
import { FirstSlot, voiceOf } from "./FirstSlot";
import { useState, type ReactNode } from "react";
import { addressOf, KIND, markOf } from "./kinds";
import styles from "./LooseEnds.module.css";
import { hashOf } from "./router";
import { useTRPC } from "./trpc";
import { useVaultStatusLines, WarningLine } from "./VaultStatusLines";

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
 * The group heading's id. `aria-labelledby` is a space-separated list of
 * ids, so a group name with a space in it — every one of the four — would
 * name two ids that do not exist and leave the section unlabelled.
 */
const headingId = (group: LooseEndGroupName) =>
  `loose-ends-${group.replace(/\s+/g, "-")}`;

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

/**
 * Where one row stands with this visit's resolutions, passed through its kind
 * to the shell. Every kind carries it, so a row a later beat adds inherits
 * the undo rather than deciding it again.
 */
type Resolution = {
  resolved: boolean;
  /** What the core refused, when it refused; shown on this row alone. */
  refused: string | undefined;
  onDismiss: () => void;
  onUndo: () => void;
};

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

  const status = useVaultStatusLines();
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
      {groups.length === 0 && (
        <FirstSlot
          voice={voiceOf({
            // A problem is something the dashboard could not judge — a row
            // that belongs here may be missing — so it forbids the claim.
            incomplete: ends.isError || problems.length > 0,
            answered: ends.data !== undefined,
            read: status.read,
          })}
          // Prototype 12 kept *that the app can see*, which sets the limit of
          // the claim, and dropped *yet*, which sounded like a promise.
          claim="Nothing is loose that the app can see."
        >
          {/* Scope, not a checklist: the empty page still reads as the
              maintenance surface rather than one that failed to render. */}
          This page gathers what has come apart or gone quiet — Scouts that stop
          returning, links and files that no longer land, sources acquired and
          never opened, material wired to nothing, questions promoted and then
          left alone. Each kind appears as its own group only when there is
          something in it.
        </FirstSlot>
      )}
      <div className={styles.scroll}>
        {groups.map(({ group, rows }) => {
          // The count is of the rows still open: it drops as one is resolved
          // and returns with its undo. *Clear* rather than a zero, because a
          // group still drawn only for a row just resolved has nothing left
          // to count (prototype 9).
          const open = rows.filter((row) => !resolved.has(keyOf(row))).length;
          return (
            <section
              key={group}
              className={styles.group}
              aria-labelledby={headingId(group)}
            >
              <div className={styles.groupHeader}>
                <span className={styles.glyph} aria-hidden="true">
                  {GROUPS[group].glyph}
                </span>
                <h2 id={headingId(group)} className={styles.groupTitle}>
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
                    resolution={{
                      resolved: resolved.has(keyOf(row)),
                      refused: refused[keyOf(row)],
                      onDismiss: () =>
                        dismiss.mutate({
                          subject: row.subject,
                          kind: row.kind,
                        }),
                      onUndo: () =>
                        undo.mutate({ subject: row.subject, kind: row.kind }),
                    }}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {/* The footer channel, drawn only when there is something to say
          (prototype 12, 5a). Everything here is a state the app is in, not a
          refusal of the user's act, so it is polite: `alert` is kept for a
          row whose resolution was refused (ADR 0033). */}
      {(status.hasLines || ends.isError || problems.length > 0) && (
        <footer className={styles.footer}>
          {status.lines}
          {ends.isError && (
            <WarningLine label="not read">{ends.error.message}</WarningLine>
          )}
          {problems.map((problem) => (
            <WarningLine key={problem} label="could not judge">
              {problem}
            </WarningLine>
          ))}
        </footer>
      )}
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
  resolution: Resolution;
}) {
  switch (props.row.kind) {
    case "stalled-research-question":
      return <Stalled {...props} row={props.row} />;
    case "stalled-hypothesis":
      return <QuietHypothesis row={props.row} resolution={props.resolution} />;
    case "ambiguous-link":
      return <Ambiguous row={props.row} resolution={props.resolution} />;
    case "stalled-experiment":
      return <QuietExperiment row={props.row} resolution={props.resolution} />;
    case "missing-artifact":
      return <MissingFiles row={props.row} resolution={props.resolution} />;
  }
}

/**
 * The chrome every row wears (prompt 9's punch list): what kind of thing
 * this is, the object it names, why it is here, and the ways out on the
 * right. Each row kind fills it and adds whatever only it has.
 *
 * `href` is what makes the title a link — story 52's "every row is a link
 * to the object it names" — and its absence is what an object with no
 * surface yet looks like: named, never a title that feigns a click.
 *
 * Resolving one of these changes state, so the shell is also where the way
 * back lives (#266): a resolved row keeps its place and its link, says what
 * happened in place of why it was here, puts away the detail it was carrying
 * — the decision about it is made — and offers *undo* as its only action.
 * Every row kind gets that by filling the shell, rather than deciding it.
 */
function RowShell({
  meta,
  title,
  href,
  why,
  actions,
  children,
  loud,
  resolution: { resolved, refused, onUndo },
}: {
  meta: ReactNode;
  title: string;
  href?: string;
  why: ReactNode;
  actions: ReactNode;
  children?: ReactNode;
  /** A tag drawn above the row, amber, for the rows that must never read as quiet. */
  loud?: string;
  resolution: Resolution;
}) {
  return (
    <li
      className={styles.row}
      // Put away once resolved, with the rest of the row's detail: the
      // decision about it is made, and an amber row that says so is noise.
      data-loud={(loud !== undefined && !resolved) || undefined}
    >
      <div className={styles.body}>
        {loud !== undefined && !resolved && (
          <p className={styles.loudTag}>{loud}</p>
        )}
        <p className={styles.meta}>{meta}</p>
        {href === undefined ? (
          <span className={styles.rowTitle}>{title}</span>
        ) : (
          <a className={styles.rowTitle} href={href}>
            {title}
          </a>
        )}
        {resolved ? (
          <p className={styles.resolved}>{MARKED}</p>
        ) : (
          <>
            <p className={styles.why}>{why}</p>
            {children}
          </>
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
          actions
        )}
      </div>
    </li>
  );
}

/** *Promoted, then quiet*: the page, how long it has been waiting, and the two ways out. */
function Stalled({
  row,
  now,
  onAttach,
  resolution,
}: {
  row: StalledResearchQuestion;
  now: Date;
  onAttach: () => void;
  resolution: Resolution;
}) {
  return (
    <RowShell
      meta={`research question · promoted ${formatAge(row.since, now)}`}
      title={row.title}
      href={hashOf({ surface: "research-question", path: row.path })}
      why="No source on either side since it was promoted."
      resolution={resolution}
      actions={
        <>
          <button type="button" className={styles.primary} onClick={onAttach}>
            attach a source
          </button>
          <Deliberate onDismiss={resolution.onDismiss} />
        </>
      }
    />
  );
}

/**
 * *A Hypothesis gone quiet with criteria untested* (spec #327 stories
 * 81–85; REP-9): a commitment coming back, so the row says how much of the
 * test is still unrun and how long it has sat, and nothing about it being
 * late. Quiet is in open days, as the core judged it — a calendar age here
 * would contradict the rule that put the row on screen (REP-11).
 */
function QuietHypothesis({
  row,
  resolution,
}: {
  row: StalledHypothesis;
  resolution: Resolution;
}) {
  const address = hashOf({ surface: "hypothesis", path: row.path });
  const days = row.quietOpenDays === 1 ? "open day" : "open days";
  const noun = row.criteria === 1 ? "criterion" : "criteria";
  const untested =
    row.criteria === 0
      ? "No criteria written yet."
      : `${row.awaiting} of ${row.criteria} ${noun} awaiting evidence.`;
  return (
    <RowShell
      meta={`hypothesis · inconclusive, quiet ${row.quietOpenDays} ${days}`}
      title={row.title}
      href={address}
      // Prototype 9's own framing: the row is a reminder, not a fault.
      why={`${untested} Nothing is wrong with it — it is simply not moving.`}
      resolution={resolution}
      actions={
        <OpenOrDeliberate address={address} onDismiss={resolution.onDismiss} />
      }
    />
  );
}

/**
 * The one resolution every row carries (brief § Loose Ends): a list that
 * cannot be told "this one is fine" fills with noise and stops being
 * opened. Shared so no later row kind can ship without it.
 */
function Deliberate({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button type="button" className={styles.action} onClick={onDismiss}>
      mark deliberate
    </button>
  );
}

/**
 * *In the vault, wired to nothing*: a file whose `[[name]]` matches several
 * files, so the link resolves to nothing rather than to whichever the index
 * happened to reach first. The row names the file, the name, and every file
 * the name reached, because *which two?* is the whole question.
 *
 * One row per linking file: a dismissal is keyed by the file and the row
 * kind, so a second row about the same file under this kind could not be
 * silenced on its own. The names are listed inside the one row instead.
 *
 * The path-qualified rewrite that would fix it in the file is beat 11's —
 * it edits the user's prose, which no write operation does. Until then the
 * resolutions are *open*, for a file that has a surface, and *mark
 * deliberate*.
 */
function Ambiguous({
  row,
  resolution,
}: {
  row: AmbiguousLinks;
  resolution: Resolution;
}) {
  const address = addressOf(row.linkingKind, row.path) ?? undefined;
  // A `kind:` the app does not know is stored verbatim (§ Index, Reads), so
  // it is shown verbatim rather than passed off as a Note; a file with none
  // is a Note, which is what having no `kind:` means.
  const kind = row.linkingKind;
  const label = kind === null ? KIND.note.label : (markOf(kind)?.label ?? kind);
  return (
    <RowShell
      // The file is named whether or not it can be opened: a row that could
      // only say *somewhere in your vault* would be no help.
      meta={`${label} · ${row.path}`}
      title={row.title}
      {...(address === undefined ? {} : { href: address })}
      resolution={resolution}
      why={
        row.links.length === 1
          ? "A name here matches more than one file, so the link lands nowhere."
          : `${row.links.length} names here each match more than one file, so the links land nowhere.`
      }
      actions={
        <>
          {address !== undefined && (
            <a className={styles.primary} href={address}>
              open
            </a>
          )}
          <Deliberate onDismiss={resolution.onDismiss} />
        </>
      }
    >
      <ul className={styles.matches}>
        {row.links.map((link) => (
          <li key={link.target} className={styles.match}>
            <span className={styles.target}>[[{link.target}]]</span>
            {link.candidates.map((candidate) => (
              <span key={candidate} className={styles.candidate}>
                {candidate}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </RowShell>
  );
}

/** *open* and *mark deliberate*: what a row whose object has a page offers. */
function OpenOrDeliberate({
  address,
  onDismiss,
}: {
  address: string;
  onDismiss: () => void;
}) {
  return (
    <>
      <a className={styles.primary} href={address}>
        open
      </a>
      <Deliberate onDismiss={onDismiss} />
    </>
  );
}

/**
 * *A run complete with Artifacts and nothing written about them* (spec
 * #362 stories 73–74; REP-9): a result never read, coming back. Quiet in
 * open days, as the core judged it, and nothing about whether it is
 * attached — a run that bears on no claim is not unfinished (HOLD-6).
 */
function QuietExperiment({
  row,
  resolution,
}: {
  row: StalledExperiment;
  resolution: Resolution;
}) {
  const address = hashOf({ surface: "experiment", path: row.path });
  const days = row.quietOpenDays === 1 ? "open day" : "open days";
  const artifacts = row.artifacts === 1 ? "Artifact" : "Artifacts";
  return (
    <RowShell
      meta={`experiment · complete, quiet ${row.quietOpenDays} ${days}`}
      title={row.title}
      href={address}
      why={`${row.artifacts} ${artifacts} and no observations written. Nothing is wrong with it — its result is simply unread.`}
      resolution={resolution}
      actions={
        <OpenOrDeliberate address={address} onDismiss={resolution.onDismiss} />
      }
    />
  );
}

/**
 * *Linked Artifacts gone from where they were linked* (spec #362 stories
 * 75–77; REP-6): only this machine's links, as the core checked them. One
 * row per run, listing each file, since a dismissal cannot be finer.
 *
 * Loud when a falsification rested on the run (story 76): the record
 * behind a claim's refutation is quietly gone, which is the one thing here
 * that must never read as routine. Amber, as every loud mark in the app
 * is — never red.
 */
function MissingFiles({
  row,
  resolution,
}: {
  row: MissingArtifacts;
  resolution: Resolution;
}) {
  const address = hashOf({ surface: "experiment", path: row.path });
  const count = row.missing.length;
  return (
    <RowShell
      meta="experiment · linked on this machine"
      title={row.title}
      href={address}
      {...(row.falsifying.length === 0
        ? {}
        : { loud: "a falsification rests on it" })}
      why={
        count === 1
          ? "A linked file is no longer where it was linked."
          : `${count} linked files are no longer where they were linked.`
      }
      resolution={resolution}
      actions={
        <OpenOrDeliberate address={address} onDismiss={resolution.onDismiss} />
      }
    >
      <ul className={styles.matches}>
        {row.missing.map((file) => (
          <li key={file.target} className={styles.match}>
            <span className={styles.target}>{file.file}</span>
            <span className={styles.candidate}>{file.target}</span>
          </li>
        ))}
      </ul>
      {row.falsifying.length > 0 && (
        <p className={styles.why}>
          Evidence for{" "}
          {row.falsifying.map((f, i) => (
            <span key={`${f.path}:${f.criterion ?? i}`}>
              {i > 0 && "; "}
              <a
                className={styles.evidenceLink}
                href={hashOf({ surface: "hypothesis", path: f.path })}
              >
                {f.criterion === null ? f.claim : `${f.criterion} · ${f.claim}`}
              </a>
            </span>
          ))}
          , with its Outcome recorded.
        </p>
      )}
    </RowShell>
  );
}
