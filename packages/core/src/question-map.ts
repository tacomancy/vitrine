import { parseWikilink } from "markdown";
import { dismissed, readDismissals } from "./dismissals.js";
import { asString, readQuestion } from "./question-kind.js";
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
  /**
   * The id of the Question folded into this row: a Research Question stands
   * for the Question it was promoted from, so a Scout Assigned to either is
   * looking at this one thread (ADR 0042 decision 4). Null on a Question, and
   * where the folded Question is gone or has no id.
   */
  foldedId: string | null;
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
  for (const row of rows) {
    const set = new Set<string>();
    for (const item of materialOf(index, row, frontmatter)) {
      material.set(item.path, item);
      set.add(item.path);
    }
    attached.set(row.path, set);
  }

  // Tags are read once per Material item, from the Source's own rows: a
  // highlight takes its Source's Tags because it resolves to the Source.
  // The default depth is the deepest Tag in use by any Source or stub, not
  // only those attached, so the four readings (which cover unattached
  // Material too) and the matrix sit at the same depth.
  const anyMaterial = new Set(
    index
      .select<{ path: string }>(
        "SELECT path FROM files WHERE kind IN ('source', 'source-stub')"
      )
      .map((f) => f.path)
  );
  const tagsByPath = new Map<string, string[]>();
  for (const { path, canonical } of index.select<{
    path: string;
    canonical: string;
  }>("SELECT path, canonical FROM tags WHERE canonical IS NOT NULL")) {
    if (!anyMaterial.has(path)) continue;
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

  const displays = tagDisplays(index);

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

/**
 * The Material a thread reaches (CONTEXT § Material): the Sources and stubs on
 * its explicit edges, plus the stubs that name its id. Shared by the matrix's
 * rows and by Origins, which counts the same thing over Questions of every
 * Status, so the two cannot disagree about what attaches.
 */
function materialOf(
  index: VaultIndex,
  row: MapRow,
  frontmatter: Map<string, Frontmatter>
): Array<Omit<MaterialItem, "tags">> {
  const found: Array<Omit<MaterialItem, "tags">> = [];
  for (const path of edgesOf(index, row, frontmatter)) {
    const file = index
      .select<{ kind: string | null; display: string | null }>(
        "SELECT kind, display FROM files WHERE path = ?",
        path
      )
      .at(0);
    // Only a Source or a stub is Material: a Related note or Question is
    // an edge, but not coverage.
    if (file?.kind == null || !MATERIAL_KINDS.includes(file.kind)) continue;
    found.push({
      path,
      kind: file.kind as MaterialItem["kind"],
      display: file.display ?? path,
    });
  }
  for (const path of stubsNaming(row, frontmatter)) {
    const file = index
      .select<{ display: string | null }>(
        "SELECT display FROM files WHERE path = ?",
        path
      )
      .at(0);
    found.push({ path, kind: "source-stub", display: file?.display ?? path });
  }
  return found;
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
    let foldedId: string | null = null;
    if (page.promotedFrom !== undefined) {
      const from = resolveEntry(index, path, page.promotedFrom)?.resolvedPath;
      if (from != null) {
        folded.add(from);
        foldedId = asString(frontmatter.get(from)?.["id"]) ?? null;
      }
    }
    if (page.status !== "open") continue;
    pages.push({
      kind: "research-question",
      path,
      id: page.id ?? null,
      foldedId,
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
      foldedId: null,
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

/** Cut to this many rows, with the uncut count stated (ADR 0041 decision 2). */
export const ORIGINS_ROWS = 10;

export type OriginRow = {
  /** The target as the page names it; `unattached` for a capture with no document open. */
  label: string;
  /** Where the target landed, null for unattached and for text that is not a link or lands on nothing. */
  path: string | null;
  kind: string | null;
  /** Questions of any Status that name this target in `from`. */
  questions: number;
  /** Distinct Material attached to those Questions. */
  material: number;
};

export type Origins = {
  rows: OriginRow[];
  /** Every Origin, before the cut. */
  total: number;
};

/**
 * Where the researcher's Questions were captured from (ADR 0041 decision 2).
 * Two numbers per target and nothing else: how many Questions it produced,
 * and how much Material they reached, so a high first over a thin second
 * names a source worth going back to. No read count and no session count —
 * those are accumulation. A Question is counted whatever its Status: the
 * wondering happened whether or not the thread is still open.
 */
export function origins(index: VaultIndex, all = false): Origins {
  const frontmatter = new Map<string, Frontmatter>();
  for (const row of index.select<{ path: string; value: string }>(
    `SELECT path, value FROM frontmatter WHERE path IN
       (SELECT path FROM files WHERE kind IN ('question', 'research-question', 'source-stub'))`
  )) {
    frontmatter.set(row.path, JSON.parse(row.value) as Frontmatter);
  }
  const kinds = new Map(
    index
      .select<{ path: string; kind: string }>(
        "SELECT path, kind FROM files WHERE kind IN ('question', 'research-question')"
      )
      .map((f) => [f.path, f.kind])
  );

  // A promoted Question's later Material is attached on its page, so the
  // thread's page is read with it; otherwise a well-supported thread would
  // read as thin the moment it was promoted.
  const pageOf = new Map<string, string[]>();
  for (const [path, kind] of kinds) {
    if (kind !== "research-question") continue;
    const promotedFrom = frontmatter.get(path)?.["promoted_from"];
    const from =
      typeof promotedFrom === "string"
        ? resolveEntry(index, path, promotedFrom)?.resolvedPath
        : null;
    if (from != null) pageOf.set(from, [...(pageOf.get(from) ?? []), path]);
  }

  type Group = OriginRow & { reached: Set<string> };
  const groups = new Map<string, Group>();
  for (const [path, kind] of kinds) {
    if (kind !== "question") continue;
    let read;
    try {
      read = readQuestion(frontmatter.get(path) ?? {});
    } catch {
      // Unreadable and Partial Questions are the Map's footer line to count
      // (ADR 0009); Origins only counts what it can read.
      continue;
    }
    if (read === null) continue;

    const text = read.from?.trim() ?? "";
    const landed =
      text === ""
        ? null
        : (resolveEntry(index, path, text)?.resolvedPath ?? null);
    const key =
      text === ""
        ? "unattached"
        : landed === null
          ? `text:${text}`
          : `path:${landed}`;
    let group = groups.get(key);
    if (group === undefined) {
      const file =
        landed === null
          ? undefined
          : index
              .select<{ kind: string | null; display: string | null }>(
                "SELECT kind, display FROM files WHERE path = ?",
                landed
              )
              .at(0);
      group = {
        label:
          text === ""
            ? "unattached"
            : landed === null
              ? text
              : (file?.display ?? landed),
        path: landed,
        kind: file?.kind ?? null,
        questions: 0,
        material: 0,
        reached: new Set(),
      };
    }
    groups.set(key, group);
    group.questions += 1;

    const threads: MapRow[] = [path, ...(pageOf.get(path) ?? [])].map((p) => ({
      kind: kinds.get(p) as MapRow["kind"],
      path: p,
      id: asString(frontmatter.get(p)?.["id"]) ?? null,
      foldedId: null,
      question: read.question,
      captured: null,
      promoted: null,
      material: [],
      unresolved: [],
    }));
    for (const thread of threads) {
      for (const item of materialOf(index, thread, frontmatter)) {
        group.reached.add(item.path);
      }
    }
  }

  const ranked = [...groups.values()]
    .map(({ reached, ...row }) => ({ ...row, material: reached.size }))
    .sort(
      (a, b) =>
        b.questions - a.questions ||
        byName(a.label.toLowerCase(), b.label.toLowerCase()) ||
        byName(a.label, b.label)
    );
  return {
    rows: all ? ranked : ranked.slice(0, ORIGINS_ROWS),
    total: ranked.length,
  };
}

function tagDisplays(index: VaultIndex): Map<string, string> {
  const displays = new Map<string, string>();
  const walk = (nodes: TagNode[]) => {
    for (const node of nodes) {
      displays.set(node.canonical, node.display);
      walk(node.children);
    }
  };
  walk(tagTree(index).tags);
  return displays;
}

/**
 * How many rows the well-supported reading holds. The reading is "the top of
 * the weight sort" and carries no threshold of its own (CONTEXT), so the
 * only cut is a count; a row with no Material is never well-supported.
 */
export const WELL_SUPPORTED_ROWS = 5;

export type RowSummary = {
  kind: MapRow["kind"];
  path: string;
  id: string | null;
  question: string;
  material: number;
  /** Links in the row's Related that landed on nothing or on several: say so, not "plainly unanchored". */
  unresolved: MapRow["unresolved"];
};

export type Readings = {
  depth: number;
  /** Each reading carries its own count and full list: none is a field of another, and nothing sums them (#252). */
  wellSupported: { count: number; items: RowSummary[] };
  unanchored: { count: number; items: RowSummary[] };
  unquestionedKnowledge: {
    count: number;
    items: Array<{
      tag: string;
      display: string;
      material: Array<{ path: string; display: string }>;
    }>;
  };
  clockedButUnquestioned: {
    /** Stubs, each once, however many Tags it has. */
    count: number;
    items: Array<{
      tag: string;
      display: string;
      stubs: Array<{ path: string; display: string }>;
    }>;
  };
};

/**
 * The four readings (ADR 0041 decisions 4 and 7), over the same Coverage the
 * matrix reads and before any truncation: unanchored must still count rows
 * the matrix cut off, because the cut comes off the top of the sort and
 * the bare rows are exactly what falls away (#245). All are grouped by Tags
 * at the page's depth.
 */
export function readings(index: VaultIndex, requested?: number): Readings {
  const cov = coverage(index, requested);
  const displays = tagDisplays(index);
  const displayOf = (tag: string) => displays.get(tag) ?? tag;
  const summary = (row: MapRow): RowSummary => ({
    kind: row.kind,
    path: row.path,
    id: row.id,
    question: row.question,
    material: row.material.length,
    unresolved: row.unresolved,
  });

  const ranked = cov.rows
    .filter((row) => row.material.length > 0)
    .sort((a, b) => b.material.length - a.material.length);
  const wellSupported = ranked.slice(0, WELL_SUPPORTED_ROWS).map(summary);
  // `cov.rows` is already newest first.
  const unanchored = cov.rows
    .filter((row) => row.material.length === 0)
    .map(summary);

  // Tags no row's Material carries, over every Source and stub in the vault.
  const reached = new Set(
    cov.rows.flatMap((r) => r.material.flatMap((m) => m.tags))
  );
  const reachedPaths = new Set(
    cov.rows.flatMap((r) => r.material.map((m) => m.path))
  );
  const files = new Map(
    index
      .select<{ path: string; kind: string; display: string | null }>(
        "SELECT path, kind, display FROM files WHERE kind IN ('source', 'source-stub')"
      )
      .map((f) => [f.path, f])
  );
  const tagged = new Map<string, string[]>();
  for (const { path, canonical } of index.select<{
    path: string;
    canonical: string;
  }>("SELECT path, canonical FROM tags WHERE canonical IS NOT NULL")) {
    if (files.has(path))
      tagged.set(path, [...(tagged.get(path) ?? []), canonical]);
  }
  const byTag = new Map<string, Array<{ path: string; display: string }>>();
  for (const [path, tags] of tagged) {
    for (const tag of rollUp(tags, cov.depth)) {
      if (reached.has(tag)) continue;
      byTag.set(tag, [
        ...(byTag.get(tag) ?? []),
        { path, display: files.get(path)!.display ?? path },
      ]);
    }
  }
  const grouped = (
    groups: Map<string, Array<{ path: string; display: string }>>
  ) =>
    [...groups]
      .map(([tag, list]) => ({
        tag,
        display: displayOf(tag),
        list: list.sort((a, b) => byName(a.path, b.path)),
      }))
      .sort((a, b) => b.list.length - a.list.length || byName(a.tag, b.tag));
  const unquestionedKnowledge = grouped(byTag).map(
    ({ tag, display, list }) => ({
      tag,
      display,
      material: list,
    })
  );

  // A stub from a Scout assigned to nothing (`origin_question` empty) that no
  // Question has linked since, whether or not that Question is on the Map.
  const linked = new Set(
    index
      .select<{ resolved_path: string }>(
        `SELECT DISTINCT l.resolved_path FROM links l JOIN files f ON f.path = l.path
           WHERE l.resolution = 'resolved' AND l.resolved_path IS NOT NULL
             AND f.kind IN ('question', 'research-question')`
      )
      .map((l) => l.resolved_path)
  );
  const clocked = new Map<string, Array<{ path: string; display: string }>>();
  let clockedStubs = 0;
  for (const { path, value } of index.select<{ path: string; value: string }>(
    `SELECT path, value FROM frontmatter WHERE path IN
       (SELECT path FROM files WHERE kind = 'source-stub')`
  )) {
    const fm = JSON.parse(value) as Frontmatter;
    const assigned = fm["origin_question"];
    if (
      typeof fm["origin_scout"] !== "string" ||
      (Array.isArray(assigned) && assigned.length > 0) ||
      linked.has(path) ||
      reachedPaths.has(path)
    )
      continue;
    clockedStubs++;
    for (const tag of rollUp(tagged.get(path) ?? [], cov.depth)) {
      clocked.set(tag, [
        ...(clocked.get(tag) ?? []),
        { path, display: files.get(path)?.display ?? path },
      ]);
    }
  }
  const clockedButUnquestioned = grouped(clocked).map(
    ({ tag, display, list }) => ({ tag, display, stubs: list })
  );

  return {
    depth: cov.depth,
    wellSupported: { count: wellSupported.length, items: wellSupported },
    unanchored: { count: unanchored.length, items: unanchored },
    unquestionedKnowledge: {
      count: unquestionedKnowledge.length,
      items: unquestionedKnowledge,
    },
    clockedButUnquestioned: {
      count: clockedStubs,
      items: clockedButUnquestioned,
    },
  };
}

/** A paper offered for a Question, and the Tags that make it a candidate. */
export type CandidateLink = {
  path: string;
  kind: "source" | "source-stub";
  display: string;
  /** The Tags the paper shares with the Question, sorted: what the offer rests on. */
  shared: string[];
  /**
   * The dismissal that rejects this pair, for `looseEnds.dismiss` and its
   * undo: the Question's `id` and a row kind naming this paper alone, so one
   * rejection never silences another paper for the same Question.
   */
  rejection: { subject: string; kind: string };
};

export type CandidateQuestion = {
  /** Where accepting writes: a Question's `related:`, or a page's `## Related questions`. */
  kind: MapRow["kind"];
  path: string;
  id: string | null;
  question: string;
  captured: string | null;
  /** Ranked: most shared Tags first, then the paper's file recency. */
  candidates: CandidateLink[];
};

/**
 * Candidate links (ADR 0041 decisions 9–10): for each unanchored row,
 * Question or Research Question, the papers that share a Tag with it. Inferred, so never counted by
 * `coverage`; it becomes Material only when the researcher accepts, which
 * writes a Related edge.
 *
 * Tags compare as written, not rolled up to the page's depth: a candidate
 * must be explainable by a Tag the researcher can see on both files.
 * Questions with no candidate are absent, so the review lists only work to
 * do. A Question with none is therefore said by the review's empty
 * Claim, not per Question, until a row can enter the review (a later ticket).
 * Rejected pairs are not read here yet: reject is that ticket's.
 */
export async function candidateLinks(
  index: VaultIndex,
  vaultPath: string
): Promise<CandidateQuestion[]> {
  // A file that does not parse silences nothing (it is reported where it is
  // written to, not here): an offer left standing is the safe side of that.
  const { dismissals } = await readDismissals(vaultPath);
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
    id: string | null;
  }>(
    "SELECT path, kind, display, mtime, id FROM files WHERE kind IN ('source', 'source-stub')"
  );

  const out: CandidateQuestion[] = [];
  for (const row of coverage(index).rows) {
    // Unanchored: no Material, so no paper is linked yet and none needs excluding.
    if (row.material.length > 0) continue;
    const mine = tagsOf.get(row.path);
    if (mine === undefined) continue;
    // The Question's id, so a rename in Obsidian keeps its rejections; a
    // Question without one falls back to its path, as every dismissal does.
    const subject = row.id ?? row.path;
    const found = papers.flatMap((paper) => {
      if (dismissed(dismissals, subject, rejectionKind(paper))) return [];
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
      kind: row.kind,
      path: row.path,
      id: row.id,
      question: row.question,
      captured: row.captured,
      candidates: found.map(({ paper, shared }) => ({
        path: paper.path,
        kind: paper.kind,
        display: paper.display ?? paper.path,
        shared,
        rejection: { subject, kind: rejectionKind(paper) },
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

/** The matrix's shape, whatever the vault's size (ADR 0041 decision 3). */
export const MAP_ROWS = 24;
export const MAP_COLUMNS = 22;

export type Matrix = {
  depth: number;
  deepest: number;
  /** Heaviest first; ties newest first. */
  rows: Array<{
    kind: MapRow["kind"];
    path: string;
    question: string;
    /** Distinct Material attached to the row. */
    weight: number;
    unresolved: MapRow["unresolved"];
  }>;
  /** Heaviest first over the rows shown; ties by Tag name. */
  columns: Array<{ canonical: string; display: string; weight: number }>;
  /** `cells[row][column]`: distinct Material on that row carrying that Tag. */
  cells: number[][];
  /** `material[row][column]`: the items `cells` counts, for the cell's own list (decision 11). */
  material: MaterialItem[][][];
  /** Before the cut, so the page's stated line is built from real counts. */
  totals: { rows: number; columns: number };
};

/**
 * Cut the Coverage to what the matrix draws. The cut is here, not in the
 * renderer, so no surface can draw more than the constants allow and the
 * totals beside it are the ones the cut was made from. A column's weight is
 * counted over the rows that survive: Material only a cut row reaches is not
 * evidence for a column the reader can see.
 */
export function matrix(cover: Coverage): Matrix {
  // `cover.rows` is already newest first, and a stable sort keeps that order
  // among equal weights: the recency tie-break.
  const shown = [...cover.rows]
    .sort((a, b) => b.material.length - a.material.length)
    .slice(0, MAP_ROWS);

  const weighted = cover.tags.map((tag) => {
    const carrying = new Set<string>();
    for (const row of shown) {
      for (const item of row.material) {
        if (item.tags.includes(tag.canonical)) carrying.add(item.path);
      }
    }
    return { ...tag, weight: carrying.size };
  });
  // `cover.tags` is sorted by name, which the stable sort keeps among ties.
  const columns = weighted
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAP_COLUMNS);

  // One filter feeds both, so a cell's list and its count are the same set.
  const material = shown.map((row) =>
    columns.map((col) =>
      row.material.filter((item) => item.tags.includes(col.canonical))
    )
  );
  const cells = material.map((row) => row.map((items) => items.length));

  return {
    depth: cover.depth,
    deepest: cover.deepest,
    rows: shown.map((row) => ({
      kind: row.kind,
      path: row.path,
      question: row.question,
      weight: row.material.length,
      unresolved: row.unresolved,
    })),
    columns,
    cells,
    material,
    totals: { rows: cover.rows.length, columns: cover.tags.length },
  };
}

/** A paper's `id` survives its file being renamed; a stub with none falls back to its path. */
const rejectionKind = (paper: { id: string | null; path: string }) =>
  `inferred-link:${paper.id ?? paper.path}`;

export type Unread = {
  partial: Array<{ path: string; reason: string }>;
  unreadable: Array<{ path: string; reason: string }>;
};

/**
 * The Questions the Map skipped (ADR 0041 decision 13). `coverage` drops a
 * file that fails its Kind's reader (ADR 0009), so without this a Question
 * the researcher wrote would vanish from the page without a word. Read from
 * the Index's `problems` — the channels the Inbox already counts — limited
 * to the Kinds that can be Map rows.
 */
export function unread(index: VaultIndex): Unread {
  const found = index.select<{
    path: string;
    channel: string;
    problem: string;
  }>(
    `SELECT p.path, p.channel, p.problem FROM problems p JOIN files f USING (path)
       WHERE p.channel IN ('partial', 'unreadable')
         AND f.kind IN ('question', 'research-question') ORDER BY p.path`
  );
  const of = (channel: string) =>
    found
      .filter((p) => p.channel === channel)
      .map(({ path, problem }) => ({ path, reason: problem }));
  return { partial: of("partial"), unreadable: of("unreadable") };
}
