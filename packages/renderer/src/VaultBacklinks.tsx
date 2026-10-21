import { useQuery } from "@tanstack/react-query";
import type { Backlink } from "core";
import { useState } from "react";
import type { SearchHit } from "core";
import { useChosenInView } from "./chosen";
import { FirstSlot, voiceOf } from "./FirstSlot";
import { markOf } from "./kinds";
import { listKeys } from "./listKeys";
import { pushRoute } from "./router";
import { useTRPC } from "./trpc";
import styles from "./Vault.module.css";
import { Marked } from "./VaultMarked";
import { VaultGraph } from "./VaultGraph";
import { useVaultStatusLines } from "./VaultStatusLines";

const day = (when: number) =>
  new Date(when).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });

// For aria-activedescendant: position is what decides whether a row is in
// view (ADR 0030), and a path is not id-safe.
const rowId = (index: number) => `vault-backlink-row-${index}`;

type Group = { label: string; rows: Backlink[] };

/**
 * A Source's backlinks group by the highlight they target (`^h<n>`, in
 * highlight order), file-level links beneath — "which of my notes depend on
 * this passage" (spec #680 story 24). Rows with no block anywhere stay flat:
 * a lone *file-level* heading would group nothing. `rows` is the order drawn,
 * which is the order the keyboard moves in, so a choice index and an id mean
 * the same row whether or not the list is grouped.
 */
function arranged(data: Backlink[]): {
  rows: Backlink[];
  groups: Group[] | null;
} {
  if (data.every((row) => row.block === null)) {
    return { rows: data, groups: null };
  }
  const byBlock = new Map<string, Backlink[]>();
  const fileLevel: Backlink[] = [];
  for (const row of data) {
    if (row.block === null) fileLevel.push(row);
    else {
      const same = byBlock.get(row.block) ?? [];
      same.push(row);
      byBlock.set(row.block, same);
    }
  }
  const groups = [...byBlock]
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
    .map(([block, rows]) => ({ label: `^${block}`, rows }));
  if (fileLevel.length > 0) {
    groups.push({ label: "file-level", rows: fileLevel });
  }
  return { rows: groups.flatMap((group) => group.rows), groups };
}

const mentionId = (index: number) => `vault-mention-row-${index}`;

const VIEWS = ["backlinks", "graph"] as const;

/**
 * The right pane: *backlinks*, the files that link to the open one (spec
 * #680; `docs/architecture.md` § Vault surface), and beside it the *graph*
 * (#741, ADR 0047). Linked backlinks only — the core leaves out an ambiguous
 * link, which counts for neither candidate. A row opens the linking file in
 * the Vault. The lists are keyed by the open file, so a new file starts a new
 * choice, while the tab chosen stays: walking the graph must not bounce back
 * to backlinks.
 */
export function VaultBacklinks({ path }: { path: string }) {
  const [view, setView] = useState<(typeof VIEWS)[number]>("backlinks");
  return (
    <aside className={styles.backlinks} aria-label="Links pane">
      <div className={styles.header}>
        <div role="tablist" aria-label="Link views" className={styles.tabs}>
          {VIEWS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={`vault-links-tab-${name}`}
              aria-selected={view === name}
              aria-controls={`vault-links-panel-${name}`}
              className={styles.tab}
              onClick={() => setView(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <div
        role="tabpanel"
        id="vault-links-panel-backlinks"
        aria-labelledby="vault-links-tab-backlinks"
        className={styles.panel}
        hidden={view !== "backlinks"}
      >
        <Backlinks key={path} path={path} />
      </div>
      <div
        role="tabpanel"
        id="vault-links-panel-graph"
        aria-labelledby="vault-links-tab-graph"
        className={styles.panel}
        hidden={view !== "graph"}
      >
        {view === "graph" && <VaultGraph key={path} path={path} />}
      </div>
    </aside>
  );
}

function Backlinks({ path }: { path: string }) {
  const trpc = useTRPC();
  const backlinks = useQuery(trpc.vault.backlinks.queryOptions({ path }));
  const status = useVaultStatusLines();
  const [chosen, setChosen] = useState(0);
  const { rows, groups } = arranged(backlinks.data ?? []);
  const at = Math.min(chosen, Math.max(rows.length - 1, 0));
  const activeId = rows.length === 0 ? undefined : rowId(at);
  useChosenInView(activeId);

  const open = (index: number) => {
    setChosen(index);
    const row = rows[index];
    if (row !== undefined) pushRoute({ surface: "vault", path: row.path });
  };
  const onKeyDown = listKeys(at, rows.length, setChosen, open);

  const renderRow = (row: Backlink, index: number) => {
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
  };

  const voice = voiceOf({
    incomplete: backlinks.isError,
    answered: backlinks.data !== undefined,
    read: status.read,
  });

  return (
    <>
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
          {groups === null
            ? rows.map(renderRow)
            : groups.map((group, g) => (
                <li key={group.label} role="presentation">
                  <h3 className={styles.groupHead} aria-hidden="true">
                    {group.label}
                  </h3>
                  <ul role="group" aria-label={group.label}>
                    {group.rows.map((row, i) =>
                      renderRow(
                        row,
                        // The choice and the ids are positions in `rows`.
                        groups
                          .slice(0, g)
                          .reduce((n, { rows }) => n + rows.length, 0) + i
                      )
                    )}
                  </ul>
                </li>
              ))}
        </ul>
      )}
      <UnlinkedMentions path={path} />
    </>
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
