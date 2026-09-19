import styles from "./Detail.module.css";
import { localDateTime, provenanceOf, STATUS, type Row } from "./rows";

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
            <span
              className={row.question.status === "open" ? styles.open : ""}
              aria-hidden="true"
            >
              {STATUS[row.question.status].glyph}
            </span>
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
      {row?.kind === "partial" && (
        <>
          <div className={styles.status}>
            <span aria-hidden="true">◇</span>
            <span>partial · question or captured missing</span>
          </div>
          <h2 className={styles.text}>{row.partial.name}</h2>
          <div className={styles.label}>File</div>
          <div className={styles.provenance}>
            <div>{row.partial.path}</div>
            <div>{localDateTime(row.partial.mtime)}</div>
          </div>
        </>
      )}
    </aside>
  );
}
