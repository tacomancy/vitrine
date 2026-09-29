import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  matchAnnotations,
  type LinkAnswer,
  type Present,
} from "./annotation-matcher.js";
import {
  readSidecar,
  writeSidecar,
  type HeldAnnotation,
  type Sidecar,
  type SidecarAnnotation,
} from "./annotation-sidecar.js";
import { pageWords, sameDocument } from "./document-fingerprint.js";
import { errorMessage } from "./errors.js";
import {
  PdfUnreadable,
  type AnnotationKind,
  type PdfAnnotation,
  type PdfEngine,
} from "./pdf-engine.js";
import { namedPath, pdfKeys, type UnreadablePdfs } from "./sources.js";
import { serialised } from "./serialise.js";
import { readOutline, sha256, write } from "./vault-files.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * Ingest (spec #416; `docs/architecture.md` § Watcher and Ingest): a PDF
 * attached to a Source that has changed on disk is read by the engine, and
 * what it holds is recorded in the Source's sidecar and written into the
 * Source's `## Annotations` section as blocks, so `[[citekey#^h12]]`
 * resolves in Obsidian.
 *
 * Never writes to a PDF (story 114) — the engine is only asked to read.
 * Never hashes or reads a file the index has no hash for: that is an
 * evicted file, a sync client's placeholder, and its arrival is not a
 * change (story 23).
 *
 * A file returning is matched against what the sidecar already knows
 * (`annotation-matcher.ts`), so an annotation Preview re-saved keeps its
 * identity and its block, and only what nothing in the file could be matched
 * to is new. What this file adds to that pure answer is the part that needs
 * the vault: what links to an identity, whether the index is current enough
 * to say nothing does, and the sidecar and the note the answer is written to.
 */

/** The four counts a run's footer line is made of (`N new · N questions · N removed · N could not be re-matched`). */
export type IngestSummary = {
  new: number;
  questions: number;
  removed: number;
  unmatched: number;
};

export type IngestRun = {
  summary: IngestSummary;
  /** The Sources a run changed something in. */
  sources: string[];
  /** The Sources whose whole document was replaced: one event each (story 43). */
  changed: string[];
};

/** What one Source's Ingest took in. */
type Ingested = IngestSummary & { changed: boolean };

export type IngestOptions = {
  vaultPath: string;
  index: VaultIndex;
  engine: PdfEngine;
  /** What the engine could not read, shared with the PDF-folder rows. */
  unreadable: UnreadablePdfs;
  newId: () => string;
  now: () => Date;
  /**
   * Whether the index may be trusted to say nothing links to something
   * (ADR 0014 decision 11): the index's own currency and the watcher's,
   * which only the vault service can see.
   */
  isCurrent: () => boolean;
};

/** A Source's block ids are `h` and a number; only markup and notes are link targets. */
const HAS_BLOCK: ReadonlySet<AnnotationKind> = new Set([
  "highlight",
  "underline",
  "strikeout",
  "squiggly",
  "text",
  "freetext",
]);

const rectToQuad = ([left, bottom, right, top]: number[]) => [
  left!,
  top!,
  right!,
  top!,
  left!,
  bottom!,
  right!,
  bottom!,
];

/** Where an annotation sits on its page, top to bottom then left to right: reading order. */
function reading(a: { page: number; quads: number[][] }) {
  const q = a.quads[0] ?? [0, 0, 0, 0, 0, 0, 0, 0];
  const top = Math.max(q[1]!, q[3]!, q[5]!, q[7]!);
  const left = Math.min(q[0]!, q[2]!, q[4]!, q[6]!);
  return { page: a.page, top, left };
}

const byReading = (
  a: { page: number; quads: number[][] },
  b: { page: number; quads: number[][] }
) => {
  const x = reading(a);
  const y = reading(b);
  return x.page - y.page || y.top - x.top || x.left - y.left;
};

/** One item of `## Annotations`; the shape is § Vault layout's, blank line and all. */
function item(a: SidecarAnnotation): string {
  // The marker goes before the id, which keeps the id last on the line: a
  // block id that is not at the end of its paragraph is prose to Obsidian.
  const marker = a.unmatched_since === undefined ? "" : " (unmatched)";
  const line = `- p.${a.page + 1} · "${a.quote}"${marker} ^${a.block}`;
  if (a.note.trim() === "") return line;
  // A note of several paragraphs keeps them, each indented under the item.
  const note = a.note
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((paragraph) => (paragraph === "" ? "" : `  ${paragraph}`))
    .join("\n");
  return `${line}\n\n${note}`;
}

/** The section's body: every annotation that has a block and is not removed, in page order. */
export function annotationsBody(annotations: SidecarAnnotation[]): string {
  // A removed annotation's block leaves; its number stays in the sidecar.
  return annotations
    .filter((a) => a.block !== undefined && a.removed_at === undefined)
    .sort(byReading)
    .map(item)
    .join("\n\n");
}

export function createIngest({
  vaultPath,
  index,
  engine,
  unreadable,
  newId,
  now,
  isCurrent,
}: IngestOptions) {
  // One run at a time. Two runs over the same Source would each plan its
  // blocks from the counter they read, and hand out the same `^h<n>` twice —
  // the one thing a block number must never do. The queue is here, in the
  // callee, because a caller that had to remember it would one day not.
  const serially = serialised();

  /** Every Source with a PDF and an `id:` — the key its sidecar lives under. */
  function candidates(only: ReadonlySet<string> | null) {
    const found: Array<{ source: string; id: string | null; pdf: string }> = [];
    for (const key of pdfKeys(index)) {
      const [row] = index.select<{ kind: string | null; id: string | null }>(
        "SELECT kind, id FROM files WHERE path = ?",
        key.path
      );
      // A stub has no PDF to read. A Source with no `id:` is kept: it has a
      // PDF and no key yet, and its first Ingest mints one (`mintId`).
      if (row?.kind !== "source") continue;
      const [file] = index.select<{ path: string }>(
        "SELECT path FROM files WHERE markdown = 0 AND lpath = ?",
        namedPath(key.pdf)
      );
      if (file === undefined) continue;
      if (only !== null && !only.has(file.path)) continue;
      found.push({ source: key.path, id: row.id || null, pdf: file.path });
    }
    return found;
  }

  /**
   * The `id:` a Source with a PDF lacks (a hand-written note, or one from
   * before attaching minted it): the sidecar's key, written by the same
   * splice attaching uses (ADR 0037, update for #419). Minted only here,
   * with the file in hand and about to be read, and before anything is
   * recorded — a failed write leaves no sidecar, so a retry starts clean.
   */
  async function mintId(path: string): Promise<string> {
    const found = await readOutline(vaultPath, path);
    if (!found.readable) throw new Error(found.reason);
    const id = newId();
    const written = await write(vaultPath, found.path, {
      basedOn: found.hash,
      operations: [{ op: "setFrontmatter", keys: { id } }],
    });
    if (!written.written) throw new Error(written.detail);
    await index.own(found.path, written.content);
    return id;
  }

  /**
   * What points at each identity that could be pointed at: a link to
   * `[[citekey#^h<n>]]`, or a Question or Research Question whose
   * `annotation:` names the block and whose `from:` names this Source. Read
   * from the index, which is disposable (ADR 0006), so *unlinked* is only
   * ever concluded from one shown to be current: refreshed first, so any
   * batch already applied is seen, then checked against the watcher too.
   * Anything short of that is `unknown`, which the matcher never removes.
   */
  async function linksOf(
    source: string,
    identities: SidecarAnnotation[]
  ): Promise<Map<string, LinkAnswer>> {
    const answers = new Map<string, LinkAnswer>();
    const targets = identities.filter(
      (a) => a.block !== undefined && !a.removed_at && !a.gone_at
    );
    if (targets.length === 0) return answers;
    await index.refresh([]);
    const current = isCurrent();
    const stem = basename(source, ".md");
    for (const a of targets) {
      if (!current) {
        answers.set(a.id, "unknown");
        continue;
      }
      const linked =
        index.select(
          `SELECT 1 FROM links
            WHERE block = ? AND path <> ? AND (resolved_path = ? OR ltarget = ?)
            LIMIT 1`,
          a.block!,
          source,
          source,
          stem.toLowerCase()
        ).length > 0 ||
        index.select(
          `SELECT 1 FROM fields a
            WHERE a.key = 'annotation' AND a.value = ?
              AND EXISTS (SELECT 1 FROM fields f
                           WHERE f.path = a.path AND f.key = 'from'
                             AND lower(f.value) LIKE ?)
            LIMIT 1`,
          JSON.stringify(a.block),
          `%${stem.toLowerCase()}%`
        ).length > 0;
      answers.set(a.id, linked ? "linked" : "unlinked");
    }
    return answers;
  }

  async function ingestOne(source: {
    source: string;
    id: string | null;
    pdf: string;
  }): Promise<Ingested | null> {
    const [file] = index.select<{ hash: string | null }>(
      "SELECT hash FROM files WHERE markdown = 0 AND path = ?",
      source.pdf
    );
    // No hash is an evicted file: unreadable-not-changed (story 23).
    if (file?.hash == null) return null;
    // No `id:` means no sidecar has ever been keyed to this Source.
    const before =
      source.id === null ? null : await readSidecar(vaultPath, source.id);
    if (before?.file.hash === file.hash) return null;
    if (unreadable.get(source.pdf)?.hash === file.hash) return null;

    let bytes: Buffer;
    let stats;
    try {
      stats = await stat(join(vaultPath, source.pdf));
      bytes = await readFile(join(vaultPath, source.pdf));
    } catch {
      unreadable.set(source.pdf, {
        hash: file.hash,
        reason: "the file could not be read from the disk",
      });
      return null;
    }
    let read;
    try {
      read = await engine.annotations(bytes);
    } catch (cause) {
      if (!(cause instanceof PdfUnreadable)) throw cause;
      // One broken file costs itself and nothing else; it is not retried
      // here (story 66), and the record is what a row is drawn from.
      unreadable.set(source.pdf, { hash: file.hash, reason: cause.reason });
      return null;
    }
    unreadable.delete(source.pdf);
    // The index still describes an older file than the one just read: the
    // change that made it newer is an event on its way, and reading now would
    // record a hash the index will not agree with — and ingest it twice.
    if (sha256(bytes) !== file.hash) return null;

    const id = source.id ?? (await mintId(source.source));
    const stamped = now().toISOString();
    // An earlier run that died between the counter and the note left its
    // new annotations in the sidecar; they are this file's, read again below,
    // so they are dropped — but the counter stays where it got to, since
    // their blocks may already be in the note.
    const owed = before?.pending ?? { kept: 0, removed: 0, unmatched: 0 };
    const kept = before?.pending
      ? before.annotations.slice(0, before.pending.kept)
      : (before?.annotations ?? []);
    const taken = new Set(kept.map((a) => a.id));
    let next = before?.next_block ?? 1;

    const incoming = read.annotations.map((a: PdfAnnotation) => ({
      kind: a.kind,
      page: a.page,
      // A kind with no quads is identified by where it sits.
      quads: a.quads.length > 0 ? a.quads : [rectToQuad(a.rect)],
      quote: a.quote,
      note: a.note,
      color: a.color,
      nm: a.nm,
    }));
    const fingerprint = {
      id: read.fileId,
      pages: read.pages,
      page_words: read.pageText.map(pageWords),
    };
    // A changed fingerprint runs the same tiers — they already look across
    // the whole document — and raises one event, so that a re-exported paper
    // is a decision made once and not fifty (story 43). Never raised by a
    // save alone: the fingerprint is built to survive one (story 44).
    const changed =
      before !== null &&
      !sameDocument(before.document_fingerprint, fingerprint);

    const answers = await linksOf(source.source, kept);
    const matching = matchAnnotations({
      known: kept.map((a) => ({
        id: a.id,
        kind: a.kind,
        page: a.page,
        quads: a.quads,
        quote: a.quote,
        linkable: a.block !== undefined,
        retired: a.removed_at !== undefined || a.gone_at !== undefined,
      })),
      present: incoming satisfies Present[],
      links: (k) => answers.get(k.id) ?? "unknown",
    });

    const tally = { removed: 0, unmatched: 0 };
    const entries = kept.map((entry, i): SidecarAnnotation => {
      const outcome = matching.outcomes[i]!;
      if (outcome.status === "skipped") return entry;
      if (outcome.status === "removed") {
        tally.removed++;
        return { ...entry, removed_at: stamped };
      }
      if (outcome.status === "unmatched") {
        // Counted once, when it first could not be re-matched: the same row
        // is not news on the next Preview save, and the footer would
        // otherwise repeat it until it was resolved.
        if (entry.unmatched_since !== undefined) return entry;
        tally.unmatched++;
        return {
          ...entry,
          unmatched_since: stamped,
          ...(changed ? { document_changed_at: stamped } : {}),
        };
      }
      const found = incoming[outcome.present]!;
      const { unmatched_since, document_changed_at, ...rest } = entry;
      void unmatched_since;
      void document_changed_at;
      return {
        ...rest,
        page: found.page,
        quads: found.quads,
        quote: found.quote,
        note: found.note,
        color: found.color,
        matched_by: outcome.by,
        last_matched: stamped,
        ...(outcome.by === "geometry" && outcome.quoteChanged
          ? { previous_quote: entry.quote, changed_at: stamped }
          : {}),
      };
    });

    const fresh: SidecarAnnotation[] = matching.fresh
      .map((p) => incoming[p]!)
      .sort(byReading)
      .map(({ nm, ...entry }) => {
        // An /NM is the id a Reader write left in the file; it is kept
        // unless something already holds it (a copy pasted within the file).
        let id = nm !== undefined && !taken.has(nm) ? nm : newId();
        for (let n = 2; taken.has(id); n++) id = `${id}-${n}`;
        taken.add(id);
        const created = { ...entry, last_matched: stamped };
        return HAS_BLOCK.has(entry.kind)
          ? { id, block: `h${next++}`, ...created }
          : { id, ...created };
      });
    const held: HeldAnnotation[] = matching.held.map((p) => {
      const { kind, page, quads, quote, note, color } = incoming[p]!;
      return { kind, page, quads, quote, note, color };
    });

    const after: Sidecar = {
      pdf: source.pdf.slice("sources/pdf/".length),
      // Left as it was until the note has landed: a sidecar that says this
      // file is ingested while its blocks are missing is a gap that no later
      // event would notice.
      file: before?.file ?? { size: 0, mtime: 0, hash: "" },
      // The old fingerprint too: a run that dies here and is retried must
      // still find the document changed, or the event is lost with it.
      document_fingerprint: before?.document_fingerprint ?? fingerprint,
      next_block: next,
      annotations: [...entries, ...fresh],
      held,
      pending: {
        kept: entries.length,
        removed: owed.removed + tally.removed,
        unmatched: owed.unmatched + tally.unmatched,
      },
    };
    // The counter first, and on its own: the note's blocks are numbered from
    // it, and a block number reused after a failed write would let an old
    // link name a different passage.
    await writeSidecar(vaultPath, id, after);
    if (after.annotations.some((a) => a.block !== undefined)) {
      const found = await readOutline(vaultPath, source.source);
      if (!found.readable) throw new Error(found.reason);
      const written = await write(vaultPath, found.path, {
        basedOn: found.hash,
        operations: [
          {
            op: "replaceSection",
            name: "Annotations",
            body: annotationsBody(after.annotations),
          },
        ],
      });
      if (!written.written) throw new Error(written.detail);
      await index.own(found.path, written.content);
    }
    const finished: Sidecar = { ...after };
    delete finished.pending;
    await writeSidecar(vaultPath, id, {
      ...finished,
      document_fingerprint: fingerprint,
      file: {
        size: stats.size,
        mtime: stats.mtimeMs,
        hash: sha256(bytes),
      },
    });
    return {
      new: fresh.length,
      questions: 0,
      removed: owed.removed + tally.removed,
      unmatched: owed.unmatched + tally.unmatched,
      changed,
    };
  }

  return {
    /**
     * Ingest the named PDFs, or — with no names — every Source's, which is
     * what the open-time sweep asks: a PDF attached, or changed while the
     * app was closed, is found by comparing each to its sidecar. Answers
     * with what landed, or null when nothing did: a run with nothing new
     * says nothing (story 16).
     */
    run: (paths: readonly string[] | null): Promise<IngestRun | null> =>
      serially(async () => {
        const summary: IngestSummary = {
          new: 0,
          questions: 0,
          removed: 0,
          unmatched: 0,
        };
        const sources: string[] = [];
        const changed: string[] = [];
        for (const source of candidates(paths && new Set(paths))) {
          try {
            const took = await ingestOne(source);
            if (took === null) continue;
            summary.new += took.new;
            summary.removed += took.removed;
            summary.unmatched += took.unmatched;
            if (took.new + took.removed + took.unmatched > 0) {
              sources.push(source.source);
            }
            if (took.changed) changed.push(source.source);
          } catch (cause) {
            // The run goes on: one Source that cannot take its blocks is not
            // the reason the rest go unread. Its sidecar still says the file
            // is not ingested, so the next change or open tries again.
            console.error(`vitrine-core: ingest: ${errorMessage(cause)}`);
          }
        }
        return sources.length === 0 && changed.length === 0
          ? null
          : { summary, sources, changed };
      }),
  };
}

export type Ingest = ReturnType<typeof createIngest>;
