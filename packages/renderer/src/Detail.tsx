import type { ListedQuestion } from "core";
import styles from "./Detail.module.css";
import {
  localDateTime,
  localTime,
  provenanceOf,
  STATUS,
  type Row,
} from "./rows";
import { othersInSitting, SITTING_GAP_MINUTES } from "./sitting";
import { PartialGlyph, StatusGlyph } from "./StatusGlyph";

/**
 * The selected row in full. Holds no triage actions and no placeholders for
 * them; with nothing selected it shows nothing, so nothing stale is shown.
 *
 * `questions` is the whole listing, which the sitting below Provenance is
 * read out of; `onSelect` is how one of those others becomes the selection.
 */
export function Detail({
  row,
  questions,
  onSelect,
}: {
  row: Row | null;
  questions: ListedQuestion[];
  onSelect: (path: string) => void;
}) {
  const others =
    row?.kind === "question"
      ? othersInSitting(questions, row.path, SITTING_GAP_MINUTES)
      : [];
  return (
    <aside className={styles.detail} aria-label="Selected question">
      {row?.kind === "question" && (
        <>
          <div className={styles.status}>
            <StatusGlyph status={row.question.status} />
            <span>{STATUS[row.question.status].label}</span>
          </div>
          <h2 className={styles.text}>{row.question.question}</h2>
          <div className={styles.label}>Provenance</div>
          <div className={styles.provenance}>
            <div>{provenanceOf(row.question)}</div>
            <div>{localDateTime(row.question.captured)}</div>
          </div>
          {/* The rest of the sitting: named, never totalled (#265, HOLD-5), and
              absent entirely when this Question was the only one in it. */}
          {others.length > 0 && (
            <>
              <div className={styles.label} id="sitting-label">
                Captured in the same sitting
              </div>
              <ul className={styles.sitting} aria-labelledby="sitting-label">
                {others.map((other) => (
                  <li key={other.path}>
                    <button
                      type="button"
                      className={styles.other}
                      onClick={() => onSelect(other.path)}
                    >
                      <span className={styles.otherText}>{other.question}</span>
                      <span className={styles.otherWhen}>
                        {localTime(other.captured)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {/* A Partial file has no Provenance to show: its name and when it last
          changed. No `captured`, so no sitting either. */}
      {row?.kind === "partial" && (
        <>
          <div className={styles.status}>
            <PartialGlyph />
            <span>partial · question or captured missing</span>
          </div>
          <h2 className={styles.text}>{row.partial.name}</h2>
          <div className={styles.provenance}>
            <div>{localDateTime(row.partial.mtime)}</div>
          </div>
        </>
      )}
    </aside>
  );
}
