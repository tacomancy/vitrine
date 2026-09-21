import type { QuestionStatus } from "core";
import { STATUS } from "./rows";
import styles from "./StatusGlyph.module.css";

/**
 * A Question's status as a glyph with its label as the accessible name
 * (BRAND.md law 6). Only open carries colour, and that colour is the accent.
 * A Research Question shares the glyphs and passes its own label where the
 * word differs (*abandoned* on the page, *dropped* in the Inbox).
 */
export function StatusGlyph({
  status,
  label = STATUS[status].label,
}: {
  status: QuestionStatus;
  label?: string;
}) {
  const { glyph } = STATUS[status];
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
