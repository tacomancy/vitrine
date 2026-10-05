import type { Matrix as MatrixData } from "core";
import { useId, useState, type KeyboardEvent } from "react";
import { useChosenInView } from "../chosen";
import { addressOf } from "../kinds";
import { ReviewLinks } from "../ReviewLinks";
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

type Cell = { r: number; c: number };
const ORIGIN: Cell = { r: 0, c: 0 };

export function Matrix({
  matrix,
  reviewable = new Set(),
  onReview,
}: {
  matrix: MatrixData;
  /** Questions the review has candidates for. */
  reviewable?: ReadonlySet<string>;
  onReview?: (path: string) => void;
}) {
  const prefix = useId();
  // The grid is one tab stop and the chosen cell is only an id (ADR 0030), so
  // the cell the keyboard is on and the one a screen reader announces are the
  // same statement. Nothing is chosen until the grid is entered.
  const [chosen, setChosen] = useState<Cell | null>(null);
  const [open, setOpen] = useState(false);
  const rows = matrix.rows.length;
  const cols = matrix.columns.length;
  const cellId = (cell: Cell) => `${prefix}-cell-${cell.r}-${cell.c}`;
  const chosenId = chosen === null ? undefined : cellId(chosen);
  useChosenInView(chosenId);

  const choose = (next: Cell) => {
    setChosen(next);
    // A list belongs to the cell it opened on; moving on closes it rather
    // than leaving Material under a cell it no longer describes.
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const at = chosen ?? ORIGIN;
    const moves: Record<string, Cell> = {
      ArrowRight: { r: at.r, c: Math.min(at.c + 1, cols - 1) },
      ArrowLeft: { r: at.r, c: Math.max(at.c - 1, 0) },
      ArrowDown: { r: Math.min(at.r + 1, rows - 1), c: at.c },
      ArrowUp: { r: Math.max(at.r - 1, 0), c: at.c },
    };
    const move = moves[e.key];
    if (move !== undefined) {
      e.preventDefault();
      if (move.r !== at.r || move.c !== at.c) choose(move);
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Return on a grid nothing is chosen in yet opens the first cell
      // rather than toggling a list that was never shown.
      setChosen(at);
      setOpen(chosen === null ? true : !open);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  const labelOf = ({ r, c }: Cell) =>
    `${matrix.rows[r]!.question} · ${matrix.columns[c]!.display}`;
  const material = chosen === null ? [] : matrix.material[chosen.r]![chosen.c]!;

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
      <div
        role="grid"
        aria-label="Coverage: questions by tags"
        aria-activedescendant={chosenId}
        aria-expanded={open}
        tabIndex={0}
        onFocus={() => setChosen((was) => was ?? ORIGIN)}
        onKeyDown={onKeyDown}
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
                {row.weight === 0 && reviewable.has(row.path) && (
                  <ReviewLinks
                    question={row.question}
                    onClick={() => onReview?.(row.path)}
                  />
                )}
              </span>
              {matrix.columns.map((column, c) => {
                const count = matrix.cells[r]![c]!;
                const label = `${labelOf({ r, c })}: ${items(count)}`;
                const here = chosen?.r === r && chosen.c === c;
                return (
                  <span
                    key={column.canonical}
                    id={cellId({ r, c })}
                    role="gridcell"
                    tabIndex={-1}
                    aria-selected={here}
                    className={`${styles.cell} ${styles[binOf(count)]} ${here ? styles.chosen : ""}`}
                    aria-label={label}
                    title={label}
                    onClick={() => {
                      setChosen({ r, c });
                      setOpen(!(here && open));
                    }}
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
      {chosen !== null && (
        // The exact count for a cell the shading and an unprinted zero leave
        // unsaid: intensity is never colour alone (decision 11).
        <p role="status" className={styles.readout}>
          {labelOf(chosen)}: {items(matrix.cells[chosen.r]![chosen.c]!)}
        </p>
      )}
      {chosen !== null && open && (
        <ul
          className={styles.material}
          aria-label={`Material: ${labelOf(chosen)}`}
        >
          {material.length === 0 && <li>No Material</li>}
          {material.map((item) => {
            const address = addressOf(item.kind, item.path);
            // A stub has no Reader yet: it is named and left alone.
            return (
              <li key={item.path}>
                {address === null ? (
                  `${item.display} (stub)`
                ) : (
                  <a href={address}>{item.display}</a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
