import type { Matrix as MatrixData } from "core";
import { addressOf } from "../kinds";
import styles from "./matrix.module.css";

/**
 * The coverage matrix (ADR 0041 decisions 3, 11, 12): a shaded grid of Map
 * rows by Tags. The core has already cut and weighed it; this draws exactly
 * what it is handed and adds no number of its own — a row or column total
 * would be a sum of cells, which counts a paper once per Tag (decision 5).
 */

/** Each bin with its legend label and the count it starts at. */
const BINS = [
  { bin: "none", label: "none", from: 0 },
  { bin: "b1", label: "1", from: 1 },
  { bin: "b2", label: "2–3", from: 2 },
  { bin: "b3", label: "4–7", from: 4 },
  { bin: "b4", label: "8+", from: 8 },
] as const;
type Bin = (typeof BINS)[number]["bin"];

/**
 * The bin a count falls in. Colour is bound to the class name in the CSS
 * Module, never here, so the stylesheet is the one place a bin has a hue.
 */
export function binOf(count: number): Bin {
  return BINS.filter((b) => count >= b.from).at(-1)!.bin;
}

const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

export function Matrix({ matrix }: { matrix: MatrixData }) {
  return (
    <div className={styles.matrix}>
      <ul className={styles.legend} aria-label="Legend: items per cell">
        {BINS.map(({ bin, label }) => (
          <li key={bin} className={styles.legendItem}>
            <span data-swatch className={`${styles.swatch} ${styles[bin]}`} />
            {label}
          </li>
        ))}
      </ul>
      {/* Navigation by the chosen-id rule (ADR 0030) arrives with the cell's
          inline list (ADR 0041 decision 11), the first thing a cell does besides be read. */}
      <div
        role="grid"
        aria-label="Coverage: questions by tags"
        className={styles.grid}
        style={{
          gridTemplateColumns: `minmax(12rem, 18rem) repeat(${matrix.columns.length}, minmax(1.75rem, 1fr))`,
        }}
      >
        <div role="row" className={styles.row}>
          <span role="presentation" />
          {matrix.columns.map((column) => (
            <span
              key={column.canonical}
              role="columnheader"
              className={styles.columnHeader}
              title={column.display}
            >
              {column.display}
            </span>
          ))}
        </div>
        {matrix.rows.map((row, r) => {
          const address = addressOf(row.kind, row.path);
          return (
            <div role="row" key={row.path} className={styles.row}>
              <span role="rowheader" className={styles.rowHeader}>
                {address === null ? (
                  row.question
                ) : (
                  <a href={address}>{row.question}</a>
                )}
              </span>
              {matrix.columns.map((column, c) => {
                const count = matrix.cells[r]![c]!;
                return (
                  <span
                    key={column.canonical}
                    role="gridcell"
                    className={`${styles.cell} ${styles[binOf(count)]}`}
                    aria-label={`${row.question} · ${column.display}: ${items(count)}`}
                  >
                    {count === 0 ? (
                      ""
                    ) : (
                      <span className={styles.count}>{count}</span>
                    )}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
