import { normalisePhrase } from "./lexicon-phrases.js";
import { rollUp, tagDisplays, threadMaterial } from "./question-map.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * The Lexicon, derived and read-only (ADR 0018, ADR 0045; `docs/
 * architecture.md` § Lexicon): what each Tag is measured as. Derived Terms
 * are a projection of the Index's phrase table, never stored, so they
 * recompute whenever a paper changes and cannot go stale.
 */

/** Terms in use; the rest are *not used* (§ Lexicon: K). */
export const LEXICON_TERMS = 10;
/** A phrase must recur in this many of the Tag's papers; an author keyword skips it. */
export const PHRASE_FLOOR = 2;
/** Papers with text a Tag needs to be placed at all (§ Lexicon: N). */
export const PLACED_PAPERS = 3;
/** The vote an author keyword carries over a derived phrase. */
export const KEYWORD_WEIGHT = 2;
/** How much of the *not used* line the editor is handed. */
export const NOT_USED_SHOWN = 20;

export type TermOrigin = "derived" | "author keyword";
export type Term = { term: string; origin: TermOrigin };

export type AttentionTag = {
  /** Canonical, at the page's depth. */
  tag: string;
  display: string;
  /** The Tag's papers: every Source and stub held that it covers (not the matrix's Coverage). */
  papers: number;
  /** Of those, the ones with title or abstract text to derive from. */
  withText: number;
  state: "not yet measured" | "unplaced";
  /** Why a Tag is unplaced; the renderer words it. */
  reason: "few-papers" | null;
};

export type Attention = {
  depth: number;
  deepest: number;
  /** Papers held, whatever their Tags. */
  sources: number;
  /** The oldest measurement shown; null until a sync has measured something. */
  asOf: string | null;
  synced: boolean;
  /** Most papers first, then by name. */
  tags: AttentionTag[];
};

export type LexiconView = {
  tag: string;
  display: string;
  depth: number;
  papers: number;
  withText: number;
  placed: boolean;
  reason: "few-papers" | null;
  terms: Term[];
  notUsed: Term[];
  /** The OpenAlex query the Terms compile to, verbatim; null when there is nothing to compile. */
  query: string | null;
};

type Paper = {
  /** Phrase → occurrences in title and abstract. */
  text: Map<string, number>;
  keywords: Set<string>;
};

const isPlaced = (withText: number) => withText >= PLACED_PAPERS;

const PAPER_KINDS = "('source', 'source-stub')";
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function readPapers(index: VaultIndex): Map<string, Paper> {
  const papers = new Map<string, Paper>();
  for (const { path, value } of index.select<{ path: string; value: string }>(
    `SELECT f.path AS path, fm.value AS value FROM files f
       LEFT JOIN frontmatter fm ON fm.path = f.path WHERE f.kind IN ${PAPER_KINDS}`
  )) {
    const keywords = new Set<string>();
    const raw = (JSON.parse(value ?? "{}") as Record<string, unknown>)[
      "keywords"
    ];
    const list =
      typeof raw === "string"
        ? raw.split(",")
        : Array.isArray(raw)
          ? raw.filter((k): k is string => typeof k === "string")
          : [];
    for (const keyword of list) {
      const phrase = normalisePhrase(keyword);
      if (phrase !== null) keywords.add(phrase);
    }
    papers.set(path, { text: new Map(), keywords });
  }
  for (const { path, phrase, count } of index.select<{
    path: string;
    phrase: string;
    count: number;
  }>("SELECT path, phrase, count FROM phrases")) {
    papers.get(path)?.text.set(phrase, count);
  }
  return papers;
}

/** The depth the page opens at: the deepest Tag any Source or stub carries, as Coverage's. */
function depthFor(index: VaultIndex, requested?: number) {
  const deepest = Math.max(
    1,
    ...index
      .select<{ canonical: string }>(
        `SELECT canonical FROM tags WHERE canonical IS NOT NULL
           AND path IN (SELECT path FROM files WHERE kind IN ${PAPER_KINDS})`
      )
      .map((t) => t.canonical.split("/").length)
  );
  return {
    deepest,
    depth: Math.min(deepest, Math.max(1, Math.trunc(requested ?? deepest))),
  };
}

/**
 * Tag → its papers, at a depth. Its own query: a paper carrying the Tag, or
 * reached from a thread (a Question of any Status, or a page) carrying it. A
 * parent is the union of its descendants through the roll-up, and a leaf is
 * only itself (ADR 0045 decision 8).
 */
function papersByTag(
  index: VaultIndex,
  depth: number,
  papers: ReadonlyMap<string, Paper>
): Map<string, Set<string>> {
  const tagsOf = new Map<string, string[]>();
  for (const { path, canonical } of index.select<{
    path: string;
    canonical: string;
  }>("SELECT path, canonical FROM tags WHERE canonical IS NOT NULL")) {
    tagsOf.set(path, [...(tagsOf.get(path) ?? []), canonical]);
  }
  const byTag = new Map<string, Set<string>>();
  const add = (carrier: string, paper: string) => {
    for (const tag of rollUp(tagsOf.get(carrier) ?? [], depth)) {
      byTag.set(tag, (byTag.get(tag) ?? new Set()).add(paper));
    }
  };
  for (const paper of papers.keys()) add(paper, paper);
  for (const { path, reached } of threadMaterial(index)) {
    for (const paper of reached) if (papers.has(paper)) add(path, paper);
  }
  return byTag;
}

export function attention(index: VaultIndex, requested?: number): Attention {
  const { depth, deepest } = depthFor(index, requested);
  const papers = readPapers(index);
  const displays = tagDisplays(index);
  const tags = [...papersByTag(index, depth, papers)].map(
    ([tag, held]): AttentionTag => {
      const withText = [...held].filter(
        (p) => papers.get(p)!.text.size > 0
      ).length;
      const placed = isPlaced(withText);
      return {
        tag,
        display: displays.get(tag) ?? tag,
        papers: held.size,
        withText,
        state: placed ? "not yet measured" : "unplaced",
        reason: placed ? null : "few-papers",
      };
    }
  );
  tags.sort((a, b) => b.papers - a.papers || byName(a.tag, b.tag));
  // No measurement store exists yet (a later ticket), so nothing is dated
  // and every placeable Tag is *not yet measured*; these literals become
  // derived values when it lands, not facts to keep.
  return {
    depth,
    deepest,
    sources: papers.size,
    asOf: null,
    synced: false,
    tags,
  };
}

/**
 * One Tag's Lexicon. Score = the Tag's papers containing the phrase × log
 * (papers in the vault ÷ papers containing it): a phrase every paper uses
 * scores nothing, which is what lets house vocabulary fall away. The rarity
 * is vault-wide and the votes are the Tag's own, so a leaf never inherits
 * its parent's Terms (ADR 0045 decision 3).
 */
export function lexiconOf(
  index: VaultIndex,
  tag: string,
  requested?: number
): LexiconView {
  const { depth } = depthFor(index, requested);
  const papers = readPapers(index);
  return lexiconAmong(
    papers,
    papersByTag(index, depth, papers),
    tagDisplays(index),
    tag,
    depth
  );
}

/** One Tag's Lexicon over papers and Tag sets the caller has already read. */
function lexiconAmong(
  papers: ReadonlyMap<string, Paper>,
  byTag: ReadonlyMap<string, ReadonlySet<string>>,
  displays: ReadonlyMap<string, string>,
  tag: string,
  depth: number
): LexiconView {
  const held = [...(byTag.get(tag) ?? [])].map((path) => papers.get(path)!);
  const withText = held.filter((p) => p.text.size > 0).length;
  const base = {
    tag,
    display: displays.get(tag) ?? tag,
    depth,
    papers: held.length,
    withText,
  };
  if (!isPlaced(withText)) {
    return {
      ...base,
      placed: false,
      reason: "few-papers",
      terms: [],
      notUsed: [],
      query: null,
    };
  }

  const holds = (paper: Paper, phrase: string) =>
    paper.text.has(phrase) || paper.keywords.has(phrase);
  // Papers with no phrases at all (no title, no abstract) cannot hold any
  // phrase, so they stay out of the rarity denominator.
  const everyPaper = [...papers.values()].filter(
    (p) => p.text.size > 0 || p.keywords.size > 0
  );
  const candidates = new Set<string>();
  for (const paper of held) {
    for (const phrase of paper.text.keys()) candidates.add(phrase);
    for (const phrase of paper.keywords) candidates.add(phrase);
  }
  const scored: Array<Term & { score: number }> = [];
  for (const term of candidates) {
    const inTag = held.filter((p) => holds(p, term)).length;
    const authored = held.some((p) => p.keywords.has(term));
    if (inTag < PHRASE_FLOOR && !authored) continue;
    const vaultWide = everyPaper.filter((p) => holds(p, term)).length;
    const rarity = Math.log(everyPaper.length / vaultWide);
    scored.push({
      term,
      origin: authored ? "author keyword" : "derived",
      score: inTag * rarity * (authored ? KEYWORD_WEIGHT : 1),
    });
  }
  scored.sort((a, b) => b.score - a.score || byName(a.term, b.term));
  const inUse = scored
    .filter((t) => t.score > 0)
    .slice(0, LEXICON_TERMS)
    .map(({ term, origin }): Term => ({ term, origin }));
  const used = new Set(inUse.map((t) => t.term));
  return {
    ...base,
    placed: true,
    reason: null,
    terms: inUse,
    notUsed: scored
      .filter((t) => !used.has(t.term))
      .slice(0, NOT_USED_SHOWN)
      .map(({ term, origin }): Term => ({ term, origin })),
    query:
      inUse.length === 0
        ? null
        : `filter=title_and_abstract.search:(${inUse.map((t) => `"${t.term}"`).join(" OR ")})`,
  };
}

/**
 * Keyword overlap for Candidate links (ADR 0041 decision 9, ADR 0045): reads
 * the vault once, then answers, for a row's Tags as written, which papers
 * hold at least two distinct Terms *of one Tag's Lexicon* and which Terms.
 * Two Terms of one Lexicon, not one each from two, because a single phrase
 * is as likely to be a coincidence as a topic; a paper that shares a Tag is
 * the shared-Tag path's, so its Terms are not asked for here.
 */
export const KEYWORD_OVERLAP_TERMS = 2;

export function keywordOverlap(index: VaultIndex) {
  const papers = readPapers(index);
  const displays = tagDisplays(index);
  const byDepth = new Map<number, Map<string, Set<string>>>();
  const lexicons = new Map<string, Set<string>>();
  const termsOf = (tag: string) => {
    const depth = tag.split("/").length;
    let byTag = byDepth.get(depth);
    if (byTag === undefined) {
      byTag = papersByTag(index, depth, papers);
      byDepth.set(depth, byTag);
    }
    let terms = lexicons.get(tag);
    if (terms === undefined) {
      const view = lexiconAmong(papers, byTag, displays, tag, depth);
      terms = new Set(view.terms.map((t) => t.term));
      lexicons.set(tag, terms);
    }
    return terms;
  };
  /** paper path → the Terms it holds, for the Tags of one row. */
  return (rowTags: Iterable<string>): Map<string, string[]> => {
    const matched = new Map<string, Set<string>>();
    for (const tag of rowTags) {
      const terms = termsOf(tag);
      for (const [path, paper] of papers) {
        const held = [...terms].filter((t) => paper.text.has(t));
        if (held.length < KEYWORD_OVERLAP_TERMS) continue;
        const soFar = matched.get(path) ?? new Set<string>();
        for (const t of held) soFar.add(t);
        matched.set(path, soFar);
      }
    }
    return new Map(
      [...matched].map(([path, terms]) => [path, [...terms].sort(byName)])
    );
  };
}
