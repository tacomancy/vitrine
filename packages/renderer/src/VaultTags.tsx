import { useQuery } from "@tanstack/react-query";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { useChosenInView } from "./chosen";
import { FirstSlot, voiceOf } from "./FirstSlot";
import { markOf } from "./kinds";
import { hashOf } from "./router";
import { useTRPC } from "./trpc";
import styles from "./Vault.module.css";
import { useVaultStatusLines } from "./VaultStatusLines";

/**
 * The Vault's *tags* tab (spec #680, #696): the tree `vault.tags` answers,
 * every count exactly as the core computed it — inclusive with the
 * descendants, exclusive of this level only — and a chosen node's files
 * beneath. Read-only by the brief (`#### Tags as topics`): no rename, merge
 * or drag. An invalid tag is listed with its reason and its file, never
 * dropped (ADR 0008 decision 8).
 */

type Node = {
  canonical: string;
  display: string;
  name: string;
  count: { inclusive: number; exclusive: number };
  files: string[];
  occurrences: { path: string; written: string }[];
  children: Node[];
};

type Row = { node: Node; depth: number; open: boolean };

/** The rows showing, top to bottom: a node's children follow it unless it is folded. */
function rowsOf(nodes: Node[], folded: ReadonlySet<string>, depth = 0): Row[] {
  return nodes.flatMap((node) => {
    const open = !folded.has(node.canonical);
    return [
      { node, depth, open },
      ...(open ? rowsOf(node.children, folded, depth + 1) : []),
    ];
  });
}

/**
 * The tags a file carries at or under `node`, as written there, in document
 * order of the tree. A parent's file list includes its children's files, so
 * what the file says for itself is the child's spelling — which is the
 * reason to show it.
 */
function writtenIn(node: Node, path: string): string[] {
  const own = node.occurrences
    .filter((o) => o.path === path)
    .map((o) => o.written);
  const below = node.children.flatMap((child) => writtenIn(child, path));
  return [...new Set([...own, ...below])];
}

// For aria-activedescendant; a position is id-safe where a tag is not (ADR 0030).
const rowId = (index: number) => `vault-tag-row-${index}`;

const fileLabel = (path: string) =>
  (path.split("/").at(-1) ?? path).replace(/\.md$/i, "");

export function Tags({ tabs }: { tabs: ReactNode }) {
  const trpc = useTRPC();
  const tags = useQuery(trpc.vault.tags.queryOptions());
  // The files' Kinds are the tree's; it is the same query the files tab reads.
  const tree = useQuery(trpc.vault.tree.queryOptions());
  const status = useVaultStatusLines();
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const roots = tags.data?.tags ?? [];
  const invalid = tags.data?.invalid ?? [];
  const rows = rowsOf(roots, folded);
  // A choice on a node that has since been folded away or removed falls
  // back to the first line rather than to nothing.
  const found = rows.findIndex((row) => row.node.canonical === chosenKey);
  const chosen = found === -1 ? 0 : found;
  const activeId = rows.length === 0 ? undefined : rowId(chosen);
  useChosenInView(activeId);

  const kindOf = new Map(tree.data?.map((f) => [f.path, f.kind]) ?? []);
  const pickedRow = rows.find((row) => row.node.canonical === picked);

  const toggle = (key: string, fold: boolean) =>
    setFolded((was) => {
      const next = new Set(was);
      if (fold) next.add(key);
      else next.delete(key);
      return next;
    });
  const pick = (row: Row) => {
    setChosenKey(row.node.canonical);
    setPicked(row.node.canonical);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const row = rows[chosen];
    if (row === undefined) return;
    const move = (to: number) => {
      const next = rows[Math.min(Math.max(to, 0), rows.length - 1)];
      if (next !== undefined) setChosenKey(next.node.canonical);
    };
    const branch = row.node.children.length > 0;
    switch (event.key) {
      case "ArrowDown":
        move(chosen + 1);
        break;
      case "ArrowUp":
        move(chosen - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(rows.length - 1);
        break;
      case "ArrowRight":
        if (branch && !row.open) toggle(row.node.canonical, false);
        break;
      case "ArrowLeft":
        if (branch && row.open) toggle(row.node.canonical, true);
        break;
      case "Enter":
        pick(row);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  // Only a vault read in full may say it holds no tags (ADR 0032); a failed
  // read is "not known", never an empty tree.
  const voice = voiceOf({
    incomplete: tags.isError,
    answered: tags.data !== undefined,
    read: status.read,
  });

  return (
    <div className={styles.files}>
      <div className={styles.header}>{tabs}</div>
      {rows.length === 0 ? (
        invalid.length === 0 && (
          <FirstSlot voice={voice} claim="No tags yet.">
            Nothing in this vault carries a tag. A #tag in a note, or a tags:
            entry in its properties, starts the tree.
          </FirstSlot>
        )
      ) : (
        <ul
          className={styles.tree}
          role="tree"
          aria-label="Tags"
          aria-activedescendant={activeId}
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          {rows.map((row, index) => {
            const { node } = row;
            const name = node.name === "" ? "(empty)" : node.name;
            const branch = node.children.length > 0;
            return (
              <li
                key={node.canonical}
                id={rowId(index)}
                role="treeitem"
                aria-label={`${name}, ${node.count.inclusive} in all, ${node.count.exclusive} at this level`}
                aria-level={row.depth + 1}
                aria-expanded={branch ? row.open : undefined}
                aria-selected={index === chosen}
                aria-current={node.canonical === picked ? "true" : undefined}
                className={styles.row}
                style={{
                  paddingLeft: `calc(var(--space-3) + ${row.depth} * var(--space-4))`,
                }}
                onClick={() => pick(row)}
              >
                <span
                  className={styles.glyph}
                  aria-hidden="true"
                  onClick={(event) => {
                    if (!branch) return;
                    event.stopPropagation();
                    setChosenKey(node.canonical);
                    toggle(node.canonical, row.open);
                  }}
                >
                  {branch ? (row.open ? "▾" : "▸") : "#"}
                </span>
                <span className={styles.name}>{name}</span>
                <span className={styles.count} aria-hidden="true">
                  {node.count.inclusive}
                  {node.count.exclusive !== node.count.inclusive &&
                    ` · ${node.count.exclusive}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {pickedRow !== undefined && (
        <ul
          className={styles.tagFiles}
          aria-label={`Files tagged ${pickedRow.node.display}`}
        >
          {pickedRow.node.files.map((path) => {
            const kind = markOf(kindOf.get(path) ?? "");
            const written = writtenIn(pickedRow.node, path).map((w) => `#${w}`);
            return (
              <li key={path}>
                <a
                  className={styles.tagFile}
                  href={hashOf({ surface: "vault", path })}
                  aria-label={[
                    fileLabel(path),
                    kind?.label,
                    `tagged ${written.join(", ")}`,
                  ]
                    .filter((part) => part !== undefined)
                    .join(", ")}
                >
                  <span className={styles.glyph} aria-hidden="true">
                    {kind?.glyph}
                  </span>
                  <span className={styles.name}>{fileLabel(path)}</span>
                  <span className={styles.written}>{written.join(" ")}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {invalid.length > 0 && (
        <>
          <h3 className={styles.invalidHead}>Invalid tags</h3>
          <ul className={styles.invalid} aria-label="Invalid tags">
            {invalid.map((tag) => (
              <li key={`${tag.path}\n${tag.written}\n${tag.source}`}>
                <code>{tag.written}</code> — {tag.reason}{" "}
                <a href={hashOf({ surface: "vault", path: tag.path })}>
                  {tag.path}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      {status.hasLines && (
        <footer className={styles.footer}>{status.lines}</footer>
      )}
    </div>
  );
}
