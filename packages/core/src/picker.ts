import { basename, posix } from "node:path";
import type { VaultIndex } from "./vault-index.js";

/**
 * The one picker (`docs/architecture.md` § Research Question view and
 * triage, One picker): a name-contains query over the index's `files`
 * table, narrowed by whoever opened it. Link (#211) asks for Questions,
 * Research Questions, Notes, Sources and stubs; attaching a source asks for
 * Sources and stubs; a why line asks for anything. A paper's row also
 * carries its title to show — shown, never matched: name search is all a
 * picker needs, and full-text is beat 11's — and no file is read here: like
 * every other list a surface shows, this is an index query (ADR 0014
 * decision 3).
 */

/**
 * A row's Kind, which is what its glyph says: the file's `kind:` verbatim,
 * or `note` for a Markdown file that declares none — an ordinary file,
 * which is what a Note is (CONTEXT.md). A `kind:` the app does not know is
 * carried through rather than folded into `note`, so a caller narrowing to
 * Notes never gets one.
 */
export type CandidateKind = string;

/** A Markdown file with no `kind:`. */
const NOTE = "note";

export type Candidate = {
  /** Vault-relative, as the index keys it: what the caller links to. */
  path: string;
  /** The file name without `.md` — what the row shows and what matched. */
  name: string;
  kind: CandidateKind;
  /**
   * On a Source or a stub: its `title:`, for the row to show beside the
   * citekey — `rasch2013` is not a paper anyone recognises by name. Absent
   * when the file carries no `title:`, rather than fallen back to the file
   * name the row already shows. Shown, never searched: matching a title is
   * the Vault editor's beat (CONTEXT.md *One picker*).
   */
  title?: string;
  /**
   * On a Source or a stub: whether its PDF is in the vault. Derived from
   * `sources/pdf/`, never from the `pdf:` key alone — a key naming a file
   * that is not there would otherwise promise a reader that cannot open.
   */
  pdf?: boolean;
};

/** `rows` is capped; `total` is how many matched, so a cut list can say so. */
export type Candidates = { rows: Candidate[]; total: number };

/** How many rows one ask returns; beyond it the picker asks for more typing. */
export const CANDIDATE_LIMIT = 50;

/** Where a Source's PDF lives (§ Vault layout): the one synced folder. */
const PDF_FOLDER = "sources/pdf";

/** The paper Kinds, which are the ones carrying a `title:` and a `pdf:`. */
const PAPER: ReadonlySet<CandidateKind> = new Set(["source", "source-stub"]);

export function candidates(
  index: VaultIndex,
  {
    query,
    kinds,
    exclude = [],
  }: {
    query: string;
    kinds?: CandidateKind[];
    /**
     * Vault-relative paths to leave out: what the caller is already
     * standing on. A row that could only be refused is worse than no row.
     */
    exclude?: string[];
  }
): Candidates {
  // `lstem` is the lowercased name without `.md`, already indexed; `\` is
  // LIKE's escape here so a name holding `%` or `_` matches itself.
  const like = `%${query.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
  const params: string[] = [like];
  const matched = index.select<{
    path: string;
    kind: string | null;
    frontmatter: string | null;
  }>(
    `SELECT f.path, f.kind, (SELECT value FROM frontmatter WHERE path = f.path) AS frontmatter
     FROM files f
     WHERE f.markdown = 1 AND f.lstem LIKE ? ESCAPE '\\'${narrowing(kinds, params)}${excluding(exclude, params)}`,
    ...params
  );

  const pdfs = matched.some((row) => PAPER.has(row.kind ?? NOTE))
    ? pdfFiles(index)
    : new Set<string>();
  const leads = (name: string) =>
    name.toLowerCase().startsWith(query.toLowerCase()) ? 0 : 1;
  const rows = matched
    .map(({ path, kind, frontmatter }): Candidate => {
      const candidate: Candidate = {
        path,
        name: basename(path, ".md"),
        kind: kind ?? NOTE,
      };
      if (PAPER.has(candidate.kind)) {
        const keys = frontmatterKeys(frontmatter);
        const title = keys["title"];
        if (typeof title === "string" && title !== "") candidate.title = title;
        candidate.pdf = pdfOf(keys, pdfs);
      }
      return candidate;
    })
    // What was typed at the front of a name is the likelier target than the
    // same letters buried in one; alphabetical within each group, so the
    // order never shifts as the index rewrites rows.
    .sort(
      (a, b) => leads(a.name) - leads(b.name) || a.name.localeCompare(b.name)
    );
  return { rows: rows.slice(0, CANDIDATE_LIMIT), total: rows.length };
}

/** ` AND f.path NOT IN (…)`, pushing the paths; nothing when there are none. */
function excluding(exclude: string[], params: string[]): string {
  if (exclude.length === 0) return "";
  params.push(...exclude);
  return ` AND f.path NOT IN (${exclude.map(() => "?").join(", ")})`;
}

/** ` AND (…)` for the caller's Kinds, pushing their parameters; every Kind when there is none. */
function narrowing(
  kinds: CandidateKind[] | undefined,
  params: string[]
): string {
  if (kinds === undefined) return "";
  const declared = kinds.filter((kind) => kind !== NOTE);
  const clauses: string[] = [];
  if (kinds.includes(NOTE)) clauses.push("f.kind IS NULL");
  if (declared.length > 0) {
    clauses.push(`f.kind IN (${declared.map(() => "?").join(", ")})`);
    params.push(...declared);
  }
  // A caller that narrowed to nothing gets nothing, not everything.
  return clauses.length === 0 ? " AND 0" : ` AND (${clauses.join(" OR ")})`;
}

/** Every file under `sources/pdf/`, by lowercased vault path. */
function pdfFiles(index: VaultIndex): Set<string> {
  const rows = index.select<{ lpath: string }>(
    "SELECT lpath FROM files WHERE lpath LIKE ?",
    `${PDF_FOLDER}/%`
  );
  return new Set(rows.map((row) => row.lpath));
}

/** The row's frontmatter as the index stored it; an absent one is no keys. */
function frontmatterKeys(frontmatter: string | null): Record<string, unknown> {
  if (frontmatter === null) return {};
  return JSON.parse(frontmatter) as Record<string, unknown>;
}

function pdfOf(keys: Record<string, unknown>, pdfs: Set<string>): boolean {
  const pdf = keys["pdf"];
  if (typeof pdf !== "string" || pdf === "") return false;
  return pdfs.has(posix.join(PDF_FOLDER, pdf).toLowerCase());
}
