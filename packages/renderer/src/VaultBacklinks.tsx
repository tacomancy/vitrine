import { useQuery } from "@tanstack/react-query";
import { useState, type KeyboardEvent } from "react";
import type { SearchHit } from "core";
import { useChosenInView } from "./chosen";
import { FirstSlot, voiceOf } from "./FirstSlot";
import { markOf } from "./kinds";
import { pushRoute } from "./router";
import { useTRPC } from "./trpc";
import styles from "./Vault.module.css";
import { Marked } from "./VaultMarked";
import { useVaultStatusLines } from "./VaultStatusLines";

const day = (when: number) =>
  new Date(when).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });

// For aria-activedescendant: position is what decides whether a row is in
// view (ADR 0030), and a path is not id-safe.
const rowId = (index: number) => `vault-backlink-row-${index}`;

const mentionId = (index: number) => `vault-mention-row-${index}`;

// The keys every list of the pane answers to (ADR 0030): the choice moves,
// ↵ opens it.
function listKeys(
  at: number,
  count: number,
  choose: (to: number) => void,
  open: (index: number) => void
) {
  return (event: KeyboardEvent<HTMLUListElement>) => {
    const move = (to: number) => choose(Math.min(Math.max(to, 0), count - 1));
    switch (event.key) {
      case "ArrowDown":
        move(at + 1);
        break;
      case "ArrowUp":
        move(at - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(count - 1);
        break;
      case "Enter":
        open(at);
        break;
      default:
        return;
    }
    event.preventDefault();
  };
}

/**
 * The right pane: the files that link to the open one (spec #680;
 * `docs/architecture.md` § Vault surface). Linked backlinks only — the core
 * leaves out an ambiguous link, which counts for neither candidate. A row
 * opens the linking file in the Vault.
 */
export function VaultBacklinks({ path }: { path: string }) {
  const trpc = useTRPC();
  const backlinks = useQuery(trpc.vault.backlinks.queryOptions({ path }));
  const status = useVaultStatusLines();
  const [chosen, setChosen] = useState(0);
  const rows = backlinks.data ?? [];
  const at = Math.min(chosen, Math.max(rows.length - 1, 0));
  const activeId = rows.length === 0 ? undefined : rowId(at);
  useChosenInView(activeId);

  const open = (index: number) => {
    setChosen(index);
    const row = rows[index];
    if (row !== undefined) pushRoute({ surface: "vault", path: row.path });
  };
  const onKeyDown = listKeys(at, rows.length, setChosen, open);

  const voice = voiceOf({
    incomplete: backlinks.isError,
    answered: backlinks.data !== undefined,
    read: status.read,
  });

  return (
    <aside className={styles.backlinks} aria-label="Backlinks pane">
      <div className={styles.header}>
        <h2 className={styles.tab}>backlinks</h2>
      </div>
      {rows.length === 0 ? (
        <FirstSlot voice={voice} claim="Nothing links here yet.">
          No other file links to this one.
        </FirstSlot>
      ) : (
        <ul
          className={styles.tree}
          role="listbox"
          aria-label="Backlinks"
          aria-activedescendant={activeId}
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          {rows.map((row, index) => {
            const mark = markOf(row.kind ?? "note");
            const kind = mark?.label ?? row.kind ?? "note";
            return (
              <li
                key={`${row.path}:${index}`}
                id={rowId(index)}
                role="option"
                aria-selected={index === at}
                className={`${styles.row} ${styles.backlink}`}
                onClick={() => open(index)}
              >
                <span className={styles.glyph} aria-hidden="true">
                  {mark?.glyph ?? "·"}
                </span>
                <span className={styles.backlinkBody}>
                  <span className={styles.snippet}>{row.snippet}</span>
                  <span className={styles.kindLine}>
                    {[kind, row.field, day(row.date)]
                      .filter((part) => part !== null)
                      .join(" · ")}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <UnlinkedMentions path={path} />
    </aside>
  );
}

/**
 * Files whose text names the open one without linking it (#703). Quiet when
 * there are none, since this is a suggestion; never quiet when the read
 * failed (no silent failures).
 */
function UnlinkedMentions({ path }: { path: string }) {
  const trpc = useTRPC();
  const found = useQuery(trpc.vault.unlinkedMentions.queryOptions({ path }));
  const [chosen, setChosen] = useState(0);
  const hits: SearchHit[] = found.data ?? [];
  const at = Math.min(chosen, Math.max(hits.length - 1, 0));
  const activeId = hits.length === 0 ? undefined : mentionId(at);
  useChosenInView(activeId);
  // An empty answer is no claim worth a row, but a failed one is said.
  if (found.isError) return <FirstSlot voice="wrong" claim="" />;
  if (hits.length === 0) return null;

  const open = (index: number) => {
    setChosen(index);
    const hit = hits[index];
    if (hit !== undefined) pushRoute({ surface: "vault", path: hit.path });
  };
  return (
    <>
      <div className={styles.header}>
        <h2 className={styles.tab}>unlinked mentions</h2>
      </div>
      <ul
        className={styles.tree}
        role="listbox"
        aria-label="Unlinked mentions"
        aria-activedescendant={activeId}
        tabIndex={0}
        onKeyDown={listKeys(at, hits.length, setChosen, open)}
      >
        {hits.map((hit, index) => {
          const mark = markOf(hit.kind ?? "note");
          return (
            <li
              key={hit.path}
              id={mentionId(index)}
              role="option"
              aria-selected={index === at}
              className={`${styles.row} ${styles.backlink}`}
              onClick={() => open(index)}
            >
              <span className={styles.glyph} aria-hidden="true">
                {mark?.glyph ?? "·"}
              </span>
              <span className={styles.backlinkBody}>
                <span className={styles.snippet}>
                  <Marked line={hit.line} marks={hit.marks} />
                </span>
                <span className={styles.kindLine}>{hit.path}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
