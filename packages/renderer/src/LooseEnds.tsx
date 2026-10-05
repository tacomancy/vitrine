import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AmbiguousLinks,
  ConflictCopy,
  DocumentChanged,
  BlockedOnCredentials,
  FailedScout,
  LooseEndGroupName,
  LooseEndRow,
  MissingArtifacts,
  NoSource,
  PdfMissing,
  StalledExperiment,
  StalledHypothesis,
  StalledResearchQuestion,
  StructureChange,
  StubWithoutPdf,
  UnlinkedAnnotations,
  UnmatchedAnnotation,
  UnreadablePdf,
  UnreadableScoutFile,
} from "core";
import { formatAge } from "./age";
import { FirstSlot, voiceOf } from "./FirstSlot";
import { useState, type ReactNode } from "react";
import { addressOf, KIND, markOf } from "./kinds";
import styles from "./LooseEnds.module.css";
import { Picker } from "./Picker";
import { classifyLink } from "./link-rule";
import { hashOf, SCOUTS, SETTINGS } from "./router";
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

/**
 * Each group's glyph and the line beside it, from prompt 9's punch-list
 * reading. A note has to be true of every row its group can hold.
 * Prototype 9's *promoted, then quiet* stopped being so when runs joined
 * Stalled questions (#374): an Experiment is never promoted, and a run
 * whose linked file went missing need not be quiet — an unmounted volume
 * does it to a run in hand. What every row there shares is work begun
 * that lacks something it needs.
 */
const GROUPS: Record<LooseEndGroupName, { glyph: string; note: string }> = {
  "Broken plumbing": { glyph: "!", note: "these worsen while ignored" },
  "Unfinished reading": { glyph: "◇", note: "acquired but not yet read" },
  "Disconnected material": {
    glyph: "·",
    note: "in the vault, wired to nothing",
  },
  "Stalled questions": {
    glyph: "◆",
    note: "begun, with a piece still missing",
  },
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

/**
 * *Mark deliberate* and its undo for whichever surface draws the rows — the
 * dashboard and the Unmatched panel both, so a resolution behaves the same
 * wherever it is made (story 57).
 */
export function useResolutions() {
  const trpc = useTRPC();
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

  return {
    resolved,
    resolutionOf: (row: Resolving): Resolution => ({
      resolved: resolved.has(keyOf(row)),
      refused: refused[keyOf(row)],
      onDismiss: () => dismiss.mutate({ subject: row.subject, kind: row.kind }),
      onUndo: () => undo.mutate({ subject: row.subject, kind: row.kind }),
    }),
  };
}

export function LooseEnds({ onAttach }: { onAttach: (path: string) => void }) {
  const trpc = useTRPC();
  const ends = useQuery(trpc.looseEnds.rows.queryOptions());
  const { resolved, resolutionOf } = useResolutions();

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
                    resolution={resolutionOf(row)}
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
    case "unmatched-annotation":
      return <Unmatched row={props.row} resolution={props.resolution} />;
    case "document-changed":
      return <ChangedDocument row={props.row} resolution={props.resolution} />;
    case "conflict-copy":
      return <ConflictCopyRow row={props.row} resolution={props.resolution} />;
    case "pdf-missing":
      return <PdfMissingRow row={props.row} resolution={props.resolution} />;
    case "unlinked-annotations":
      return <UnlinkedSource row={props.row} resolution={props.resolution} />;
    case "no-source":
      return <NoSourcePdf row={props.row} resolution={props.resolution} />;
    case "unreadable-pdf":
      return <UnreadablePdfRow row={props.row} resolution={props.resolution} />;
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
    case "failed-scout":
      return <BrokenScout row={props.row} resolution={props.resolution} />;
    case "structure-change":
      return <ChangedPage row={props.row} resolution={props.resolution} />;
    case "blocked-on-credentials":
      return <BlockedScout row={props.row} resolution={props.resolution} />;
    case "unreadable-scout":
      return <UnreadableScout row={props.row} resolution={props.resolution} />;
    case "stub-without-pdf":
      return <BareStub row={props.row} resolution={props.resolution} />;
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
 * *A Scout whose newest run failed* (#453; spec #447 stories 82–89). The
 * sentence is the core's, the same string the rail renders; this row adds
 * the error kind and the ways out, and words nothing of its own about the
 * fault. There is no *mark deliberate*: a failure that is fine is a Scout
 * the researcher *pauses*, and pausing is what makes the row go.
 */
function useScoutActions() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const settle = {
    onMutate: () => setRefusal(undefined),
    onError: (error: { message: string }) => setRefusal(error.message),
    // The row is a query over the run rows, so what a run or a pause did
    // is read back rather than assumed.
    onSettled: () => {
      void queryClient.invalidateQueries(trpc.looseEnds.rows.pathFilter());
      void queryClient.invalidateQueries(trpc.scouts.health.pathFilter());
    },
  };
  const run = useMutation(trpc.scouts.runNow.mutationOptions(settle));
  const pause = useMutation(trpc.scouts.pause.mutationOptions(settle));
  return { run, pause, refusal };
}

function BrokenScout({
  row,
  resolution,
}: {
  row: FailedScout;
  resolution: Resolution;
}) {
  const { run, pause, refusal } = useScoutActions();
  return (
    <RowShell
      meta={`scout · ${row.errorKind.replaceAll("_", " ")}`}
      title={row.title}
      href={hashOf(SCOUTS)}
      why={row.sentence}
      resolution={{ ...resolution, refused: resolution.refused ?? refusal }}
      actions={
        <>
          <button
            type="button"
            className={styles.primary}
            disabled={run.isPending}
            onClick={() => run.mutate({ scoutId: row.subject })}
          >
            run now
          </button>
          <button
            type="button"
            className={styles.action}
            disabled={pause.isPending}
            onClick={() => pause.mutate({ scoutId: row.subject })}
          >
            pause
          </button>
          <a className={styles.action} href={hashOf(SCOUTS)}>
            open
          </a>
        </>
      }
    />
  );
}

/**
 * *A page whose structure changed* (#470; ADR 0040 decision 7): the failed
 * Scout's row for the failure that is known to be the page's, so it offers
 * the page itself beside the same two ways out. The sentence is the rail's.
 */
function ChangedPage({
  row,
  resolution,
}: {
  row: StructureChange;
  resolution: Resolution;
}) {
  const { run, pause, refusal } = useScoutActions();
  // The address came from a file the researcher may have hand-written, so
  // it goes through the one link rule like every other outbound link.
  const link = classifyLink(row.address);
  return (
    <RowShell
      meta="scout · structure change"
      title={row.title}
      href={hashOf(SCOUTS)}
      why={row.sentence}
      resolution={{ ...resolution, refused: resolution.refused ?? refusal }}
      actions={
        <>
          {link.kind === "out" && (
            <a
              className={styles.primary}
              href={link.href}
              target="_blank"
              rel="noreferrer"
            >
              open the page
            </a>
          )}
          <button
            type="button"
            className={styles.action}
            disabled={run.isPending}
            onClick={() => run.mutate({ scoutId: row.subject })}
          >
            run now
          </button>
          <button
            type="button"
            className={styles.action}
            disabled={pause.isPending}
            onClick={() => pause.mutate({ scoutId: row.subject })}
          >
            pause
          </button>
        </>
      }
    />
  );
}

/**
 * *A Scout blocked on credentials* (#470; ADR 0040 decision 7): the fix is a
 * key, which goes in Settings, so that is the only way out. No key is the
 * *not yet* voice and carries no glyph; a refused key is a fault and does.
 * The row clears by itself once a key is stored and the Scout runs.
 */
function BlockedScout({
  row,
  resolution,
}: {
  row: BlockedOnCredentials;
  resolution: Resolution;
}) {
  return (
    <RowShell
      meta="scout · credentials"
      title={row.title}
      href={hashOf(SCOUTS)}
      why={
        row.voice === "wrong" ? (
          <>
            <span role="img" aria-label="not working">
              ⚠
            </span>{" "}
            {row.sentence}
          </>
        ) : (
          row.sentence
        )
      }
      resolution={resolution}
      actions={
        <a className={styles.primary} href={hashOf(SETTINGS)}>
          open Settings
        </a>
      }
    />
  );
}

/**
 * *A Scout file that does not parse* (ADR 0039 decision 7): named by its
 * file, with the rail's sentence. Only *open* — the Vault editor that would
 * fix the file is a later beat, and *mark deliberate* would hide a Scout the
 * researcher believes is running.
 */
function UnreadableScout({
  row,
  resolution,
}: {
  row: UnreadableScoutFile;
  resolution: Resolution;
}) {
  return (
    <RowShell
      meta="scout file · unreadable"
      title={row.title}
      href={hashOf(SCOUTS)}
      why={row.sentence}
      resolution={resolution}
      actions={
        <a className={styles.primary} href={hashOf(SCOUTS)}>
          open
        </a>
      }
    />
  );
}

/**
 * *A stub with no PDF* (#453; ADR 0013): a row at once, since a stub is
 * unfinished by definition. *Attach to a stub* here is the other direction
 * from the no-Source row's: the stub is fixed and the PDF is chosen, from the
 * ones no Source names. *Mark deliberate* is for a stub kept as reference;
 * nothing is written to the stub for it.
 */
function BareStub({
  row,
  resolution,
}: {
  row: StubWithoutPdf;
  resolution: Resolution;
}) {
  const trpc = useTRPC();
  const [choosing, setChoosing] = useState(false);
  const [attached, setAttached] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const waiting = useQuery({
    ...trpc.sources.unnamedPdfs.queryOptions(),
    enabled: choosing,
  });
  const attach = useMutation(
    trpc.sources.attachToStub.mutationOptions({
      onSuccess: (_reply, { pdf }) => setAttached(pdf),
      onError: (error) => setRefusal(error.message),
    })
  );
  return (
    <RowShell
      meta="source stub · no PDF"
      title={row.title}
      why={
        attached === null
          ? "Found, not yet acquired: there is no PDF to read or annotate."
          : `Attached ${attached.replace(/^.*\//, "")} — it is a Source now, and the file keeps the name it has.`
      }
      resolution={{ ...resolution, refused: resolution.refused ?? refusal }}
      actions={
        attached === null && (
          <>
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                setRefusal(undefined);
                setChoosing(true);
              }}
            >
              attach to a stub
            </button>
            <Deliberate onDismiss={resolution.onDismiss} />
          </>
        )
      }
    >
      {choosing && attached === null && (
        <ul aria-label="PDFs no Source names">
          {(waiting.data ?? []).map((pdf) => (
            <li key={pdf}>
              <button
                type="button"
                className={styles.action}
                onClick={() => attach.mutate({ pdf, stub: row.path })}
              >
                {pdf.replace(/^.*\//, "")}
              </button>
            </li>
          ))}
          {waiting.data?.length === 0 && (
            <li>No PDF in the folder is waiting for a Source.</li>
          )}
        </ul>
      )}
    </RowShell>
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
 * A claim as a clause inside the falsifying line. A claim is written as its
 * own sentence, so it usually ends in a full stop, and the line carries on
 * past it with a comma — "strength., with" otherwise. Only a lone full stop
 * goes: a question mark or an ellipsis still reads before a comma, and says
 * something the claim meant.
 */
const asClause = (claim: string) => claim.trimEnd().replace(/(?<!\.)\.$/, "");

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
                {f.criterion === null
                  ? asClause(f.claim)
                  : `${f.criterion} · ${asClause(f.claim)}`}
              </a>
            </span>
          ))}
          , with its Outcome recorded.
        </p>
      )}
    </RowShell>
  );
}

/**
 * *A PDF in the folder that nothing names* (#417; spec #416 stories 4, 5):
 * neither ingested nor indexed until it is resolved. *Attach to a stub* is
 * the picker narrowed to stubs and one write in the core; the row then
 * stays, saying what happened, until the dashboard is next read. Nothing
 * here renames or moves the file. *Create a Source* is one write in the
 * core, from the PDF's own title and authors (#418).
 */
function NoSourcePdf({
  row,
  resolution,
}: {
  row: NoSource;
  resolution: Resolution;
}) {
  const trpc = useTRPC();
  const [picking, setPicking] = useState(false);
  const [attachedTo, setAttachedTo] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const attach = useMutation(
    trpc.sources.attachToStub.mutationOptions({
      onSuccess: (_reply, { stub }) => setAttachedTo(stub),
      onError: (error) => setRefusal(error.message),
    })
  );
  // *Create a Source* answers either way: a Source, or the reason the file
  // would not read — which the next read of the dashboard shows as a row.
  const [made, setMade] = useState<
    { citekey: string } | { reason: string } | null
  >(null);
  const create = useMutation(
    trpc.sources.createFromFile.mutationOptions({
      onSuccess: (reply) =>
        setMade(reply.readable ? { citekey: reply.citekey } : reply),
      onError: (error) => setRefusal(error.message),
    })
  );
  const stubName = attachedTo?.replace(/^.*\//, "").replace(/\.md$/, "");
  const done = attachedTo !== null || made !== null;
  return (
    <RowShell
      meta="PDF · no Source"
      title={row.title}
      why={
        made !== null
          ? "citekey" in made
            ? `Created ${made.citekey} from the file's own metadata — it is a Source now, and the file keeps the name it has.`
            : `This PDF could not be read because ${made.reason}. It shows under Broken plumbing when the dashboard is next read.`
          : attachedTo === null
            ? "No Source names this file, so it is neither read nor indexed."
            : `Attached to ${stubName} — it is a Source now, and the file keeps the name it has.`
      }
      resolution={{ ...resolution, refused: resolution.refused ?? refusal }}
      actions={
        !done && (
          <>
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                setRefusal(undefined);
                setPicking(true);
              }}
            >
              attach to a stub
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                setRefusal(undefined);
                create.mutate({ pdf: row.path });
              }}
            >
              create a Source
            </button>
            <Deliberate onDismiss={resolution.onDismiss} />
          </>
        )
      }
    >
      {picking && (
        <Picker
          label="Attach to a stub"
          kinds={["source-stub"]}
          onChoose={(chosen) => {
            setPicking(false);
            attach.mutate({ pdf: row.path, stub: chosen.path });
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </RowShell>
  );
}

/**
 * *A PDF the engine could not read* (#418; spec #416 stories 65–67): the
 * reason is the core's own words and carries no path. *Try again* runs the
 * engine once, when asked — a file that stopped the reader is never retried
 * on its own — and says what came of it; the row itself goes, or stays with
 * its new reason, when the dashboard is next read.
 */
function UnreadablePdfRow({
  row,
  resolution,
}: {
  row: UnreadablePdf;
  resolution: Resolution;
}) {
  const trpc = useTRPC();
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [answer, setAnswer] = useState<{
    readable: boolean;
    reason?: string;
  } | null>(null);
  const retry = useMutation(
    trpc.sources.tryAgain.mutationOptions({
      onSuccess: setAnswer,
      onError: (error) => setRefusal(error.message),
    })
  );
  const reason = answer?.reason ?? row.reason;
  return (
    <RowShell
      meta="PDF · unreadable"
      title={row.title}
      why={
        answer?.readable === true
          ? "It reads now. It is a PDF no Source names again when the dashboard is next read, and can be attached or made a Source then."
          : `This PDF could not be read because ${reason}.`
      }
      resolution={{ ...resolution, refused: resolution.refused ?? refusal }}
      actions={
        <>
          {answer?.readable !== true && (
            <button
              type="button"
              className={styles.primary}
              disabled={retry.isPending}
              onClick={() => {
                setRefusal(undefined);
                retry.mutate({ pdf: row.path });
              }}
            >
              try again
            </button>
          )}
          <Deliberate onDismiss={resolution.onDismiss} />
        </>
      }
    />
  );
}

/**
 * *A second copy of a Source's PDF* (#423; spec #416 stories 59–61): what a
 * sync service makes when two machines wrote one file. It is never a Source
 * of its own — the row names the Source it is a copy for and asks which
 * bytes are canonical. *Use this copy* replaces the canonical file, and the
 * next Ingest re-matches every identity through the tiers; *discard* sends
 * the copy to the Trash.
 */
function ConflictCopyRow({
  row,
  resolution,
}: {
  row: ConflictCopy;
  resolution: Resolution;
}) {
  const trpc = useTRPC();
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<string | null>(null);
  const resolve = useMutation(
    trpc.sources.resolveConflict.mutationOptions({
      onMutate: () => setRefusal(undefined),
      onError: (error) => setRefusal(error.message),
      onSuccess: (_reply, { resolution: chosen }) =>
        setOutcome(
          chosen === "use"
            ? "The copy is the PDF now. Every annotation is being matched against it again, and whatever it cannot find comes back here."
            : "The copy is in the Trash, and the PDF is as it was."
        ),
    })
  );
  const address = addressOf("source", row.source) ?? undefined;
  return (
    <RowShell
      meta="PDF · conflict copy"
      title={row.title}
      why={
        outcome ??
        `The same paper as ${row.sourceTitle}, written twice — a sync service keeps both when two machines save one file. Neither is used until you choose.`
      }
      resolution={{ ...resolution, refused: resolution.refused ?? refusal }}
      actions={
        outcome === null && (
          <>
            <button
              type="button"
              className={styles.primary}
              disabled={resolve.isPending}
              onClick={() =>
                resolve.mutate({ copy: row.path, resolution: "use" })
              }
            >
              use this copy
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={resolve.isPending}
              onClick={() =>
                resolve.mutate({ copy: row.path, resolution: "discard" })
              }
            >
              discard
            </button>
            <Deliberate onDismiss={resolution.onDismiss} />
          </>
        )
      }
    >
      {outcome === null && address !== undefined && (
        <p className={styles.why}>
          Its Source:{" "}
          <a className={styles.evidenceLink} href={address}>
            {row.sourceTitle}
          </a>
        </p>
      )}
    </RowShell>
  );
}

/**
 * *A Source whose PDF is gone* (#423; spec #416 stories 62–64). *Locate*
 * offers the PDFs no Source names, and the core accepts one only if it is
 * the same document, saying so in plain words when it is not. *Detach*
 * clears `pdf:` and leaves the annotations frozen and every link resolving.
 */
function PdfMissingRow({
  row,
  resolution,
}: {
  row: PdfMissing;
  resolution: Resolution;
}) {
  const trpc = useTRPC();
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const settle = (said: string) => ({
    onMutate: () => setRefusal(undefined),
    onError: (error: { message: string }) => setRefusal(error.message),
    onSuccess: () => setOutcome(said),
  });
  const locate = useMutation(
    trpc.sources.locate.mutationOptions(
      settle("Located — the Source names that file again.")
    )
  );
  const detach = useMutation(
    trpc.sources.detach.mutationOptions(
      settle(
        "Detached — the annotations stay as they were, and every link to them still resolves."
      )
    )
  );
  const busy = locate.isPending || detach.isPending;
  const address = addressOf("source", row.path) ?? undefined;
  return (
    <RowShell
      meta="Source · PDF missing"
      title={row.title}
      {...(address === undefined ? {} : { href: address })}
      why={
        outcome ??
        `${row.file} is not in the PDF folder any more, so nothing new is read from it. Its annotations are kept as they were.`
      }
      resolution={{ ...resolution, refused: resolution.refused ?? refusal }}
      actions={
        outcome === null && (
          <>
            <button
              type="button"
              className={styles.primary}
              disabled={busy || row.candidates.length === 0}
              aria-expanded={choosing}
              onClick={() => setChoosing(!choosing)}
            >
              locate
            </button>
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => detach.mutate({ source: row.path })}
            >
              detach
            </button>
            <Deliberate onDismiss={resolution.onDismiss} />
          </>
        )
      }
    >
      {outcome === null && choosing && (
        <ul className={styles.matches} aria-label="locate as">
          {row.candidates.map((c) => (
            <li key={c.path} className={styles.match}>
              <button
                type="button"
                className={styles.action}
                disabled={busy}
                onClick={() => locate.mutate({ source: row.path, pdf: c.path })}
              >
                {c.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </RowShell>
  );
}

/**
 * *A paper read and never used* (#423; spec #416 story 68): a Source with
 * annotations and no note or Question linking to any of them. Findable, not
 * urgent — the group says *wired to nothing* — so it offers the Reader,
 * where a link is made, and *mark deliberate*.
 */
function UnlinkedSource({
  row,
  resolution,
}: {
  row: UnlinkedAnnotations;
  resolution: Resolution;
}) {
  const address = addressOf("source", row.path) ?? undefined;
  return (
    <RowShell
      meta="Source · annotated, unlinked"
      title={row.title}
      {...(address === undefined ? {} : { href: address })}
      resolution={resolution}
      why={
        row.annotations === 1
          ? "One annotation, and nothing links to it."
          : `${row.annotations} annotations, and nothing links to any of them.`
      }
      actions={
        address === undefined ? (
          <Deliberate onDismiss={resolution.onDismiss} />
        ) : (
          <>
            <a className={styles.primary} href={address}>
              open in the Reader
            </a>
            <Deliberate onDismiss={resolution.onDismiss} />
          </>
        )
      }
    />
  );
}

/**
 * The three resolutions of an Unmatched annotation (#421; spec #416 stories
 * 47–55), shared by a row on its own and by a row inside a document-changed
 * group. Each leaves the vault changed and no undo behind it, so a success
 * re-reads the rows: the row is gone because it is resolved, not hidden.
 * A refusal is the core's own words, a line on the row it was about.
 */
function useUnmatchedActs() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<string | null>(null);
  const settle = (said: string) => ({
    onMutate: () => setRefusal(undefined),
    onError: (error: { message: string }) => setRefusal(error.message),
    onSuccess: () => {
      setOutcome(said);
      void queryClient.invalidateQueries(trpc.looseEnds.rows.pathFilter());
    },
  });
  return {
    refusal,
    outcome,
    relink: useMutation(
      trpc.unmatched.relink.mutationOptions(
        settle("Relinked — its links follow it.")
      )
    ),
    drop: useMutation(
      trpc.unmatched.dropLinks.mutationOptions(
        settle("Gone — every link to it still resolves, and reads (gone).")
      )
    ),
    treat: useMutation(
      trpc.unmatched.treatAsNew.mutationOptions(
        settle(
          "Treated as new — the old identity reads (gone), and no link was rewritten."
        )
      )
    ),
  };
}
type UnmatchedActs = ReturnType<typeof useUnmatchedActs>;

/** What linked to an annotation, each named and opened where it has an Address. */
function InboundLinks({ row }: { row: UnmatchedAnnotation }) {
  return (
    <>
      {row.links.map((link, i) => {
        const address = addressOf(link.kind, link.path);
        return (
          <span key={link.path}>
            {i > 0 && ", "}
            {address === null ? (
              link.title
            ) : (
              <a className={styles.evidenceLink} href={address}>
                {link.title}
              </a>
            )}
          </span>
        );
      })}
    </>
  );
}

/**
 * *Relink*, *drop the links* and *treat as new* for one annotation. Relink
 * names a candidate, ranked by page then overlap as the core sent them; the
 * other two need no target. Never offered as a batch: a batch would have to
 * invent a target (story 55).
 */
function UnmatchedChoices({
  row,
  acts,
}: {
  row: UnmatchedAnnotation;
  acts: UnmatchedActs;
}) {
  const [choosing, setChoosing] = useState(false);
  const busy =
    acts.relink.isPending || acts.drop.isPending || acts.treat.isPending;
  const one = { source: row.path, annotations: [row.annotation] };
  return (
    <>
      <button
        type="button"
        className={styles.primary}
        disabled={busy || row.candidates.length === 0}
        aria-expanded={choosing}
        onClick={() => setChoosing(!choosing)}
      >
        relink
      </button>
      <button
        type="button"
        className={styles.primary}
        disabled={busy}
        onClick={() => acts.drop.mutate(one)}
      >
        drop the links
      </button>
      <button
        type="button"
        className={styles.primary}
        disabled={busy}
        onClick={() => acts.treat.mutate(one)}
      >
        treat as new
      </button>
      {choosing && (
        <ul className={styles.matches} aria-label="relink to">
          {row.candidates.map((c) => (
            <li key={c.ref} className={styles.match}>
              <button
                type="button"
                className={styles.action}
                disabled={busy}
                onClick={() =>
                  acts.relink.mutate({
                    source: row.path,
                    annotation: row.annotation,
                    candidate: c.ref,
                  })
                }
              >
                p.{c.page} · “{c.quote}”
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Why an Unmatched annotation is here, in the words of what it was. */
function whyUnmatched(row: UnmatchedAnnotation) {
  return row.links.length === 0 ? (
    "It could not be told apart from another, so it was not guessed at."
  ) : (
    <>
      It could not be found in the file any more. Linked from{" "}
      <InboundLinks row={row} />.
    </>
  );
}

/**
 * *An annotation something links to that cannot be found* (stories 45–46):
 * its quoted text as it was, the page, and what linked to it — so the
 * researcher can judge whether it is the same one. Persists until resolved.
 */
function Unmatched({
  row,
  resolution,
}: {
  row: UnmatchedAnnotation;
  resolution: Resolution;
}) {
  const acts = useUnmatchedActs();
  return (
    <RowShell
      meta={`annotation · unmatched · p.${row.page} · ${row.title}`}
      title={`“${row.quote}”`}
      why={acts.outcome ?? whyUnmatched(row)}
      resolution={{
        ...resolution,
        refused: resolution.refused ?? acts.refusal,
      }}
      actions={
        acts.outcome === null && (
          <>
            <UnmatchedChoices row={row} acts={acts} />
            <Deliberate onDismiss={resolution.onDismiss} />
          </>
        )
      }
    />
  );
}

/**
 * The Unmatched annotations one replaced PDF left, as one row headed by the
 * event (stories 53–55). Its batch acts ask once, in place, and apply to
 * every annotation in the group or to none; *relink* stays on each
 * annotation beneath it.
 */
function ChangedDocument({
  row,
  resolution,
}: {
  row: DocumentChanged;
  resolution: Resolution;
}) {
  const acts = useUnmatchedActs();
  const [asking, setAsking] = useState<"drop" | "treat" | null>(null);
  const count = row.annotations.length;
  const all = {
    source: row.path,
    annotations: row.annotations.map((a) => a.annotation),
  };
  const noun = count === 1 ? "annotation" : "annotations";
  return (
    <RowShell
      meta={`document changed · ${count} could not be re-matched`}
      title={row.title}
      why={
        acts.outcome ??
        `The PDF was replaced, and ${count} ${noun} something links to could not be found in the new file.`
      }
      resolution={{
        ...resolution,
        refused: resolution.refused ?? acts.refusal,
      }}
      actions={
        acts.outcome === null &&
        (asking === null ? (
          <>
            <button
              type="button"
              className={styles.primary}
              onClick={() => setAsking("drop")}
            >
              drop the links
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={() => setAsking("treat")}
            >
              treat as new
            </button>
            <Deliberate onDismiss={resolution.onDismiss} />
          </>
        ) : (
          <>
            <span className={styles.candidate}>
              {asking === "drop"
                ? `drop the links on all ${count}?`
                : `treat all ${count} as new?`}
            </span>
            <button
              type="button"
              className={styles.primary}
              disabled={acts.drop.isPending || acts.treat.isPending}
              onClick={() =>
                (asking === "drop" ? acts.drop : acts.treat).mutate(all)
              }
            >
              yes, all {count}
            </button>
            <button
              type="button"
              className={styles.action}
              onClick={() => setAsking(null)}
            >
              cancel
            </button>
          </>
        ))
      }
    >
      {acts.outcome === null && (
        <ul className={styles.unmatched}>
          {row.annotations.map((a) => (
            <ChangedAnnotation key={a.annotation} row={a} />
          ))}
        </ul>
      )}
    </RowShell>
  );
}

/** One annotation inside a document-changed group, with its own resolutions. */
function ChangedAnnotation({ row }: { row: UnmatchedAnnotation }) {
  const acts = useUnmatchedActs();
  return (
    <li className={styles.unmatchedItem}>
      <span className={styles.target}>
        p.{row.page} · “{row.quote}”
      </span>
      <span className={styles.candidate}>{whyUnmatched(row)}</span>
      {acts.outcome === null ? (
        <span className={styles.actions}>
          <UnmatchedChoices row={row} acts={acts} />
        </span>
      ) : (
        <span className={styles.candidate}>{acts.outcome}</span>
      )}
      {acts.refusal !== undefined && (
        <span className={styles.refused} role="alert">
          <span className={styles.problemGlyph} aria-hidden="true">
            !
          </span>{" "}
          {acts.refusal}
        </span>
      )}
    </li>
  );
}

/**
 * The Unmatched rows and nothing else: what the panel draws, and the same
 * component the dashboard draws them with (story 57) — one place a
 * resolution lives, so it cannot drift between the two.
 */
export function UnmatchedRows({ rows }: { rows: LooseEndRow[] }) {
  const { resolutionOf } = useResolutions();
  return (
    <ul className={styles.rows}>
      {rows.map((row) => (
        <Row
          key={keyOf(row)}
          row={row}
          now={new Date()}
          onAttach={() => undefined}
          resolution={resolutionOf(row)}
        />
      ))}
    </ul>
  );
}
