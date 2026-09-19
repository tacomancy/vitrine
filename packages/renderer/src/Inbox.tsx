import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState, type KeyboardEvent } from "react";
import type { Order } from "core";
import { formatAge } from "./age";
import { Detail } from "./Detail";
import styles from "./Inbox.module.css";
import { monthYear, provenanceOf, rowsOf, STATUS } from "./rows";
import { useTRPC } from "./trpc";

const ORDERS: readonly Order[] = ["newest", "oldest"];

/**
 * The Question Inbox: every Question in the vault, newest first, each with
 * its Provenance and age. One number in the chrome — how many exist — and
 * nothing that counts what is owed.
 */
export function Inbox() {
  const trpc = useTRPC();
  const [order, setOrder] = useState<Order>("newest");
  const [selected, setSelected] = useState<string | null>(null);
  // Switching the sort re-queries; the old list stays until the new one lands
  // rather than flashing empty.
  const listing = useQuery({
    ...trpc.questions.list.queryOptions({ order }),
    placeholderData: keepPreviousData,
  });

  const rows = listing.data ? rowsOf(listing.data, order) : [];
  const failed = listing.isError;
  const count = rows.length;
  // Oldest by capture (or mtime) regardless of the sort in force.
  const since = rows.reduce<string | null>(
    (oldest, row) =>
      oldest === null || Date.parse(row.when) < Date.parse(oldest)
        ? row.when
        : oldest,
    null
  );
  const selectedRow = rows.find((row) => row.path === selected) ?? null;
  const unreadable = listing.data?.unreadable ?? [];
  const now = new Date();

  // j/k and the arrows move the selection; ↵ selects the first row when
  // nothing is selected yet. The list is one tab stop.
  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (rows.length === 0) return;
    const index = rows.findIndex((row) => row.path === selected);
    let next: number | null = null;
    switch (event.key) {
      case "j":
      case "ArrowDown":
        next = Math.min(index + 1, rows.length - 1);
        break;
      case "k":
      case "ArrowUp":
        next = Math.max(index - 1, 0);
        break;
      case "Enter":
        next = index === -1 ? 0 : index;
        break;
      default:
        return;
    }
    event.preventDefault();
    setSelected(rows[next]?.path ?? null);
  }

  return (
    <>
      <section
        id="inbox"
        className={styles.inbox}
        aria-labelledby="inbox-title"
      >
        <div className={styles.header}>
          <h1 id="inbox-title" className={styles.title}>
            Question Inbox
          </h1>
          {/* A failed read must never read as an empty vault (no silent failures). */}
          {!failed && (
            <span className={styles.count}>
              {count} {count === 1 ? "question" : "questions"}
              {since !== null && ` · since ${monthYear(since)}`}
            </span>
          )}
          <div className={styles.sort} role="group" aria-label="Sort">
            <span className={styles.sortLabel}>Sort</span>
            {ORDERS.map((o) => (
              <button
                key={o}
                type="button"
                className={styles.sortOption}
                aria-pressed={o === order}
                onClick={() => setOrder(o)}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
        {failed && (
          <p className={styles.failed} role="alert">
            {listing.error.message}
          </p>
        )}
        <ul
          className={styles.list}
          role="listbox"
          aria-label="Questions"
          aria-activedescendant={
            selectedRow ? rowId(rows.indexOf(selectedRow)) : undefined
          }
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          {rows.map((row, index) => (
            <li
              key={row.path}
              id={rowId(index)}
              role="option"
              aria-selected={row.path === selected}
              className={styles.row}
              onClick={() => setSelected(row.path)}
            >
              {row.kind === "question" ? (
                <>
                  <span
                    className={
                      row.question.status === "open"
                        ? styles.glyphOpen
                        : styles.glyph
                    }
                    role="img"
                    aria-label={STATUS[row.question.status].label}
                    title={STATUS[row.question.status].label}
                  >
                    {STATUS[row.question.status].glyph}
                  </span>
                  <span className={styles.question}>
                    {row.question.question}
                  </span>
                  <span className={styles.provenance}>
                    {provenanceOf(row.question)}
                  </span>
                </>
              ) : (
                <>
                  <span
                    className={styles.glyph}
                    role="img"
                    aria-label="partial"
                    title="partial"
                  >
                    ◇
                  </span>
                  <span className={styles.question}>{row.partial.name}</span>
                  <span className={styles.provenance}>partial</span>
                </>
              )}
              <span className={styles.age}>{formatAge(row.when, now)}</span>
            </li>
          ))}
        </ul>
        {unreadable.length > 0 && (
          <details className={styles.footer}>
            <summary className={styles.footerLine}>
              {unreadable.length} {unreadable.length === 1 ? "file" : "files"}{" "}
              could not be read
            </summary>
            <ul className={styles.unreadable}>
              {unreadable.map((file) => (
                <li key={file.path}>
                  <span>{file.path}</span>
                  <span className={styles.reason}>{file.reason}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <Detail row={selectedRow} />
    </>
  );
}

// For aria-activedescendant; a path is unique but not id-safe, its index is.
const rowId = (index: number) => `question-row-${index}`;
