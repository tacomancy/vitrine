import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  readSidecar,
  writeSidecar,
  type Sidecar,
  type SidecarAnnotation,
} from "./annotation-sidecar.js";
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
 * Matching is not here: this ticket makes every annotation new, so a file
 * ingested twice with different bytes adds its annotations twice. Re-matching
 * (the next ticket) is what recognises one it has seen — and it is
 * load-bearing, so it is written once, against this record, and not
 * approximated here.
 */

/** The four counts a run's footer line is made of (`N new · N questions · N removed · N could not be re-matched`). */
export type IngestSummary = {
  new: number;
  questions: number;
  removed: number;
  unmatched: number;
};

export type IngestRun = { summary: IngestSummary; sources: string[] };

export type IngestOptions = {
  vaultPath: string;
  index: VaultIndex;
  engine: PdfEngine;
  /** What the engine could not read, shared with the PDF-folder rows. */
  unreadable: UnreadablePdfs;
  newId: () => string;
  now: () => Date;
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
  const line = `- p.${a.page + 1} · "${a.quote}" ^${a.block}`;
  if (a.note.trim() === "") return line;
  // A note of several paragraphs keeps them, each indented under the item.
  const note = a.note
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((paragraph) => (paragraph === "" ? "" : `  ${paragraph}`))
    .join("\n");
  return `${line}\n\n${note}`;
}

/** The section's body: every annotation that has a block, in page order. */
export function annotationsBody(annotations: SidecarAnnotation[]): string {
  return annotations
    .filter((a) => a.block !== undefined)
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
}: IngestOptions) {
  // One run at a time. Two runs over the same Source would each plan its
  // blocks from the counter they read, and hand out the same `^h<n>` twice —
  // the one thing a block number must never do. The queue is here, in the
  // callee, because a caller that had to remember it would one day not.
  const serially = serialised();

  /** Every Source with a PDF and an `id:` — the key its sidecar lives under. */
  function candidates(only: ReadonlySet<string> | null) {
    const found: Array<{ source: string; id: string; pdf: string }> = [];
    for (const key of pdfKeys(index)) {
      const [row] = index.select<{ kind: string | null; id: string | null }>(
        "SELECT kind, id FROM files WHERE path = ?",
        key.path
      );
      // A stub has no PDF to read, and a Source with no `id:` has no key for
      // its sidecar; minting one is the attach write's, and no Ingest writes
      // frontmatter.
      if (row?.kind !== "source" || !row.id) continue;
      const [file] = index.select<{ path: string }>(
        "SELECT path FROM files WHERE markdown = 0 AND lpath = ?",
        namedPath(key.pdf)
      );
      if (file === undefined) continue;
      if (only !== null && !only.has(file.path)) continue;
      found.push({ source: key.path, id: row.id, pdf: file.path });
    }
    return found;
  }

  async function ingestOne(source: {
    source: string;
    id: string;
    pdf: string;
  }): Promise<number | null> {
    const [file] = index.select<{ hash: string | null }>(
      "SELECT hash FROM files WHERE markdown = 0 AND path = ?",
      source.pdf
    );
    // No hash is an evicted file: unreadable-not-changed (story 23).
    if (file?.hash == null) return null;
    const before = await readSidecar(vaultPath, source.id);
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

    const stamped = now().toISOString();
    // An earlier run that died between the counter and the note left its
    // annotations in the sidecar; they are this file's, read again below, so
    // they are dropped — but the counter stays where it got to, since their
    // blocks may already be in the note.
    const kept = before?.pending
      ? before.annotations.slice(0, before.pending.kept)
      : (before?.annotations ?? []);
    const taken = new Set(kept.map((a) => a.id));
    let next = before?.next_block ?? 1;
    const fresh: SidecarAnnotation[] = read.annotations
      .map((a: PdfAnnotation) => ({
        nm: a.nm,
        entry: {
          kind: a.kind,
          page: a.page,
          // A kind with no quads is identified by where it sits.
          quads: a.quads.length > 0 ? a.quads : [rectToQuad(a.rect)],
          quote: a.quote,
          note: a.note,
          color: a.color,
          last_matched: stamped,
        },
      }))
      .sort((a, b) => byReading(a.entry, b.entry))
      .map(({ nm, entry }) => {
        // An /NM is the id a Reader write left in the file; it is kept
        // unless something already holds it (a copy pasted within the file).
        let id = nm !== undefined && !taken.has(nm) ? nm : newId();
        for (let n = 2; taken.has(id); n++) id = `${id}-${n}`;
        taken.add(id);
        return HAS_BLOCK.has(entry.kind)
          ? { id, block: `h${next++}`, ...entry }
          : { id, ...entry };
      });

    const after: Sidecar = {
      pdf: source.pdf.slice("sources/pdf/".length),
      // Left as it was until the note has landed: a sidecar that says this
      // file is ingested while its blocks are missing is a gap that no later
      // event would notice.
      file: before?.file ?? { size: 0, mtime: 0, hash: "" },
      document_fingerprint: { id: read.fileId, pages: read.pages },
      next_block: next,
      annotations: [...kept, ...fresh],
      pending: { kept: kept.length },
    };
    // The counter first, and on its own: the note's blocks are numbered from
    // it, and a block number reused after a failed write would let an old
    // link name a different passage.
    await writeSidecar(vaultPath, source.id, after);
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
    const { pending: _done, ...finished } = after;
    await writeSidecar(vaultPath, source.id, {
      ...finished,
      file: {
        size: stats.size,
        mtime: stats.mtimeMs,
        hash: sha256(bytes),
      },
    });
    return fresh.length;
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
        for (const source of candidates(paths && new Set(paths))) {
          try {
            const added = await ingestOne(source);
            if (added === null) continue;
            summary.new += added;
            if (added > 0) sources.push(source.source);
          } catch (cause) {
            // The run goes on: one Source that cannot take its blocks is not
            // the reason the rest go unread. Its sidecar still says the file
            // is not ingested, so the next change or open tries again.
            console.error(`vitrine-core: ingest: ${errorMessage(cause)}`);
          }
        }
        return sources.length === 0 ? null : { summary, sources };
      }),
  };
}

export type Ingest = ReturnType<typeof createIngest>;
