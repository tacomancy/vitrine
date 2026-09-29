import type { AnnotationKind } from "./pdf-engine.js";

/**
 * Annotation re-matching (ADR 0007; `docs/architecture.md` § Annotation
 * identity): which annotation now in the file is each identity Vitrine
 * already knew.
 *
 * **Load-bearing.** A link to `[[citekey#^h12]]` is only as good as this
 * function's answer to "is that still the same highlight?". Every way it can
 * be wrong is silent: an identity handed to the wrong annotation makes the
 * link land on a different passage and nothing says so, and one dropped
 * makes the link rot. So every tier below says what drifting costs, and the
 * one rule that closes them all is that ambiguity is a decision — an
 * identity the tiers cannot settle is *Unmatched* and asked about, never
 * guessed at. A matcher that fails loudly is the design; one that drifts is
 * the failure the brief calls most dangerous (§ Annotation storage).
 *
 * A pure function of raw values: the identities as the sidecar holds them,
 * the annotations the file holds now, and what links to each identity. It
 * reads no file and no index, so a threshold change fails a table test here
 * and, through Ingest, the same behaviour end to end. Every number and every
 * normalisation rule is in this file and never stored (ADR 0007 decision 8).
 */

/** Below this two boxes are different places; above it, the same one moved (§ Annotation identity, tier 4). */
export const GEOMETRY_THRESHOLD = 0.4;

/**
 * The quote under a highlight, reduced to what survives a Preview save:
 * NFKC (ligatures fall out), a hyphen at a line end joined to the next
 * line's word, whitespace collapsed, case folded. Applied to both sides at
 * compare time and never stored.
 */
export function normalise(quote: string): string {
  return quote
    .normalize("NFKC")
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, "$1$2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

type Family = "markup" | "note" | "ink" | "shape";

/** Kinds that may stand for one another: a highlight is never the note it was next to. */
const FAMILY: Record<AnnotationKind, Family> = {
  highlight: "markup",
  underline: "markup",
  strikeout: "markup",
  squiggly: "markup",
  text: "note",
  freetext: "note",
  ink: "ink",
  stamp: "ink",
  shape: "shape",
};

type Box = { left: number; right: number; bottom: number; top: number };

/** The union bounding box of an annotation's quads. */
function boxOf(quads: number[][]): Box {
  const box = {
    left: Infinity,
    right: -Infinity,
    bottom: Infinity,
    top: -Infinity,
  };
  for (const q of quads) {
    for (let i = 0; i < q.length; i += 2) {
      box.left = Math.min(box.left, q[i]!);
      box.right = Math.max(box.right, q[i]!);
      box.bottom = Math.min(box.bottom, q[i + 1]!);
      box.top = Math.max(box.top, q[i + 1]!);
    }
  }
  return box;
}

const area = (b: Box) =>
  Math.max(0, b.right - b.left) * Math.max(0, b.top - b.bottom);

/** Intersection over union of two annotations' bounding boxes, ignoring which page each is on. */
export function overlap(a: number[][], b: number[][]): number {
  const x = boxOf(a);
  const y = boxOf(b);
  const inter = area({
    left: Math.max(x.left, y.left),
    right: Math.min(x.right, y.right),
    bottom: Math.max(x.bottom, y.bottom),
    top: Math.min(x.top, y.top),
  });
  const union = area(x) + area(y) - inter;
  return union > 0 ? inter / union : 0;
}

/** Two overlaps closer than this are one number as far as a tie is concerned: float noise from the same boxes, not a real winner. */
const TIE_EPSILON = 1e-9;

/** An identity Vitrine already knows, as its sidecar entry holds it. */
export type Known = {
  id: string;
  kind: AnnotationKind;
  /** 0-based. */
  page: number;
  quads: number[][];
  /** Raw, as extracted. */
  quote: string;
  /** Only markup and notes have a block, and only a block can be linked to. */
  linkable: boolean;
  /**
   * Removed, or tombstoned by *drop the links*. Takes no part: a tombstone
   * that matched again would re-raise, on every Ingest, a decision already
   * made about links that still resolve.
   */
  retired?: boolean;
};

/** An annotation the file holds now. */
export type Present = {
  kind: AnnotationKind;
  page: number;
  /** Never empty: a kind with no quads is given its rectangle's. */
  quads: number[][];
  quote: string;
  /** /NM, when the file has one. */
  nm?: string | undefined;
};

/**
 * What points at an identity. `unknown` is not `unlinked`: it is the answer
 * when the index cannot be shown to be current, and it must never end in
 * removal (tier 5).
 */
export type LinkAnswer = "linked" | "unlinked" | "unknown";

export type MatchedBy = "object" | "text" | "text-moved" | "geometry";

export type Outcome =
  | { status: "skipped" }
  | {
      status: "matched";
      /** Index into `present`. */
      present: number;
      by: MatchedBy;
      /** Only a geometry match can find a different quote under the same identity. */
      quoteChanged: boolean;
    }
  | { status: "unmatched"; reason: "nothing" | "ambiguous" }
  | { status: "removed" };

export type Matching = {
  /** Parallel to `known`. */
  outcomes: Outcome[];
  /**
   * Annotations now in the file that an ambiguity made undecidable: held
   * with the Unmatched identities that contested them, so resolving that
   * row can relink one, and never counted as new.
   */
  held: number[];
  /** Annotations no identity wanted: new. */
  fresh: number[];
};

type Tier = {
  by: MatchedBy;
  /** Whether `present` may stand for `known` at this tier. */
  fits: (known: Known, present: Present) => boolean;
};

const sameFamily = (k: Known, p: Present) => FAMILY[k.kind] === FAMILY[p.kind];

/**
 * A quote can only confirm identity when there is one: two highlights over
 * an image both quote "", and equal nothing is not equal text. Without this
 * every quoteless annotation on a page would claim every other.
 */
const sameText = (k: Known, p: Present) => {
  const quote = normalise(k.quote);
  return quote !== "" && quote === normalise(p.quote);
};

const TIERS: Tier[] = [
  {
    // An /NM is a name Vitrine wrote, but a name alone is never trusted:
    // if it still carried the id while the text under it had changed to a
    // different passage, the link would land on that passage and the
    // brief's "text first" (§ Annotation storage) would be overridden by an
    // id. So the quote must agree — and, since a quoteless annotation has
    // nothing to disagree about, two empty quotes agree here.
    by: "object",
    fits: (k, p) =>
      p.nm === k.id &&
      sameFamily(k, p) &&
      normalise(k.quote) === normalise(p.quote),
  },
  {
    // The workhorse: Preview drops /NM on every save, so the passage is what
    // survives. Same page and same text is the same highlight even if it
    // moved a line. Silent drift here is two highlights of one sentence
    // swapping identities, so a candidate pool of more than one is broken by
    // geometry below and an unbroken tie is a decision.
    by: "text",
    fits: (k, p) => k.page === p.page && sameFamily(k, p) && sameText(k, p),
  },
  {
    // A re-exported PDF shifts pagination, so the same passage turns up on
    // another page. Kept apart from tier 2 because a quote found *anywhere*
    // is a weaker claim than one found where it was: it is the tier a common
    // phrase repeated across a paper would drift on, and it is reached
    // only after tier 2 has had every chance.
    by: "text-moved",
    fits: (k, p) => sameFamily(k, p) && sameText(k, p),
  },
  {
    // The user extended, trimmed or nudged a highlight, so the quote changed
    // and text has nothing to say: the place is what is left. It is the last
    // tier and the loosest, so it takes the least: the same page, and a
    // threshold (`GEOMETRY_THRESHOLD`) low enough for the two most ordinary
    // edits and high enough that a neighbouring highlight on the next line,
    // which shares no box, is never mistaken for it — that would hand a
    // link to a different passage without a word.
    by: "geometry",
    fits: (k, p) =>
      k.page === p.page &&
      sameFamily(k, p) &&
      overlap(k.quads, p.quads) >= GEOMETRY_THRESHOLD,
  },
];

/** The candidates' best by overlap: `null` when the top two are equal, which is a tie no geometry can break. */
function bestByOverlap(
  known: Known,
  candidates: number[],
  present: Present[]
): number | null {
  const scored = candidates
    .map((index) => ({
      index,
      score: overlap(known.quads, present[index]!.quads),
    }))
    .sort((a, b) => b.score - a.score);
  if (scored.length > 1 && scored[0]!.score - scored[1]!.score < TIE_EPSILON) {
    return null;
  }
  return scored[0]!.index;
}

export function matchAnnotations({
  known,
  present,
  links,
}: {
  known: Known[];
  present: Present[];
  links: (known: Known) => LinkAnswer;
}): Matching {
  const outcomes: Array<Outcome | undefined> = known.map((k) =>
    k.retired ? { status: "skipped" } : undefined
  );
  const claimed = new Set<number>();
  const held = new Set<number>();
  const open = () =>
    known.map((_, i) => i).filter((i) => outcomes[i] === undefined);

  for (const tier of TIERS) {
    // A candidate is proposed by every identity that wants it, and only a
    // candidate one identity wants is claimed. Two identities on one
    // candidate is ambiguity: neither can be shown to be the owner, and
    // giving it to whichever came first would be the silent drift.
    const proposals = new Map<number, number[]>();
    // What this tier makes undecidable is held only once the tier is done:
    // an identity that reaches the same tied candidates a moment later in the
    // loop must see them too, or it would fall through to *removed* for want
    // of a candidate its sibling had just set aside.
    const contested = new Set<number>();
    for (const i of open()) {
      const candidates = present
        .map((_, p) => p)
        .filter((p) => !claimed.has(p) && !held.has(p))
        .filter((p) => tier.fits(known[i]!, present[p]!));
      if (candidates.length === 0) continue;
      const best = bestByOverlap(known[i]!, candidates, present);
      if (best === null) {
        outcomes[i] = ambiguous(known[i]!);
        if (known[i]!.linkable) candidates.forEach((p) => contested.add(p));
        continue;
      }
      proposals.set(best, [...(proposals.get(best) ?? []), i]);
    }
    for (const [p, wanting] of proposals) {
      if (wanting.length > 1) {
        for (const i of wanting) outcomes[i] = ambiguous(known[i]!);
        if (wanting.some((i) => known[i]!.linkable)) contested.add(p);
        continue;
      }
      const i = wanting[0]!;
      claimed.add(p);
      outcomes[i] = {
        status: "matched",
        present: p,
        by: tier.by,
        quoteChanged:
          normalise(known[i]!.quote) !== normalise(present[p]!.quote),
      };
    }
    contested.forEach((p) => held.add(p));
  }

  // Tier 5. What is left failed every tier. An identity that cannot be
  // linked to (ink, a shape: no block) has nothing to lose. One that can is
  // *removed* only when the index has shown that nothing links to it: the
  // cheap failure is a decision the user is asked once, the expensive one is
  // a link that rots.
  for (const i of open()) {
    const k = known[i]!;
    outcomes[i] =
      !k.linkable || links(k) === "unlinked"
        ? { status: "removed" }
        : { status: "unmatched", reason: "nothing" };
  }

  return {
    outcomes: outcomes as Outcome[],
    held: [...held].filter((p) => !claimed.has(p)),
    fresh: present
      .map((_, p) => p)
      .filter((p) => !claimed.has(p) && !held.has(p)),
  };
}

/**
 * Ambiguity is a decision — but only where there is a panel to put it in.
 * An identity with no block (ink, a shape) is never linked to and has no
 * row, so for it the honest outcome is the one nothing else can be: it is
 * gone, and what it contested is new.
 */
function ambiguous(known: Known): Outcome {
  return known.linkable
    ? { status: "unmatched", reason: "ambiguous" }
    : { status: "removed" };
}
