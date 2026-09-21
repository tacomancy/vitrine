import type { TagSource } from "markdown";
import type { VaultIndex } from "./vault-index.js";

/**
 * `vault.tags`: every tag in the vault as one tree, a query over the index
 * (ADR 0014 decision 3; `docs/architecture.md` § Markdown, tag grammar).
 * Paths are vault-relative, as the index keys them.
 */
export type TagTree = {
  /** The first segments, sorted by canonical form; each nests its children the same way. */
  tags: TagNode[];
  /** Every `tags:` entry the grammar rejects, with its file — never dropped (ADR 0008 decision 8). */
  invalid: InvalidTagOccurrence[];
};

export type TagNode = {
  /** The identity the index counts by: `ml/probing`. */
  canonical: string;
  /** The full path in display casing — the majority form of each segment. */
  display: string;
  /** This node's own segment in display casing; `""` for the empty segment of `a//b` (T2c). */
  name: string;
  /** No occurrence names this tag exactly; it is here because a descendant is. */
  implicit: boolean;
  /** Occurrences: `exclusive` of this tag exactly, `inclusive` with every descendant. */
  count: { inclusive: number; exclusive: number };
  /** Every file carrying this tag or a descendant, sorted. */
  files: string[];
  /** The occurrences of this tag exactly, by file then position. */
  occurrences: TagOccurrence[];
  children: TagNode[];
};

export type TagOccurrence = {
  path: string;
  /** As written in the file, without a leading `#`. */
  written: string;
  source: TagSource;
};

export type InvalidTagOccurrence = {
  path: string;
  written: string;
  reason: string;
  source: TagSource;
};

type TagRow = {
  path: string;
  canonical: string | null;
  written: string;
  source: TagSource;
  invalid: string | null;
};

/** What is tallied per node while the rows stream past, before display casing is settled. */
type Building = {
  canonical: string;
  segment: string;
  exclusive: number;
  inclusive: number;
  files: Set<string>;
  occurrences: TagOccurrence[];
  /** Written forms of this node's own segment across every occurrence at or under it, with counts. */
  forms: Map<string, number>;
  children: Map<string, Building>;
};

/**
 * Display casing is the majority form of each segment across every
 * occurrence at or under that node — so the two `#ML/Probing` and one
 * `#ml/probing` in a vault show as `ML/Probing`, and the parent `ML` too. A
 * tie goes to the canonical form if it was written, else to the form that
 * sorts first, so the answer never depends on file order.
 */
function majority(forms: Map<string, number>, canonical: string): string {
  let best: string | null = null;
  let bestCount = -1;
  for (const [form, count] of [...forms].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )) {
    if (
      count > bestCount ||
      (count === bestCount && form === canonical && best !== canonical)
    ) {
      best = form;
      bestCount = count;
    }
  }
  return best ?? canonical;
}

export function tagTree(index: VaultIndex): TagTree {
  const rows = index.select<TagRow>(
    "SELECT path, canonical, written, source, invalid FROM tags ORDER BY path, start"
  );
  const roots = new Map<string, Building>();
  const invalid: InvalidTagOccurrence[] = [];

  const nodeFor = (
    parent: Building | null,
    canonical: string,
    segment: string
  ): Building => {
    const siblings = parent === null ? roots : parent.children;
    let node = siblings.get(canonical);
    if (node === undefined) {
      node = {
        canonical,
        segment,
        exclusive: 0,
        inclusive: 0,
        files: new Set(),
        occurrences: [],
        forms: new Map(),
        children: new Map(),
      };
      siblings.set(canonical, node);
    }
    return node;
  };

  for (const row of rows) {
    if (row.canonical === null) {
      invalid.push({
        path: row.path,
        written: row.written,
        reason: row.invalid ?? "invalid",
        source: row.source,
      });
      continue;
    }
    // The canonical form is the written one normalised, lowercased, and
    // stripped of trailing slashes (`canonicalTag`), so segment for segment
    // the two line up — which is what lets each segment's casing be tallied
    // against its canonical node.
    const written = row.written.normalize("NFC").replace(/\/+$/, "");
    const canonicalSegments = row.canonical.split("/");
    const writtenSegments = written.split("/");
    let node: Building | null = null;
    for (const [i, segment] of canonicalSegments.entries()) {
      const canonical = canonicalSegments.slice(0, i + 1).join("/");
      node = nodeFor(node, canonical, segment);
      node.inclusive++;
      node.files.add(row.path);
      const form = writtenSegments[i] ?? segment;
      node.forms.set(form, (node.forms.get(form) ?? 0) + 1);
    }
    if (node !== null) {
      node.exclusive++;
      node.occurrences.push({
        path: row.path,
        written: row.written,
        source: row.source,
      });
    }
  }

  const byCanonical = (a: { canonical: string }, b: { canonical: string }) =>
    a.canonical < b.canonical ? -1 : a.canonical > b.canonical ? 1 : 0;
  const finish = (node: Building, parentDisplay: string | null): TagNode => {
    const name = majority(node.forms, node.segment);
    const display = parentDisplay === null ? name : `${parentDisplay}/${name}`;
    return {
      canonical: node.canonical,
      display,
      name,
      implicit: node.exclusive === 0,
      count: { inclusive: node.inclusive, exclusive: node.exclusive },
      files: [...node.files].sort(),
      occurrences: node.occurrences,
      children: [...node.children.values()]
        .sort(byCanonical)
        .map((child) => finish(child, display)),
    };
  };

  return {
    tags: [...roots.values()].sort(byCanonical).map((n) => finish(n, null)),
    invalid,
  };
}
