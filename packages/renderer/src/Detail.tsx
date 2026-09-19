import styles from "./Detail.module.css";
import { localDateTime, provenanceOf, STATUS, type Row } from "./rows";
import { PartialGlyph, StatusGlyph } from "./StatusGlyph";

/**
 * The selected row in full. Holds no triage actions and no placeholders for
 * them; with nothing selected it shows nothing, so nothing stale is shown.
 */
export function Detail({ row }: { row: Row | null }) {
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
        </>
      )}
      {/* A Partial file has no Provenance to show: its name and when it last changed. */}
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
