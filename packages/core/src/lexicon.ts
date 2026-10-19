import { NO_EDITS, type LexiconEdits } from "./lexicon-edits.js";
import { normalisePhrase } from "./lexicon-phrases.js";
import { compileOpenAlexQuery, type OpenAlexErrorKind } from "./openalex.js";
import {
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
};

export type AttentionTag = Judged & {
  /** Canonical, at the page's depth. */
  tag: string;
  display: string;
  /** The Tag's papers: every Source and stub held that it covers (not the matrix's Coverage). */
  papers: number;
  /** Of those, the ones with title or abstract text to derive from. */
  withText: number;
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
  /** Most papers first, then by name. */
  tags: AttentionTag[];
};

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
function judge(placed: boolean, measurement: Measurement | undefined): Judged {
  if (!placed) {
    return {
      state: "unplaced",
      reason: "few-papers",
      growth: null,
      counts: null,
      measuredAt: null,
    };
  }
  if (measurement === undefined) {
    return {
      state: "not yet measured",
      reason: null,
      growth: null,
      counts: null,
      measuredAt: null,
    };
  }
  const counts = yearCounts(measurement);
  const measuredAt = measurement.measuredAt;
  if (counts.prior12 < FIELD_FLOOR) {
    return {
      state: "unplaced",
      reason: "few-in-field",
      growth: null,
      counts,
      measuredAt,
    };
  }
  return {
    state: "measured",
    reason: null,
    growth: (counts.last12 - counts.prior12) / counts.prior12,
    counts,
    measuredAt,
  };
}

const measurementOf = (store: Measurements, tag: string) =>
  store.measurements.find((m) => m.tag === tag);

export function attention(
  index: VaultIndex,
  store: Measurements,
  requested?: number,
  edits: LexiconEdits = {}
): Attention {
  const { depth, deepest } = depthFor(index, requested);
  const papers = readPapers(index);
  const displays = tagDisplays(index);
  const tags = [...papersByTag(index, depth, papers)].map(
    ([tag, held]): AttentionTag => {
      const withText = [...held].filter(
        (p) => papers.get(p)!.text.size > 0
      ).length;
      const placed = isPlaced(withText, (edits[tag]?.seeds.length ?? 0) > 0);
      return {
        tag,
        display: displays.get(tag) ?? tag,
        papers: held.size,
        withText,
        ...judge(placed, measurementOf(store, tag)),
      };
    }
  );
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
  store: Measurements,
  tag: string,
  requested?: number,
  edits: LexiconEdits = {}
): LexiconView {
  const { seeds, excluded } = edits[tag] ?? NO_EDITS;
  const { depth } = depthFor(index, requested);
  const papers = readPapers(index);
  const held = [...(papersByTag(index, depth, papers).get(tag) ?? [])].map(
    (path) => papers.get(path)!
  );
  const withText = held.filter((p) => p.text.size > 0).length;
  const base = {
    tag,
    display: tagDisplays(index).get(tag) ?? tag,
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
      terms: [],
      notUsed: [],
      excluded: [...excluded],
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
    // An Excluded Term is never derived back, and a Seed is already in use.
    if (excluded.includes(term) || seeds.includes(term)) continue;
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
  const judged = judge(true, measurementOf(store, tag));
  return {
    ...base,
    // Placed unless the field turned out too thin to measure.
    placed: judged.reason === null,
    reason: judged.reason,
    counts: judged.counts,
    measuredAt: judged.measuredAt,
    terms: inUse,
    notUsed: scored
      .filter((t) => !used.has(t.term))
      .slice(0, NOT_USED_SHOWN)
      .map(({ term, origin }): Term => ({ term, origin })),
    excluded: [...excluded],
    query:
      inUse.length === 0
        ? null
        : compileOpenAlexQuery(inUse.map((t) => t.term)),
  };
}
