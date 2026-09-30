import type { Connection } from "core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useChosenInView } from "./chosen";
import { KIND, markOf, routeOf } from "./kinds";
import styles from "./Reader.module.css";
import { pushRoute } from "./router";

/**
 * What points at a paper, in the two shapes the Reader shows it (spec #416
 * stories 80–86): a tick in the gutter beside the page for each highlight
 * something points at, and the Connections panel that lists all of it.
 * Both read the one list the core answers (`sources.connections`), so the
 * gutter cannot claim a link the panel does not list.
 */

/** The glyph for who points, and its words: three shapes, each labelled (BRAND.md law 6). */
export function markOfConnection(c: Connection) {
  const mark = c.kind === null ? undefined : markOf(c.kind);
  if (c.kind === "question") return KIND.question;
  if (c.kind === "research-question") return KIND["research-question"];
  // A Note or a Source: the quietest mark. Its label is what it is, so a
  // Hypothesis linking a highlight is not called a note.
  return { glyph: KIND.note.glyph, label: mark?.label ?? KIND.note.label };
}

/**
 * The one connection whose mark a highlight's tick shows, when several
 * point at it: an open Question first, because it is the one thing the
 * reader may owe an answer, then a Research Question, then any other
 * Question, then the rest. Only the first takes amber.
 */
const rank = (c: Connection) =>
  c.kind === "question" && c.open
    ? 0
    : c.kind === "research-question"
      ? 1
      : c.kind === "question"
        ? 2
        : 3;

export type Tick = { block: string; connection: Connection };

export function ticksOf(connections: readonly Connection[]): Tick[] {
  const byBlock = new Map<string, Connection>();
  for (const c of connections) {
    if (c.block === null) continue;
    const held = byBlock.get(c.block);
    if (held === undefined || rank(c) < rank(held)) byBlock.set(c.block, c);
  }
  return [...byBlock].map(([block, connection]) => ({ block, connection }));
}

const CONNECTION_ID = "reader-connection-";

/**
 * The panel that replaces the margin on its chord. It sits where the
 * margin sat, at the margin's width, so nothing on the page moves. A
 * keyboard list following its choice (ADR 0030): one tab stop, `j`/`k` and
 * the arrows move, `↵` opens, `esc` gives the margin back.
 */
export function ConnectionsPanel({
  connections,
  error,
  onClose,
}: {
  connections: readonly Connection[] | undefined;
  error: string | null;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [chosen, setChosen] = useState(0);
  const [said, setSaid] = useState<string | null>(null);
  const rows = connections ?? [];
  const at = Math.min(chosen, Math.max(rows.length - 1, 0));
  const chosenId = rows.length === 0 ? undefined : `${CONNECTION_ID}${at}`;
  useChosenInView(chosenId);
  // The keyboard lands on the list, so `j` moves from the first row.
  useEffect(() => listRef.current?.focus(), []);

  // A choice made is a message answered: the last click's words do not outlive it.
  function choose(i: number) {
    setChosen(i);
    setSaid(null);
  }

  function open(c: Connection) {
    const route = routeOf(c.kind, c.path);
    if (route !== null) {
      pushRoute(route);
      return;
    }
    // Named, not linked, and the click says so rather than doing nothing.
    setSaid(
      `${c.name} has no page in Vitrine to open: it is the file ${c.path}.`
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "j":
        event.preventDefault();
        choose(Math.min(at + 1, rows.length - 1));
        return;
      case "ArrowUp":
      case "k":
        event.preventDefault();
        choose(Math.max(at - 1, 0));
        return;
      case "Enter": {
        event.preventDefault();
        const row = rows[at];
        if (row !== undefined) open(row);
        return;
      }
      case "Escape":
        event.preventDefault();
        onClose();
        return;
      default:
        return;
    }
  }

  return (
    <aside className={styles.margin} aria-label="Connections">
      {/* A read that failed must never read as a paper nothing points at. */}
      {error !== null && (
        <p className={styles.line} role="alert">
          {error}
        </p>
      )}
      {error === null && connections?.length === 0 && (
        <p className={styles.line}>Nothing points at this paper yet.</p>
      )}
      {said !== null && (
        <p className={styles.line} role="status">
          {said}
        </p>
      )}
      <ul
        ref={listRef}
        className={styles.notes}
        role="listbox"
        aria-label="Connections"
        tabIndex={0}
        aria-activedescendant={chosenId}
        onKeyDown={onKeyDown}
      >
        {rows.map((c, i) => {
          const mark = markOfConnection(c);
          return (
            <li
              key={`${c.path}\0${c.block ?? ""}`}
              id={`${CONNECTION_ID}${i}`}
              role="option"
              aria-selected={i === at}
              className={styles.connection}
              onClick={() => {
                choose(i);
                open(c);
              }}
            >
              <span
                role="img"
                aria-label={mark.label}
                className={
                  c.kind === "question" && c.open
                    ? styles.open
                    : styles.glyphQuiet
                }
              >
                {mark.glyph}
              </span>
              <span className={styles.connectionName}>{c.name}</span>
              <span className={styles.where}>
                {c.page === null ? "whole paper" : `p.${c.page}`}
              </span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
