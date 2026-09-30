import { basename } from "node:path";
import { overlap, sameKindFamily } from "./annotation-matcher.js";
import {
  readSidecar,
  type HeldAnnotation,
  type Sidecar,
  type SidecarAnnotation,
} from "./annotation-sidecar.js";
import { errorMessage, VaultError } from "./errors.js";
import type { AnnotationKind } from "./pdf-engine.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * Unmatched annotations (spec #416 stories 45–58; `docs/architecture.md`
 * § Annotation identity): the rows Loose Ends and the panel draw, and the
 * three ways a row is resolved. Everything here is a function of a sidecar,
 * so the row a researcher reads and the record a resolution writes cannot
 * disagree about what an Unmatched annotation is.
 *
 * There is one terminal state besides *relink*. *Drop the links* and *treat
 * as new* both end the old identity in a Tombstone (`gone_at`): the quote
 * and the block stay, every link to it still resolves, and no link is
 * rewritten. What differs is only what the researcher meant, so they share
 * one transform (`tombstone`) rather than two that could drift.
 */

/** What points at the annotation, for the row to name. */
export type InboundLink = {
  /** Vault-relative. */
  path: string;
  title: string;
  /** The linking file's `kind:`, null for a Note. */
  kind: string | null;
};

/**
 * An annotation now in the file that a *relink* may name. `ref` is the
 * choice as the core takes it back: `held:<n>` for one an ambiguity left
 * without an owner, `entry:<id>` for one Ingest already gave a fresh
 * identity when nothing could be shown to own it.
 */
export type RelinkCandidate = {
  ref: string;
  /** 1-based, for the row to read. */
  page: number;
  quote: string;
};

export type UnmatchedAnnotation = {
  kind: "unmatched-annotation";
  subject: string;
  /** Vault-relative: the Source's note, which is where the block is. */
  path: string;
  /** The Source's display name — the row reads as the paper it is about. */
  title: string;
  /** The sidecar entry's id: what a resolution names. */
  annotation: string;
  block: string;
  /** 1-based: the page context. */
  page: number;
  /** The quoted text as it was, never as anything since found. */
  quote: string;
  links: InboundLink[];
  /** Ranked by page, then overlap. */
  candidates: RelinkCandidate[];
};

/**
 * The Unmatched annotations one replaced PDF left, under the event that made
 * them (*the document changed*): one decision about a document, not fifty.
 */
export type DocumentChanged = {
  kind: "document-changed";
  subject: string;
  path: string;
  title: string;
  /** When the replacement was seen. */
  at: string;
  annotations: UnmatchedAnnotation[];
};

export type UnmatchedRow = UnmatchedAnnotation | DocumentChanged;

/**
 * A row is an identity that something could link to (it has a block), that
 * failed every tier, and that no one has resolved: removed and tombstoned
 * entries are decided, so they are never a row again.
 */
const isUnmatched = (a: SidecarAnnotation) =>
  a.unmatched_since !== undefined &&
  a.removed_at === undefined &&
  a.gone_at === undefined &&
  a.block !== undefined;

/**
 * Every file that points at a block: a link to `[[citekey#^h<n>]]`, or a
 * Question or Research Question whose `annotation:` names it and whose
 * `from:` names this Source. Read from the index, which is disposable
 * (ADR 0006), so an empty answer is only ever *unlinked* when the index is
 * known to be current — that judgement is the caller's (`ingest.ts`).
 */
export function inboundLinks(
  index: VaultIndex,
  source: string,
  block: string
): InboundLink[] {
  const stem = basename(source, ".md").toLowerCase();
  const paths = new Set<string>();
  for (const row of index.select<{ path: string }>(
    `SELECT DISTINCT path FROM links
      WHERE block = ? AND path <> ? AND (resolved_path = ? OR ltarget = ?)`,
    block,
    source,
    source,
    stem
  )) {
    paths.add(row.path);
  }
  for (const row of index.select<{ path: string }>(
    `SELECT DISTINCT a.path FROM fields a
      WHERE a.key = 'annotation' AND a.value = ?
        AND EXISTS (SELECT 1 FROM fields f
                     WHERE f.path = a.path AND f.key = 'from'
                       AND lower(f.value) LIKE ?)`,
    JSON.stringify(block),
    `%${stem}%`
  )) {
    paths.add(row.path);
  }
  return [...paths].sort().map((path) => {
    const [file] = index.select<{ kind: string | null; display: string }>(
      "SELECT kind, display FROM files WHERE path = ?",
      path
    );
    return {
      path,
      title: file?.display ?? basename(path, ".md"),
      kind: file?.kind ?? null,
    };
  });
}

type Pool = { ref: string } & HeldAnnotation;

/**
 * What an Unmatched annotation may be relinked to: the annotations now in
 * the file that no identity owns. Two kinds are unclaimed — those an
 * ambiguity held back, and those Ingest gave a fresh identity in the run
 * that found this one missing (never matched since, so still nobody's but
 * their own). Same family only: a highlight is never the note beside it.
 * Ranked by how near the page is, then by how much of the box is shared.
 */
export function candidatesFor(
  sidecar: Sidecar,
  entry: SidecarAnnotation
): Pool[] {
  if (entry.unmatched_since === undefined) return [];
  const since = entry.unmatched_since;
  const pool: Pool[] = [
    ...(sidecar.held ?? []).map((h, i) => ({ ref: `held:${i}`, ...h })),
    ...sidecar.annotations
      .filter(
        (a) =>
          a.id !== entry.id &&
          a.block !== undefined &&
          a.removed_at === undefined &&
          a.gone_at === undefined &&
          a.unmatched_since === undefined &&
          a.matched_by === undefined &&
          a.question === undefined &&
          // Both stamps come from the run's one `stamped`, so the run that
          // found this identity missing ties with the entries it created
          // (hence >=); a later run's entries sort after it.
          a.last_matched >= since
      )
      .map((a) => ({ ref: `entry:${a.id}`, ...a })),
  ].filter((c) => sameKindFamily(c.kind, entry.kind));
  const score = (c: Pool) => overlap(c.quads, entry.quads);
  return pool.sort(
    (a, b) =>
      Math.abs(a.page - entry.page) - Math.abs(b.page - entry.page) ||
      score(b) - score(a)
  );
}

/**
 * Loose Ends' Unmatched rows, from every Source's sidecar. An Unmatched
 * annotation that is neither removed nor tombstoned is a row, and one that
 * a replaced document left joins that event's group. A sidecar that cannot
 * be read is named, never skipped: a row that belongs here would otherwise
 * be missing without a word (no silent failures).
 */
export async function unmatchedRows(
  index: VaultIndex,
  vaultPath: string
): Promise<{ rows: UnmatchedRow[]; problems: string[] }> {
  const rows: UnmatchedRow[] = [];
  const problems: string[] = [];
  for (const file of index.select<{
    path: string;
    id: string;
    display: string;
  }>(
    `SELECT path, id, display FROM files
      WHERE kind = 'source' AND id IS NOT NULL AND id <> '' ORDER BY path`
  )) {
    let sidecar: Sidecar | null;
    try {
      sidecar = await readSidecar(vaultPath, file.id);
    } catch (cause) {
      problems.push(
        `${file.path}: its annotations could not be read: ${errorMessage(cause)}`
      );
      continue;
    }
    if (sidecar === null) continue;
    const groups = new Map<string, UnmatchedAnnotation[]>();
    for (const entry of sidecar.annotations.filter(isUnmatched)) {
      const row: UnmatchedAnnotation = {
        kind: "unmatched-annotation",
        subject: `${file.id}/${entry.id}`,
        path: file.path,
        title: file.display,
        annotation: entry.id,
        block: entry.block!,
        page: entry.page + 1,
        quote: entry.quote,
        links: inboundLinks(index, file.path, entry.block!),
        candidates: candidatesFor(sidecar, entry).map((c) => ({
          ref: c.ref,
          page: c.page + 1,
          quote: c.quote,
        })),
      };
      const event = entry.document_changed_at;
      if (event === undefined) rows.push(row);
      else groups.set(event, [...(groups.get(event) ?? []), row]);
    }
    for (const [at, annotations] of groups) {
      rows.push({
        kind: "document-changed",
        subject: `${file.id}/document-changed/${at}`,
        path: file.path,
        title: file.display,
        at,
        annotations,
      });
    }
  }
  return { rows, problems };
}

const refuse = (message: string) => new VaultError("refused", message);

/** The candidate a `ref` names, or the reason it names none any longer. */
export function candidate(
  sidecar: Sidecar,
  entry: SidecarAnnotation,
  ref: string
) {
  const found = candidatesFor(sidecar, entry).find((c) => c.ref === ref);
  if (found === undefined) {
    throw refuse(
      "That annotation is no longer one of the choices — the file has changed since this was shown."
    );
  }
  return found;
}

/** The Unmatched entry a resolution names, or why it is not one. */
export function unmatchedEntry(
  sidecar: Sidecar,
  id: string
): SidecarAnnotation {
  const entry = sidecar.annotations.find((a) => a.id === id);
  if (entry === undefined || !isUnmatched(entry)) {
    throw refuse("That annotation is no longer waiting for a decision.");
  }
  return entry;
}

/**
 * *Relink*: the identity takes the chosen annotation — its page, quads,
 * quote, note and colour — and so keeps its block and every link to it.
 * The quote it had is kept one level back, as a geometry match keeps it,
 * so the panel can still say what it was. A candidate that already had a
 * fresh identity of its own is retired (`removed_at`): its block leaves the
 * note, and its number stays spent.
 */
export function relink(
  sidecar: Sidecar,
  id: string,
  ref: string,
  stamped: string
): Sidecar {
  const entry = unmatchedEntry(sidecar, id);
  const chosen = candidate(sidecar, entry, ref);
  const [kindOfRef, which] = ref.split(":") as [string, string];
  const taken: SidecarAnnotation = {
    ...entry,
    page: chosen.page,
    quads: chosen.quads,
    quote: chosen.quote,
    note: chosen.note,
    color: chosen.color,
    last_matched: stamped,
    ...(chosen.quote !== entry.quote
      ? { previous_quote: entry.quote, changed_at: stamped }
      : {}),
  };
  delete taken.unmatched_since;
  delete taken.document_changed_at;
  return {
    ...sidecar,
    annotations: sidecar.annotations.map((a) =>
      a.id === id
        ? taken
        : kindOfRef === "entry" && a.id === which
          ? { ...a, removed_at: stamped }
          : a
    ),
    ...(sidecar.held === undefined
      ? {}
      : {
          held:
            kindOfRef === "held"
              ? sidecar.held.filter((_, i) => i !== Number(which))
              : sidecar.held,
        }),
  };
}

/**
 * *Drop the links* and *treat as new*: the Tombstone. Identity, block and
 * quote stay and the block reads `(gone)`; nothing else is touched, least of
 * all a link. When the last Unmatched identity is resolved, annotations that
 * were held for it have no claimant left and become new here — a fresh id
 * and block, like any other — since no later event would come for a file
 * that has not changed.
 */
export function tombstone(
  sidecar: Sidecar,
  ids: readonly string[],
  stamped: string,
  fresh: { newId: () => string; hasBlock: (kind: AnnotationKind) => boolean }
): { sidecar: Sidecar; introduced: boolean } {
  for (const id of ids) unmatchedEntry(sidecar, id);
  const gone = new Set(ids);
  const annotations = sidecar.annotations.map((a): SidecarAnnotation => {
    if (!gone.has(a.id)) return a;
    const { unmatched_since, document_changed_at, ...rest } = a;
    void unmatched_since;
    void document_changed_at;
    return { ...rest, gone_at: stamped };
  });
  const held = sidecar.held ?? [];
  if (held.length === 0 || annotations.some(isUnmatched)) {
    return { sidecar: { ...sidecar, annotations }, introduced: false };
  }
  const taken = new Set(annotations.map((a) => a.id));
  let next = sidecar.next_block;
  const introduced = held.map((h): SidecarAnnotation => {
    let id = fresh.newId();
    for (let n = 2; taken.has(id); n++) id = `${id}-${n}`;
    taken.add(id);
    const created = { ...h, last_matched: stamped };
    return fresh.hasBlock(h.kind)
      ? { id, block: `h${next++}`, ...created }
      : { id, ...created };
  });
  return {
    sidecar: {
      ...sidecar,
      next_block: next,
      annotations: [...annotations, ...introduced],
      held: [],
    },
    introduced: true,
  };
}
