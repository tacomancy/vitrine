import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileChoices } from "./vault-files.js";
import type { VaultIndex } from "./vault-index.js";

/** One linked backlink: a file that links to the open one, and where (spec #680; `docs/architecture.md` § Vault surface). */
export type Backlink = {
  /** The linking file, vault-relative. */
  path: string;
  /** Its `kind:` verbatim, null when it declares none. */
  kind: string | null;
  /** The heading the link sits under; null before any heading. The index reads links from the body only, so a frontmatter value is never a backlink. */
  field: string | null;
  /** Milliseconds: the file's own `created`/`captured`, else its modification time. */
  date: number;
  /** The line the link is on, read from the file at the link's offsets. */
  snippet: string;
  /** The `^h<n>`-style block the link targets in the open file, null for a file-level link. */
  block: string | null;
};

const SNIPPET_MAX = 200;

type Row = {
  path: string;
  start: number;
  block: string | null;
  kind: string | null;
  mtime: number | null;
  front: string | null;
};

/**
 * `vault.backlinks`: the links the index resolved to this file. A link is
 * counted only when it *resolved* here — an ambiguous one has no
 * `resolved_path`, so it counts for neither candidate, as Loose Ends and
 * every other surface agree it should (ADR 0036). A file's link to itself is
 * not a backlink. The snippet is read from the linking file's disk bytes at
 * the offsets the index stored; offsets are into the BOM-less text
 * (`fileChoices`), CRLF kept, so the same strip is applied before slicing.
 * A file that has since gone unreadable keeps its row with an empty snippet
 * rather than vanishing: the index says it links, and the pane says so.
 */
export async function backlinksOf(
  vaultPath: string,
  index: VaultIndex,
  path: string
): Promise<Backlink[]> {
  const rows = index.select<Row>(
    `SELECT l.path, l.start, l.block, f.kind, f.mtime, fm.value AS front
       FROM links l
       JOIN files f ON f.path = l.path
       LEFT JOIN frontmatter fm ON fm.path = l.path
      WHERE l.resolved_path = ? AND l.path <> ?
      ORDER BY l.path, l.start`,
    path,
    path
  );
  const texts = new Map<string, Promise<string | null>>();
  const textOf = (p: string) => {
    let text = texts.get(p);
    if (text === undefined) {
      text = readFile(join(vaultPath, p), "utf8").then(
        (raw) => fileChoices(raw).text,
        () => null
      );
      texts.set(p, text);
    }
    return text;
  };
  const out: Backlink[] = [];
  for (const row of rows) {
    const text = await textOf(row.path);
    const front =
      row.front === null
        ? {}
        : (JSON.parse(row.front) as Record<string, unknown>);
    out.push({
      path: row.path,
      kind: row.kind,
      field: headingAbove(index, row.path, row.start),
      date: dateOf(front, row.mtime),
      snippet: text === null ? "" : snippetAt(text, row.start),
      block: row.block,
    });
  }
  return out;
}

function snippetAt(text: string, at: number): string {
  const from = text.lastIndexOf("\n", at - 1) + 1;
  const next = text.indexOf("\n", at);
  const line = text
    .slice(from, next === -1 ? text.length : next)
    .replace(/\r$/, "")
    .trim();
  return line.length > SNIPPET_MAX ? `${line.slice(0, SNIPPET_MAX)}…` : line;
}

function headingAbove(
  index: VaultIndex,
  path: string,
  at: number
): string | null {
  const heading = index.select<{ text: string }>(
    "SELECT text FROM headings WHERE path = ? AND start <= ? ORDER BY start DESC LIMIT 1",
    path,
    at
  );
  return heading[0]?.text ?? null;
}

function dateOf(front: Record<string, unknown>, mtime: number | null): number {
  for (const key of ["created", "captured"]) {
    const value = front[key];
    const when =
      typeof value === "string"
        ? Date.parse(value)
        : value instanceof Date
          ? value.getTime()
          : NaN;
    if (!Number.isNaN(when)) return when;
  }
  return Math.round(mtime ?? 0);
}
