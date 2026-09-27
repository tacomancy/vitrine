import type { Revision } from "core";
import { useState } from "react";
import {
  historyRows,
  quietLabel,
  rangeLabel,
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
 * The component takes entries and each field's current text, nothing about
 * Research Questions, so a Hypothesis claim or an Experiment design renders
 * here too (story 59).
 */
export function PositionHistory({
  entries,
  current,
}: {
  entries: Revision[];
  /** Each field's text as the file holds it now, keyed by field name. */
  current: Record<string, string>;
}) {
  const [explainedOnly, setExplainedOnly] = useState(false);
  // Nothing to filter and no trail to draw: the base line the caller puts
  // under this says where the page came from, and that is the whole history.
  const empty = entries.length === 0;
  // The chain that gives each entry the text it moved *to* is computed over
  // every entry, then filtered: hiding the trail must not change what the
  // explained Revisions say the answer became.
  const rows = historyRows(entries, current).filter(
    (row) => !explainedOnly || row.kind === "explained"
  );
  // Which field an entry is of only needs saying when the history holds more
  // than one; on a Research Question every entry is the working answer.
  const fields = new Set(entries.map((entry) => entry.field));

  if (empty) return null;
  return (
    <>
      <div className={styles.filter} role="group" aria-label="Show">
        {(["everything", "explained only"] as const).map((label) => {
          const on = (label === "explained only") === explainedOnly;
          return (
            <button
              key={label}
              type="button"
              className={styles.choice}
              aria-pressed={on}
              onClick={() => setExplainedOnly(label === "explained only")}
            >
              {label}
            </button>
          );
        })}
        <span className={styles.order}>newest first</span>
      </div>
      <ol className={styles.entries}>
        {rows.map((row) => (
          <Row key={keyOf(row)} row={row} named={fields.size > 1} />
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

function Row({ row, named }: { row: HistoryRow; named: boolean }) {
  if (row.kind === "explained") {
    const { revision, to } = row;
    return (
      <li className={styles.entry}>
        <When at={revision.at} field={named ? revision.field : null} />
        <div className={styles.body}>
          {to !== "" && <p className={styles.position}>{to}</p>}
          <p className={styles.why}>
            <Why text={revision.why ?? ""} />
          </p>
          <From from={revision.from} />
        </div>
      </li>
    );
  }
  return <Quiet revisions={row.revisions} named={named} />;
}

/**
 * A run of unexplained Revisions: one line saying the position moved and how
 * often, which opens into the entries themselves. They are never hidden —
 * movement without a story is still movement (prompt 3).
 */
function Quiet({
  revisions,
  named,
}: {
  revisions: Revision[];
  named: boolean;
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
                <span className={styles.when}>{localDate(revision.at)}</span>
                <From from={revision.from} />
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
