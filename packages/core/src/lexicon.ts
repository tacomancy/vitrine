import { NO_EDITS, type LexiconEdits } from "./lexicon-edits.js";
import { normalisePhrase } from "./lexicon-phrases.js";
import { compileOpenAlexQuery, type OpenAlexErrorKind } from "./openalex.js";
import {
  NONE,
  yearCounts,
  type Measurement,
  type Measurements,
} from "./measurements.js";
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
/**
 * Works the field must hold in the 12 months before the last 12 for a
 * percentage to mean anything; below it a Tag is unplaced (ADR 0045 d.5).
 */
export const FIELD_FLOOR = 50;
/** How many complete months a Measurement keeps (ADR 0045 d.1). */
export const MEASURED_MONTHS = 24;
/** A Measurement older than this is due again at the next *Sync now*. */
export const STALE_DAYS = 7;
const DAY_MS = 86_400_000;

/** A median of two is not a split: under this many placed Tags no quadrant is drawn. */
export const QUADRANT_MIN = 4;

export type TermOrigin = "derived" | "author keyword" | "seeded";
export type Term = { term: string; origin: TermOrigin };

/** What a Tag's Measurement says, judged on read. */
export type Judged = {
  state: "not yet measured" | "unplaced" | "measured";
  reason: "few-papers" | "few-in-field" | null;
  /** (last 12 − prior 12) ÷ prior 12; null unless measured. */
  growth: number | null;
  /** The field's works in the last 12 complete months and the 12 before; null until measured. */
  counts: { last12: number; prior12: number } | null;
  measuredAt: string | null;
  /**
   * Re-measure pending: the Tag's current compiled query is not the one its
   * newest Measurement was made with, so its point is the old one (ADR 0018
   * decision 7). Derived from the two queries on every read, never set, so it
   * clears the moment a sync stores a Measurement under the current query.
   */
  pending: boolean;
};

export type AttentionTag = Judged & {
  /** Canonical, at the page's depth. */
  tag: string;
  display: string;
  /** The Tag's papers: every Source and stub held that it covers (not the matrix's Coverage). */
  papers: number;
  /** Of those, the ones with title or abstract text to derive from. */
  withText: number;
  /** The OpenAlex query the Tag's Terms compile to now; null when it is unplaced or has none. */
  query: string | null;
};

/**
 * Whether a sync would measure the Tag: it was never measured, its query
 * changed, or it was measured more than `STALE_DAYS` ago. A Tag with too few
 * papers has no Lexicon to send, and one with no query has nothing to ask.
 */
export const isDue = (tag: AttentionTag, now: Date): boolean => {
  if (tag.reason === "few-papers" || tag.query === null) return false;
  if (tag.measuredAt === null || tag.pending) return true;
  return now.getTime() - Date.parse(tag.measuredAt) > STALE_DAYS * DAY_MS;
};

export type Attention = {
  depth: number;
  deepest: number;
  /** Papers held, whatever their Tags. */
  sources: number;
  /** The oldest measurement among the Tags shown; null until a sync has measured one. */
  asOf: string | null;
  /** Whether *Sync now* has ever been confirmed; until it has, no request is made. */
  synced: boolean;
  /** How many of `tags` a sync would measure now (`isDue`): a failed sync leaves them counted, so it never looks like a quiet field. */
  due: number;
  /** Most papers first, then by name. */
  tags: AttentionTag[];
  /** Where the scatter's axes cross; null while fewer than `QUADRANT_MIN` Tags are placed. */
  crossing: Crossing | null;
};

/** The median of the placed Tags the chart's axes cross at (ADR 0045 decision 6). */
export type Crossing = { placed: number; papers: number; growth: number };

export type SyncResult = {
  measured: number;
  /** A Tag whose measuring failed keeps its last Measurement and is named here. */
  failed: Array<{ tag: string; kind: OpenAlexErrorKind }>;
  /** Tags still to measure after a rate limit stopped the sync. */
  waiting: number;
};

export type LexiconView = {
  tag: string;
  display: string;
  depth: number;
  papers: number;
  withText: number;
  /** Enough papers, and the field not too thin to measure. */
  placed: boolean;
  reason: "few-papers" | "few-in-field" | null;
  /** What the field measured at, for a Tag judged on it. */
  counts: Judged["counts"];
  measuredAt: string | null;
  /** The Tag's old point stands until the next sync (`Judged.pending`). */
  pending: boolean;
  terms: Term[];
  notUsed: Term[];
  /** Terms the user Excluded for this Tag, so each can be restored. */
  excluded: string[];
  /** The OpenAlex query the Terms compile to, verbatim; null when there is nothing to compile. */
  query: string | null;
};

type Paper = {
  /** Phrase → occurrences in title and abstract. */
  text: Map<string, number>;
  keywords: Set<string>;
};

/** A Seed is the user's claim about what the Tag means, so it places a Tag at any paper count (ADR 0045). */
const isPlaced = (withText: number, seeded: boolean) =>
  seeded || withText >= PLACED_PAPERS;

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

/**
 * A Tag's state, derived on read from its stored counts, so the definition
 * can change without a re-fetch (ADR 0045 decision 1). Too few of the
 * vault's own papers outranks anything measured: the Lexicon is not there.
 */
function judge(
  placed: boolean,
  measurement: Measurement | undefined,
  query: string | null
): Judged {
  if (!placed) {
    return {
      state: "unplaced",
      reason: "few-papers",
      growth: null,
      counts: null,
      measuredAt: null,
      pending: false,
    };
  }
  if (measurement === undefined) {
    return {
      state: "not yet measured",
      reason: null,
      growth: null,
      counts: null,
      measuredAt: null,
      pending: false,
    };
  }
  const counts = yearCounts(measurement);
  const measuredAt = measurement.measuredAt;
  // The query is compared as stored, character for character: the compiler
  // is the one place that knows which differences matter.
  // A Tag left with no Terms has nothing to re-measure, so it cannot be
  // pending: no sync would ever clear the mark.
  const pending = query !== null && measurement.query !== query;
  if (counts.prior12 < FIELD_FLOOR) {
    return {
      state: "unplaced",
      reason: "few-in-field",
      growth: null,
      counts,
      measuredAt,
      pending,
    };
  }
  return {
    state: "measured",
    reason: null,
    growth: (counts.last12 - counts.prior12) / counts.prior12,
    counts,
    measuredAt,
    pending,
  };
}

const measurementOf = (store: Measurements, tag: string) =>
  store.measurements.find((m) => m.tag === tag);

export function attention(
  index: VaultIndex,
  store: Measurements,
  requested: number | undefined,
  edits: LexiconEdits,
  now: Date
): Attention {
  const { depth, deepest } = depthFor(index, requested);
  const papers = readPapers(index);
  const displays = tagDisplays(index);
  const byTag = papersByTag(index, depth, papers);
  const vocabulary = vocabularyOf(papers);
  const tags = [...byTag].map(([tag, held]): AttentionTag => {
    const withText = [...held].filter(
      (p) => papers.get(p)!.text.size > 0
    ).length;
    const placed = isPlaced(withText, (edits[tag]?.seeds.length ?? 0) > 0);
    // What the Tag would be asked as today, which is what a stored
    // Measurement's query is compared to. Unplaced has no Lexicon to compile.
    const query = placed
      ? lexiconAmong(
          papers,
          vocabulary,
          byTag,
          displays,
          NONE,
          tag,
          depth,
          edits
        ).query
      : null;
    return {
      tag,
      display: displays.get(tag) ?? tag,
      papers: held.size,
      withText,
      query,
      ...judge(placed, measurementOf(store, tag), query),
    };
  });
  tags.sort((a, b) => b.papers - a.papers || byName(a.tag, b.tag));
  // The oldest among the Tags shown, never an average: the picture is as old
  // as its stalest point. A Tag never measured has no date and adds none.
  const dates = tags
    .map((t) => t.measuredAt)
    .filter((at): at is string => at !== null)
    .sort();
  return {
    depth,
    deepest,
    sources: papers.size,
    asOf: dates[0] ?? null,
    synced: store.consentedAt !== null,
    due: tags.filter((t) => isDue(t, now)).length,
    tags,
    crossing: crossingOf(tags),
  };
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * Relative to the user's own vault, not to a fixed threshold that would be
 * arbitrary for most fields (ADR 0045 decision 6). Only measured Tags
 * count: an unplaced Tag has no growth, and counting its papers would move
 * a line it is not on the chart to be judged by.
 */
function crossingOf(tags: AttentionTag[]): Crossing | null {
  const placed = tags.filter((t) => t.state === "measured");
  if (placed.length < QUADRANT_MIN) return null;
  return {
    placed: placed.length,
    papers: median(placed.map((t) => t.papers)),
    growth: median(placed.map((t) => t.growth!)),
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
  store: Measurements,
  tag: string,
  requested?: number,
  edits: LexiconEdits = {}
): LexiconView {
  const { depth } = depthFor(index, requested);
  const papers = readPapers(index);
  return lexiconAmong(
    papers,
    vocabularyOf(papers),
    papersByTag(index, depth, papers),
    tagDisplays(index),
    store,
    tag,
    depth,
    edits
  );
}

/** How many papers could hold a phrase at all, and how many do, vault-wide. */
type Vocabulary = { papers: number; holding: Map<string, number> };

/**
 * Read once per request, not once per Tag: the rarity of a phrase is a
 * vault-wide fact, and the panel asks it for every Tag. Papers with no
 * phrases at all (no title, no abstract) cannot hold any, so they stay out of
 * the denominator.
 */
function vocabularyOf(papers: ReadonlyMap<string, Paper>): Vocabulary {
  const holding = new Map<string, number>();
  let counted = 0;
  for (const paper of papers.values()) {
    if (paper.text.size === 0 && paper.keywords.size === 0) continue;
    counted += 1;
    for (const phrase of new Set([...paper.text.keys(), ...paper.keywords])) {
      holding.set(phrase, (holding.get(phrase) ?? 0) + 1);
    }
  }
  return { papers: counted, holding };
}

/** One Tag's Lexicon over papers and Tag sets the caller has already read. */
function lexiconAmong(
  papers: ReadonlyMap<string, Paper>,
  vocabulary: Vocabulary,
  byTag: ReadonlyMap<string, ReadonlySet<string>>,
  displays: ReadonlyMap<string, string>,
  store: Measurements,
  tag: string,
  depth: number,
  edits: LexiconEdits
): LexiconView {
  const { seeds, excluded } = edits[tag] ?? NO_EDITS;
  const held = [...(byTag.get(tag) ?? [])].map((path) => papers.get(path)!);
  const withText = held.filter((p) => p.text.size > 0).length;
  const base = {
    tag,
    display: displays.get(tag) ?? tag,
    depth,
    papers: held.length,
    withText,
  };
  if (!isPlaced(withText, seeds.length > 0)) {
    return {
      ...base,
      placed: false,
      reason: "few-papers",
      counts: null,
      measuredAt: null,
      pending: false,
      terms: [],
      notUsed: [],
      excluded: [...excluded],
      query: null,
    };
  }

  const holds = (paper: Paper, phrase: string) =>
    paper.text.has(phrase) || paper.keywords.has(phrase);
  const candidates = new Set<string>();
  for (const paper of held) {
    for (const phrase of paper.text.keys()) candidates.add(phrase);
    for (const phrase of paper.keywords) candidates.add(phrase);
  }
  const scored: Array<Term & { score: number }> = [];
  for (const term of candidates) {
    // An Excluded Term is never derived back, and a Seed is already in use.
    if (excluded.includes(term) || seeds.includes(term)) continue;
    const inTag = held.filter((p) => holds(p, term)).length;
    const authored = held.some((p) => p.keywords.has(term));
    if (inTag < PHRASE_FLOOR && !authored) continue;
    const rarity = Math.log(vocabulary.papers / vocabulary.holding.get(term)!);
    scored.push({
      term,
      origin: authored ? "author keyword" : "derived",
      score: inTag * rarity * (authored ? KEYWORD_WEIGHT : 1),
    });
  }
  scored.sort((a, b) => b.score - a.score || byName(a.term, b.term));
  // Seeds sit at the top and always stay in use, so a later derivation can
  // never push the user's own claim below the cut; derived Terms fill what
  // is left of K.
  const derived = scored
    .filter((t) => t.score > 0)
    .slice(0, Math.max(0, LEXICON_TERMS - seeds.length))
    .map(({ term, origin }): Term => ({ term, origin }));
  const inUse: Term[] = [
    ...seeds.map((term): Term => ({ term, origin: "seeded" })),
    ...derived,
  ];
  const used = new Set(derived.map((t) => t.term));
  const query =
    inUse.length === 0 ? null : compileOpenAlexQuery(inUse.map((t) => t.term));
  const judged = judge(true, measurementOf(store, tag), query);
  return {
    ...base,
    // Placed unless the field turned out too thin to measure.
    placed: judged.reason === null,
    reason: judged.reason,
    counts: judged.counts,
    measuredAt: judged.measuredAt,
    pending: judged.pending,
    terms: inUse,
    notUsed: scored
      .filter((t) => !used.has(t.term))
      .slice(0, NOT_USED_SHOWN)
      .map(({ term, origin }): Term => ({ term, origin })),
    excluded: [...excluded],
    query,
  };
}

/**
 * Two Terms of one Lexicon, not one each from two: a single phrase is as
 * likely to be coincidence as topic.
 */
const KEYWORD_OVERLAP_TERMS = 2;

/**
 * Keyword overlap for Candidate links (ADR 0041 decision 9, ADR 0045): reads
 * the vault once, then answers, for a row's Tags as written, which papers
 * hold at least `KEYWORD_OVERLAP_TERMS` Terms in use of one of those Tags'
 * Lexicons, and which Terms. It does not know which papers share a Tag with
 * the row; the caller drops those, so a paper is never offered twice.
 */
export function keywordOverlap(index: VaultIndex, edits: LexiconEdits = {}) {
  const papers = readPapers(index);
  const vocabulary = vocabularyOf(papers);
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
      // Terms do not depend on a measurement, so none is passed.
      const view = lexiconAmong(
        papers,
        vocabulary,
        byTag,
        displays,
        NONE,
        tag,
        depth,
        edits
      );
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
