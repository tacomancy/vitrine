import type { VaultIndex } from "./vault-index.js";

/** How many files one search answers with; a common word must not hand the window a thousand rows. */
export const SEARCH_LIMIT = 50;

/** A matching line is shown whole up to this long, then cut around the first mark. */
const LINE_WIDTH = 160;

export type SearchHit = {
  /** Vault-relative, as the index keys it. */
  path: string;
  /** What `kind:` says, verbatim; null for a plain note. */
  kind: string | null;
  /** The first line of the body that holds a term, trimmed. */
  line: string;
  /** `[from, to)` offsets into `line` of each term found on it, in order. */
  marks: Array<[number, number]>;
};

const WORD = /[\p{L}\p{N}_]+/gu;

/**
 * Words only: FTS5 reads quotes, `AND`/`NOT`, `*` and `-` as syntax, and a
 * search box is typed into one character at a time, so a lone `"` mid-word
 * must be an empty answer and not an error. Each word becomes a quoted
 * string; the last also a prefix, since it is the one still being typed.
 */
const termsOf = (query: string) => query.match(WORD) ?? [];

/**
 * `vault.search`: files whose body holds every word of the query, best match
 * first, answered from the FTS5 table (ADR 0014 decision 12) — no file is
 * opened. The matching line and its marks are found in the stored body, in
 * the same case-insensitive word terms the query used, rather than taken
 * from FTS5's `snippet()`, whose markers would have to be parsed back out.
 */
export function searchVault(index: VaultIndex, query: string): SearchHit[] {
  const terms = termsOf(query);
  if (terms.length === 0) return [];
  const match = terms
    .map((term, at) => `"${term}"${at === terms.length - 1 ? "*" : ""}`)
    .join(" ");
  const rows = index.select<{
    path: string;
    kind: string | null;
    body: string;
  }>(
    `SELECT b.path AS path, f.kind AS kind, b.body AS body
       FROM bodies_fts JOIN bodies b ON b.rowid = bodies_fts.rowid
       JOIN files f ON f.path = b.path
      WHERE bodies_fts MATCH ? ORDER BY bodies_fts.rank, b.path LIMIT ${SEARCH_LIMIT}`,
    match
  );
  const wanted = terms.map((term, at) => ({
    word: term.toLowerCase(),
    prefix: at === terms.length - 1,
  }));
  return rows.map(({ path, kind, body }) => ({
    path,
    kind,
    ...lineOf(body, wanted),
  }));
}

/** The first line holding every term, else the first holding any, and where the terms sit on it. */
function lineOf(
  body: string,
  wanted: Array<{ word: string; prefix: boolean }>
): Pick<SearchHit, "line" | "marks"> {
  let first: Pick<SearchHit, "line" | "marks"> | null = null;
  for (const raw of body.split(/\r?\n/)) {
    const marks: Array<[number, number]> = [];
    const met = new Set<number>();
    for (const found of raw.matchAll(WORD)) {
      const word = found[0].toLowerCase();
      wanted.forEach((w, at) => {
        if (w.prefix ? word.startsWith(w.word) : word === w.word) {
          met.add(at);
          marks.push([found.index, found.index + found[0].length]);
        }
      });
    }
    if (marks.length === 0) continue;
    const here = clip(raw, marks);
    if (met.size === wanted.length) return here;
    first ??= here;
  }
  return first ?? { line: "", marks: [] };
}

/** Trim the line, and cut a long one to a window around its first mark. */
function clip(
  raw: string,
  marks: Array<[number, number]>
): Pick<SearchHit, "line" | "marks"> {
  const lead = raw.length - raw.trimStart().length;
  let from = lead;
  let line = raw.trim();
  let shifted = marks.map(([a, b]): [number, number] => [a - lead, b - lead]);
  if (line.length > LINE_WIDTH) {
    const start = Math.max(0, (shifted[0]?.[0] ?? 0) - 40);
    from = start;
    line = line.slice(start, start + LINE_WIDTH);
    shifted = shifted
      .map(([a, b]): [number, number] => [a - from, b - from])
      .filter(([a, b]) => a >= 0 && b <= line.length);
  }
  return { line, marks: shifted };
}
