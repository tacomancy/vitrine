import { parseWikilink } from "markdown";
import { readQuestion } from "./question-kind.js";
import { readResearchQuestion } from "./research-question.js";
import { tagTree, type TagNode } from "./vault-tags.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * The Question Map's Coverage (ADR 0041 decisions 5, 6, 8, 13;
 * `docs/architecture.md` § Question Map): which Material attaches to which
 * Map row, and which Tags that Material carries. One derivation over the
 * Index, shared by every reading on the page — the matrix, the four
 * readings and Origins are siblings over it, so none can count a thing the
 * others would not. Nothing is stored and no file is read from disk.
 *
 * Truncation, weights and the readings are not here; this is the part that
 * decides *what counts*, and the rest only counts it.
 */

export type MapRow = {
  kind: "question" | "research-question";
  /** Vault-relative, as the index keys it: the page's own for a Research Question. */
  path: string;
  id: string | null;
  question: string;
  /** The later of these is the row's recency, the matrix's tie-break (ADR 0041 decision 3). */
  captured: string | null;
  promoted: string | null;
  /** Distinct Sources and stubs, each once however it was reached or however many Tags it has. */
  material: MaterialItem[];
  /**
   * Related entries that reached no file or more than one. They contribute
   * no Material (ADR 0041 decision 13), and the row says so instead of
   * reading as plainly unanchored.
   */
  unresolved: Array<{ link: string; reason: string }>;
};

export type MaterialItem = {
  path: string;
  kind: "source" | "source-stub";
  display: string;
  /** Canonical, rolled up to the page's depth, distinct and sorted. */
  tags: string[];
};

export type Coverage = {
  /** The depth the Tags below are rolled up to. */
  depth: number;
  /** The deepest Tag in use by any Material on the Map: the default depth. */
  deepest: number;
  /** Newest first by recency, then path. */
  rows: MapRow[];
  /** Every Tag some Material on the Map carries at this depth, sorted by name. */
  tags: Array<{ canonical: string; display: string }>;
};

/**
 * A Tag at a depth: its first `depth` segments. A Tag already shallower
 * than that stays as it is, so at the deepest depth a parent never swallows
 * its children — it holds only what was tagged exactly that — and at a
 * shallower one a parent is the union of its own and its children's. An
 * Implicit parent (one nobody wrote) therefore appears only when rolled up
 * to, and as exactly the union of its children.
 */
export function rollUp(tags: readonly string[], depth: number): string[] {
  const rolled = tags.map((tag) => tag.split("/").slice(0, depth).join("/"));
  return [...new Set(rolled)].sort(byName);
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const MATERIAL_KINDS = ["source", "source-stub"];
// The three sections of a Research Question page that hold edges to Material
// (CONTEXT § Related, § Material). Open threads and the Working answer are
// prose, and a mention in prose is not an edge.
const EDGE_SECTIONS = [
  "Supporting sources",
  "Opposing sources",
  "Related questions",
];

type Frontmatter = Record<string, unknown>;

/** Where a `[[…]]` entry written in `owner` lands; null for text that is not a wikilink. */
function resolveEntry(index: VaultIndex, owner: string, entry: string) {
  const inner = /^\[\[(.*)\]\]$/.exec(entry.trim())?.[1];
  return inner === undefined
    ? null
    : index.resolve(owner, parseWikilink(inner));
}

export function coverage(index: VaultIndex, requested?: number): Coverage {
  const frontmatter = new Map<string, Frontmatter>();
  for (const row of index.select<{ path: string; value: string }>(
    `SELECT path, value FROM frontmatter WHERE path IN
       (SELECT path FROM files WHERE kind IN ('question', 'research-question', 'source-stub'))`
  )) {
    frontmatter.set(row.path, JSON.parse(row.value) as Frontmatter);
  }

  const rows = mapRows(index, frontmatter);
  const material = new Map<string, Omit<MaterialItem, "tags">>();
  const attached = new Map<string, Set<string>>();
  const attach = (row: MapRow, path: string) => {
    const set = attached.get(row.path) ?? new Set<string>();
    set.add(path);
    attached.set(row.path, set);
  };

  for (const row of rows) {
    for (const path of edgesOf(index, row, frontmatter)) {
      const file = index
        .select<{ kind: string | null; display: string | null }>(
          "SELECT kind, display FROM files WHERE path = ?",
          path
        )
        .at(0);
      // Only a Source or a stub is Material: a Related note or Question is
      // an edge, but not coverage (CONTEXT § Material).
      if (file?.kind == null || !MATERIAL_KINDS.includes(file.kind)) continue;
      material.set(path, {
        path,
        kind: file.kind as MaterialItem["kind"],
        display: file.display ?? path,
      });
      attach(row, path);
    }
    for (const path of stubsNaming(row, frontmatter)) {
      const file = index
        .select<{ display: string | null }>(
          "SELECT display FROM files WHERE path = ?",
          path
        )
        .at(0);
      material.set(path, {
        path,
        kind: "source-stub",
        display: file?.display ?? path,
      });
      attach(row, path);
    }
  }

  // Tags are read once per Material item, from the Source's own rows: a
  // highlight takes its Source's Tags because it resolves to the Source.
  const tagsByPath = new Map<string, string[]>();
  for (const { path, canonical } of index.select<{
    path: string;
    canonical: string;
  }>("SELECT path, canonical FROM tags WHERE canonical IS NOT NULL")) {
    if (!material.has(path)) continue;
    tagsByPath.set(path, [...(tagsByPath.get(path) ?? []), canonical]);
  }
  const deepest = Math.max(
    1,
    ...[...tagsByPath.values()].flat().map((t) => t.split("/").length)
  );
  const depth = Math.min(
    deepest,
    Math.max(1, Math.trunc(requested ?? deepest))
  );

  const used = new Set<string>();
  for (const row of rows) {
    row.material = [...(attached.get(row.path) ?? [])].sort().map((path) => {
      const item = material.get(path)!;
      const tags = rollUp(tagsByPath.get(path) ?? [], depth);
      for (const tag of tags) used.add(tag);
      return { ...item, tags };
    });
  }

  const displays = new Map<string, string>();
  const walk = (nodes: TagNode[]) => {
    for (const node of nodes) {
      displays.set(node.canonical, node.display);
      walk(node.children);
    }
  };
  walk(tagTree(index).tags);

  return {
    depth,
    deepest,
    rows: rows.sort(
      (a, b) => recency(b) - recency(a) || byName(a.path, b.path)
    ),
    tags: [...used].sort(byName).map((canonical) => ({
      canonical,
      display: displays.get(canonical) ?? canonical,
    })),
  };
}

const recency = (row: MapRow) =>
  Math.max(
    row.captured === null ? 0 : Date.parse(row.captured) || 0,
    row.promoted === null ? 0 : Date.parse(row.promoted) || 0
  );

/**
 * Open threads of inquiry (ADR 0041 decision 6): an open Question that no
 * page has been promoted from, and an open Research Question. A Question a
 * page was promoted from is folded into the page whatever its own Status
 * says now, so a thread is never two rows. Partial and Unreadable files fail
 * their Kind's reader and are not here (ADR 0009); the Map's footer counts
 * them.
 */
function mapRows(
  index: VaultIndex,
  frontmatter: Map<string, Frontmatter>
): MapRow[] {
  const kinds = new Map(
    index
      .select<{ path: string; kind: string }>(
        "SELECT path, kind FROM files WHERE kind IN ('question', 'research-question')"
      )
      .map((f) => [f.path, f.kind])
  );

  const pages: MapRow[] = [];
  const folded = new Set<string>();
  for (const [path, kind] of kinds) {
    if (kind !== "research-question") continue;
    let page;
    try {
      page = readResearchQuestion(frontmatter.get(path) ?? {});
    } catch {
      continue;
    }
    if (page.promotedFrom !== undefined) {
      const from = resolveEntry(index, path, page.promotedFrom)?.resolvedPath;
      if (from != null) folded.add(from);
    }
    if (page.status !== "open") continue;
    pages.push({
      kind: "research-question",
      path,
      id: page.id ?? null,
      question: page.question,
      captured: page.captured ?? null,
      promoted: page.promoted ?? null,
      material: [],
      unresolved: [],
    });
  }

  const questions: MapRow[] = [];
  for (const [path, kind] of kinds) {
    if (kind !== "question" || folded.has(path)) continue;
    let read;
    try {
      read = readQuestion(frontmatter.get(path) ?? {});
    } catch {
      continue;
    }
    if (read === null || read.status !== "open") continue;
    questions.push({
      kind: "question",
      path,
      id: read.id ?? null,
      question: read.question,
      captured: read.captured,
      promoted: null,
      material: [],
      unresolved: [],
    });
  }
  return [...questions, ...pages];
}

/**
 * The files a row's explicit edges land on, in the order met. Only edges the
 * user made count — a Question's `related:`, a page's Supporting, Opposing
 * and Related sections, and the `related:` of the Question the page came
 * from — and only where they resolve. A mention in prose, a `from:`, and a
 * shared Tag are not edges. A highlight link (`[[cite#^h3]]`) resolves to
 * its Source, so it lands on the file its Source does and counts once.
 * Entries that land on nothing are recorded on the row instead.
 */
function edgesOf(
  index: VaultIndex,
  row: MapRow,
  frontmatter: Map<string, Frontmatter>
): string[] {
  const landed: string[] = [];
  const fromRelated = (owner: string) => {
    for (const entry of relatedEntries(frontmatter.get(owner))) {
      const resolved = resolveEntry(index, owner, entry);
      if (resolved === null) continue;
      const { resolution, resolvedPath } = resolved;
      if (resolvedPath !== null) landed.push(resolvedPath);
      else
        row.unresolved.push({
          link: entry,
          reason:
            resolution === "ambiguous"
              ? "matches more than one file"
              : "matches no file in the vault",
        });
    }
  };

  if (row.kind === "question") {
    fromRelated(row.path);
    return landed;
  }

  for (const heading of index.select<{
    body_start: number;
    body_end: number;
  }>(
    `SELECT body_start, body_end FROM headings WHERE path = ? AND level = 2
       AND text IN (${EDGE_SECTIONS.map(() => "?").join(", ")})`,
    row.path,
    ...EDGE_SECTIONS
  )) {
    for (const link of index.select<{
      target: string;
      heading: string;
      block: string | null;
      resolution: string | null;
      resolved_path: string | null;
    }>(
      `SELECT target, heading, block, resolution, resolved_path FROM links
         WHERE path = ? AND start >= ? AND start < ? ORDER BY start`,
      row.path,
      heading.body_start,
      heading.body_end
    )) {
      if (link.resolved_path !== null && link.resolution === "resolved") {
        landed.push(link.resolved_path);
      } else {
        const fragment = (JSON.parse(link.heading) as string[])
          .map((h) => `#${h}`)
          .join("");
        row.unresolved.push({
          link: `[[${link.target}${fragment}${link.block === null ? "" : `#^${link.block}`}]]`,
          reason:
            link.resolution === "ambiguous"
              ? "matches more than one file"
              : "matches no file in the vault",
        });
      }
    }
  }
  // The thread's originating Question is folded in with its edges.
  const promotedFrom = frontmatter.get(row.path)?.["promoted_from"];
  const from =
    typeof promotedFrom === "string"
      ? resolveEntry(index, row.path, promotedFrom)?.resolvedPath
      : null;
  if (from != null) fromRelated(from);
  return landed;
}

/** `related:` as the list of entries it holds; a lone scalar is a one-item list. */
function relatedEntries(fm: Frontmatter | undefined): string[] {
  const value = fm?.["related"];
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * Stubs kept from a Scout assigned to this Question carry its id in
 * `origin_question` (§ Scouts); that is the other explicit edge. A page and
 * the Question it came from share the id, so a stub accepted before the
 * promotion still counts for the thread.
 */
function stubsNaming(
  row: MapRow,
  frontmatter: Map<string, Frontmatter>
): string[] {
  if (row.id === null) return [];
  const out: string[] = [];
  for (const [path, fm] of frontmatter) {
    const named = fm["origin_question"];
    if (Array.isArray(named) && named.includes(row.id)) out.push(path);
  }
  return out;
}

/** A paper offered for a Question, and the Tags that make it a candidate. */
export type CandidateLink = {
  path: string;
  kind: "source" | "source-stub";
  display: string;
  /** The Tags the paper shares with the Question, sorted: what the offer rests on. */
  shared: string[];
};

export type CandidateQuestion = {
  path: string;
  id: string | null;
  question: string;
  captured: string | null;
  /** Ranked: most shared Tags first, then the paper's file recency. */
  candidates: CandidateLink[];
};

/**
 * Candidate links (ADR 0041 decisions 9–10): for each unanchored Question
 * row, the papers that share a Tag with it. Inferred, so never counted by
 * `coverage`; it becomes Material only when the researcher accepts, which
 * writes a Related edge. A Research Question row is not offered here: its
 * Related section is an Edited section the link write does not reach.
 *
 * Tags compare as written, not rolled up to the page's depth: a candidate
 * must be explainable by a Tag the researcher can see on both files.
 * Questions with no candidate are absent, so the review lists only work to
 * do. A Question with none is therefore said by the review's empty
 * Claim, not per Question, until a row can enter the review (a later ticket).
 * Rejected pairs are not read here yet: reject is that ticket's.
 */
export function candidateLinks(index: VaultIndex): CandidateQuestion[] {
  const tagsOf = new Map<string, Set<string>>();
  for (const { path, canonical } of index.select<{
    path: string;
    canonical: string;
  }>("SELECT path, canonical FROM tags WHERE canonical IS NOT NULL")) {
    const set = tagsOf.get(path) ?? new Set<string>();
    set.add(canonical);
    tagsOf.set(path, set);
  }
  const papers = index.select<{
    path: string;
    kind: "source" | "source-stub";
    display: string | null;
    mtime: number | null;
  }>(
    "SELECT path, kind, display, mtime FROM files WHERE kind IN ('source', 'source-stub')"
  );

  const out: CandidateQuestion[] = [];
  for (const row of coverage(index).rows) {
    // Unanchored: no Material, so no paper is linked yet and none needs excluding.
    if (row.kind !== "question" || row.material.length > 0) continue;
    const mine = tagsOf.get(row.path);
    if (mine === undefined) continue;
    const found = papers.flatMap((paper) => {
      const shared = [...(tagsOf.get(paper.path) ?? [])]
        .filter((tag) => mine.has(tag))
        .sort(byName);
      return shared.length === 0 ? [] : [{ paper, shared }];
    });
    if (found.length === 0) continue;
    found.sort(
      (a, b) =>
        b.shared.length - a.shared.length ||
        (b.paper.mtime ?? 0) - (a.paper.mtime ?? 0) ||
        byName(a.paper.path, b.paper.path)
    );
    out.push({
      path: row.path,
      id: row.id,
      question: row.question,
      captured: row.captured,
      candidates: found.map(({ paper, shared }) => ({
        path: paper.path,
        kind: paper.kind,
        display: paper.display ?? paper.path,
        shared,
      })),
    });
  }
  return out.sort(
    (a, b) =>
      b.candidates.length - a.candidates.length ||
      (Date.parse(b.captured ?? "") || 0) -
        (Date.parse(a.captured ?? "") || 0) ||
      byName(a.path, b.path)
  );
}
