import type { ReactNode } from "react";
import styles from "./Settings.module.css";

/** The *wrong* Voice on a Settings row: the warning glyph and the words in copper, never red. */
export function Wrong({ children }: { children: ReactNode }) {
  return (
    <span className={styles.wrong}>
      <span aria-hidden="true">‖</span> {children}
    </span>
  );
}
