import type { QuestionStatus } from "core";
import { STATUS } from "./rows";
import styles from "./StatusGlyph.module.css";

/**
 * A Question's status as a glyph with its label as the accessible name
 * (BRAND.md law 6). Only open carries colour, and that colour is the accent.
 */
export function StatusGlyph({ status }: { status: QuestionStatus }) {
  const { glyph, label } = STATUS[status];
  return (
    <span
      className={status === "open" ? styles.open : styles.glyph}
      role="img"
      aria-label={label}
      title={label}
    >
      {glyph}
    </span>
  );
}

/** The mark for a Partial file: no status, since it is not yet a row's worth of Question. */
export function PartialGlyph() {
  return (
    <span
      className={styles.glyph}
      role="img"
      aria-label="partial"
      title="partial"
    >
      ◇
    </span>
  );
}
