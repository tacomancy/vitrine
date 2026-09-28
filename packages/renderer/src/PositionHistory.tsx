import type { Revision } from "core";
import { useState, type ReactNode } from "react";
import {
  historyRows,
  quietLabel,
  rangeLabel,
  type HistoryFilter,
  type HistoryRow,
} from "./history";
import styles from "./PositionHistory.module.css";
import { localDate } from "./rows";
import { linkLabel } from "./wikilink";

/**
 * The Position history rendered in place as a narrative (brief § Position
 * history; prompt 3 "a train of thought, not a diff log"; spec #206 stories
 * 37–39): newest first, explained Revisions at full width with their why
 * and their links, quiet ones collapsed into a trail that expands, and a
 * filter that puts the narrative on its own. The base line beneath is the
 * caller's — it is derived from the frontmatter, not an entry (story 39).
 *
 * The component takes entries, each field's current text, and a way to
 * write one line — nothing about Research Questions — so a Hypothesis claim
 * or an Experiment design renders here too (story 59). A page whose history
 * holds more than one kind of question to ask of it passes its own
 * `filters` beside *everything* and *explained only* (a Hypothesis's three,
 * spec #327 story 55).
 */
export function PositionHistory({
  entries,
  current,
  whyLine,
  filters = [],
}: {
  entries: Revision[];
  /** Each field's text as the file holds it now, keyed by field name. */
  current: Record<string, string>;
  /**
   * What the surface puts under a quiet entry the reader asked to explain
   * (#216; story 36). Omitted — a history rendered where nothing can be
   * written — and no *+ why* is offered at all.
   */
  whyLine?: (revision: Revision, close: () => void) => ReactNode;
  filters?: HistoryFilter[];
}) {
  // One reading at a time, by its button's words: *everything*, *explained
  // only*, or one of the page's own.
  const [showing, setShowing] = useState("everything");
  // Which entry has its line open, by timestamp and field (`idOf`) — one at
  // a time, because a why is a sentence and not a form to fill in.
  const [explaining, setExplaining] = useState<string | null>(null);
  // Nothing to filter and no trail to draw: the base line the caller puts
  // under this says where the page came from, and that is the whole history.
  const empty = entries.length === 0;
  // The chain that gives each entry the text it moved *to* is computed over
  // every entry, then filtered: hiding the trail must not change what the
  // explained Revisions say the answer became.
  const filter = filters.find((f) => f.label === showing);
  const rows = historyRows(entries, current, filter?.shows).filter(
    (row) => showing !== "explained only" || row.kind === "explained"
  );
  // Which field an entry is of only needs saying when the history holds more
  // than one; on a Research Question every entry is the working answer.
  const fields = new Set(entries.map((entry) => entry.field));
  const offer: Explaining | undefined =
    whyLine === undefined
      ? undefined
      : {
          open: explaining,
          toggle: (id) => setExplaining(explaining === id ? null : id),
          close: () => setExplaining(null),
          line: whyLine,
        };

  if (empty) return null;
  return (
    <>
      <div className={styles.filter} role="group" aria-label="Show">
        {["everything", "explained only", ...filters.map((f) => f.label)].map(
          (label) => (
            <button
              key={label}
              type="button"
              className={styles.choice}
              aria-pressed={label === showing}
              onClick={() => setShowing(label)}
            >
              {label}
            </button>
          )
        )}
        <span className={styles.order}>newest first</span>
      </div>
      <ol className={styles.entries}>
        {rows.map((row) => (
          <Row
            key={keyOf(row)}
            row={row}
            named={fields.size > 1}
            explaining={offer}
          />
        ))}
      </ol>
    </>
  );
}

// An entry has no id; its timestamp identifies it *within its field* (ADR
// 0020 decision 2), so the key is both — one write that stamps two fields
// would otherwise give two rows one key. A run is keyed by its newest.
const idOf = (revision: Revision) => `${revision.at} ${revision.field}`;
const keyOf = (row: HistoryRow) =>
  row.kind === "explained"
    ? idOf(row.revision)
    : `quiet ${row.revisions[0] === undefined ? "" : idOf(row.revisions[0])}`;

/**
 * The *+ why* a quiet entry is offered, and the line it opens (#216). One
 * object rather than three props, because the three only ever travel
 * together — and absent together, on a history that cannot be written to.
 */
type Explaining = {
  /** The entry whose line is open, by `idOf` — timestamp and field; null when none is. */
  open: string | null;
  /** What *+ why* does: open this entry's line, or close the one it has. */
  toggle: (id: string) => void;
  close: () => void;
  line: (revision: Revision, close: () => void) => ReactNode;
};

function Row({
  row,
  named,
  explaining,
}: {
  row: HistoryRow;
  named: boolean;
  explaining?: Explaining | undefined;
}) {
  if (row.kind === "explained") {
    const { revision, to, loud } = row;
    const id = idOf(revision);
    return (
      <li
        className={styles.entry}
        data-loud={loud !== null || undefined}
        aria-label={
          loud === null ? undefined : loud[0]!.toUpperCase() + loud.slice(1)
        }
      >
        <When at={revision.at} field={named ? revision.field : null} />
        <div className={styles.body}>
          {loud !== null && <p className={styles.loudTag}>{loud}</p>}
          {to !== "" && <p className={styles.position}>{to}</p>}
          {revision.why === null ? (
            // Only a loud entry stands here without a why, and it says so.
            <div className={styles.quietWhen}>
              <span className={styles.noWhy}>no why written</span>
              {explaining !== undefined && (
                <button
                  type="button"
                  className={styles.addWhy}
                  aria-expanded={explaining.open === id}
                  onClick={() => explaining.toggle(id)}
                >
                  + why
                </button>
              )}
            </div>
          ) : (
            <p className={styles.why}>
              <Why text={revision.why} />
            </p>
          )}
          {revision.field === "override voided" &&
          !Number.isNaN(Date.parse(revision.from)) ? (
            // Its `from:` is the Override's timestamp: the one it ends. One
            // typed by hand that is not a time shows as written.
            <p className={styles.from}>
              voids the override of {localDate(revision.from)}
            </p>
          ) : (
            <From from={revision.from} />
          )}
          {explaining?.open === id &&
            explaining.line(revision, explaining.close)}
        </div>
      </li>
    );
  }
  return (
    <Quiet revisions={row.revisions} named={named} explaining={explaining} />
  );
}

/**
 * A run of unexplained Revisions: one line saying the position moved and how
 * often, which opens into the entries themselves. They are never hidden —
 * movement without a story is still movement (prompt 3). Each entry the run
 * opens on carries its own *+ why*: the run is a summary, and which of four
 * Revisions a why belongs to is not a summary's to guess (#216).
 */
function Quiet({
  revisions,
  named,
  explaining,
}: {
  revisions: Revision[];
  named: boolean;
  explaining?: Explaining | undefined;
}) {
  const [open, setOpen] = useState(false);
  // `historyRows` never makes an empty run, so the head is the run's newest
  // and its last is the oldest; both are the same entry in a run of one.
  const newest = revisions[0];
  const oldest = revisions[revisions.length - 1];
  if (newest === undefined || oldest === undefined) return null;
  return (
    <li className={styles.entry}>
      <When
        at={newest.at}
        until={oldest.at === newest.at ? null : oldest.at}
        field={named ? newest.field : null}
      />
      <div className={styles.body}>
        <button
          type="button"
          className={styles.trail}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className={styles.rule} aria-hidden="true" />
          {quietLabel(revisions)}
        </button>
        {open && (
          <ul className={styles.expanded}>
            {revisions.map((revision) => (
              <li key={idOf(revision)} className={styles.quiet}>
                <div className={styles.quietWhen}>
                  <span className={styles.when}>{localDate(revision.at)}</span>
                  {explaining !== undefined && (
                    <button
                      type="button"
                      className={styles.addWhy}
                      aria-expanded={explaining.open === idOf(revision)}
                      onClick={() => explaining.toggle(idOf(revision))}
                    >
                      + why
                    </button>
                  )}
                </div>
                <From from={revision.from} />
                {explaining?.open === idOf(revision) &&
                  explaining.line(revision, explaining.close)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** The date column: when, and — where the history holds more than one field — which. */
function When({
  at,
  until,
  field,
}: {
  at: string;
  until?: string | null;
  field: string | null;
}) {
  return (
    <div className={styles.column}>
      <div className={styles.when}>
        {until == null ? localDate(at) : rangeLabel(until, at)}
      </div>
      {field !== null && <div className={styles.field}>{field}</div>}
    </div>
  );
}

/** What the field held before: the whole of it, or the fact that it held nothing. */
function From({ from }: { from: string }) {
  return (
    <p className={styles.from}>
      {from === "" ? "first position" : `from — ${from}`}
    </p>
  );
}

// A why is one line the user typed, and `[[` links inside it are how a
// Revision names what changed its mind (§ Research Question view and
// triage). Only where one *starts* is found here; how it reads is
// `linkLabel`'s, over the package's grammar. They read as links; where each
// lands is not known here, so nothing pretends they open.
const WIKILINK = /\[\[(.*?)\]\]/g;

function Why({ text }: { text: string }) {
  const parts: (string | { link: string })[] = [];
  let last = 0;
  for (const match of text.matchAll(WIKILINK)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push({ link: linkLabel(match[1] ?? "") });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((part, i) =>
        typeof part === "string" ? (
          part
        ) : (
          <span key={i} className={styles.link}>
            {part.link}
          </span>
        )
      )}
    </>
  );
}
