import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { VaultError } from "./errors.js";
import {
  matchAnnotations,
  type LinkAnswer,
  type Present,
} from "./annotation-matcher.js";
import {
  readSidecar,
  writeSidecar,
  type HeldAnnotation,
  type ReadingPosition,
  type Sidecar,
  type SidecarAnnotation,
} from "./annotation-sidecar.js";
import { pageWords, sameDocument } from "./document-fingerprint.js";
import { errorMessage } from "./errors.js";
import { writeAtomically } from "./atomic-write.js";
import { HIGHLIGHT_RGB, type HighlightColour } from "./highlight-colour.js";
import {
  PdfUnreadable,
  type AnnotationKind,
  type PdfAnnotation,
  type PdfEngine,
} from "./pdf-engine.js";
import { namedPath, pdfKeys, type UnreadablePdfs } from "./sources.js";
import {
  candidate,
  inboundLinks,
  relink,
  tombstone,
  unmatchedEntry,
} from "./unmatched.js";
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

/** What a resolution changed: the sidecar to keep, and whether it introduced annotations that may owe a Question. */
type Resolved<T> = { sidecar: Sidecar; introduced?: boolean; result: T };

/** What one Source's Ingest took in. */
type Ingested = IngestSummary & { changed: boolean };

/** What Ingest asks the Question service for: one spawned from a `Q:` note. */
export type SpawnQuestion = (question: {
  text: string;
  source: string;
  page: number;
  annotation: string;
  quote: string;
}) => Promise<{ id: string }>;

/**
 * The text of a `Q:` note (CONTEXT.md *`Q:` convention*): the prefix is
 * case-insensitive after leading whitespace, the rest is trimmed, and an
 * empty rest is no Question. Nothing near-miss is guessed at (story 33).
 */
export function questionText(note: string): string | null {
  const match = /^\s*q:([\s\S]*)$/i.exec(note);
  const text = match?.[1]?.trim();
  return text ? text : null;
}

export type IngestOptions = {
  vaultPath: string;
  index: VaultIndex;
  engine: PdfEngine;
  /** What the engine could not read, shared with the PDF-folder rows. */
  unreadable: UnreadablePdfs;
  newId: () => string;
  now: () => Date;
  spawnQuestion: SpawnQuestion;
  /**
   * Whether the index may be trusted to say nothing links to something
   * (ADR 0014 decision 11): the index's own currency and the watcher's,
   * which only the vault service can see.
   */
  isCurrent: () => boolean;
  /** Who a highlight the Reader writes is by: `/T`, which Preview shows on every note. */
  author: string;
};

/** What the Reader sends to make a highlight (#426): where and what, never PDF bytes. */
export type HighlightIntent = {
  /** 1-based. */
  page: number;
  /** `[left, bottom, right, top]` in PDF user space. */
  rects: number[][];
  colour: HighlightColour;
  note: string;
};

export type Highlighted = { id: string; block: string; quote: string };

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
  // A Tombstone stays in the note forever, so a link written months ago
  // still lands somewhere (story 51).
  const marker =
    a.gone_at !== undefined
      ? " (gone)"
      : a.unmatched_since === undefined
        ? ""
        : " (unmatched)";
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
  spawnQuestion,
  isCurrent,
  author,
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
   * Every annotation whose current note is a `Q:` and that has spawned no
   * Question yet spawns one, and the sidecar remembers it (ADR 0013 d.8).
   * The id is written after each spawn rather than once at the end: a run
   * that dies between two leaves the first one spawned-and-recorded, and the
   * next Ingest — which evaluates every note again — makes only the rest.
   */
  async function spawnQuestions(
    source: string,
    id: string,
    sidecar: Sidecar
  ): Promise<number> {
    let spawned = 0;
    for (const a of sidecar.annotations) {
      // A removed or dropped identity is not a live annotation to ask of.
      if (a.block === undefined || a.question !== undefined) continue;
      if (a.removed_at !== undefined || a.gone_at !== undefined) continue;
      // A sticky note's words are its quote (`note` is /Contents on the
      // markup kinds only), and it marks no passage.
      const isNote = a.kind === "text" || a.kind === "freetext";
      const text = questionText(isNote ? a.quote : a.note);
      if (text === null) continue;
      const made = await spawnQuestion({
        text,
        source,
        page: a.page + 1,
        annotation: a.block,
        quote: isNote ? "" : a.quote,
      });
      a.question = made.id;
      await writeSidecar(vaultPath, id, sidecar);
      spawned++;
    }
    return spawned;
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
      (a) =>
        a.block !== undefined &&
        a.removed_at === undefined &&
        a.gone_at === undefined
    );
    if (targets.length === 0) return answers;
    await index.refresh([]);
    const current = isCurrent();
    for (const a of targets) {
      if (!current) {
        answers.set(a.id, "unknown");
        continue;
      }
      const linked = inboundLinks(index, source, a.block!).length > 0;
      answers.set(a.id, linked ? "linked" : "unlinked");
    }
    return answers;
  }

  /** `## Annotations` rewritten from the sidecar's entries. */
  async function writeNote(
    source: string,
    annotations: SidecarAnnotation[]
  ): Promise<void> {
    const found = await readOutline(vaultPath, source);
    if (!found.readable) throw new Error(found.reason);
    const written = await write(vaultPath, found.path, {
      basedOn: found.hash,
      operations: [
        {
          op: "replaceSection",
          name: "Annotations",
          body: annotationsBody(annotations),
        },
      ],
    });
    if (!written.written) throw new Error(written.detail);
    await index.own(found.path, written.content);
  }

  /**
   * A resolution of Unmatched annotations: the sidecar changed, the note
   * rewritten to match, then any Question a newly introduced `Q:` owes.
   * Behind the same queue as a run, so a resolution and an Ingest cannot
   * hand out one block number twice or overwrite each other's sidecar.
   * The note goes first: a refused note leaves the sidecar as it was, so
   * the row is still there to try again.
   */
  const resolving = <T>(
    source: string,
    change: (
      sidecar: Sidecar,
      stamped: string
    ) => Resolved<T> | Promise<Resolved<T>>
  ): Promise<T> =>
    serially(async () => {
      const [file] = index.select<{ id: string | null }>(
        "SELECT id FROM files WHERE path = ? AND kind = 'source'",
        source
      );
      const sidecar = file?.id ? await readSidecar(vaultPath, file.id) : null;
      if (!file?.id || sidecar === null) {
        throw new VaultError(
          "refused",
          "That Source has no annotations recorded."
        );
      }
      const changed = await change(sidecar, now().toISOString());
      await writeNote(source, changed.sidecar.annotations);
      await writeSidecar(vaultPath, file.id, changed.sidecar);
      if (changed.introduced) {
        await spawnQuestions(source, file.id, changed.sidecar);
      }
      return changed.result;
    });

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
    if (before?.file.hash === file.hash) {
      // Nothing to read, but a note may still owe a Question: a run that
      // died between recording the file and spawning it must not lose it
      // for good, since no later event would come for an unchanged file.
      const questions = await spawnQuestions(source.source, source.id!, before);
      return questions === 0
        ? null
        : { new: 0, questions, removed: 0, unmatched: 0, changed: false };
    }
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
      // Found again, so it is no longer a decision waiting: the two marks that
      // said it was are dropped (`void` only tells lint they are unused).
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
      // Carried across: the sidecar is rebuilt here, and a reader's place is
      // not something a PDF's return may forget.
      ...(before?.reading_position
        ? { reading_position: before.reading_position }
        : {}),
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
      await writeNote(source.source, after.annotations);
    }
    const finished: Sidecar = { ...after };
    delete finished.pending;
    const ingested: Sidecar = {
      ...finished,
      document_fingerprint: fingerprint,
      file: {
        size: stats.size,
        mtime: stats.mtimeMs,
        hash: sha256(bytes),
      },
    };
    await writeSidecar(vaultPath, id, ingested);
    // After the file is recorded, so a failing spawn is retried from the
    // early branch above and never re-reads the PDF.
    const questions = await spawnQuestions(source.source, id, ingested);
    return {
      new: fresh.length,
      questions,
      removed: owed.removed + tally.removed,
      unmatched: owed.unmatched + tally.unmatched,
      changed,
    };
  }

  /**
   * One highlight from the Reader, written into the PDF and then recorded by
   * the same code that records every other annotation: the file is written,
   * the index told, and `ingestOne` reads it back — so the identity, the
   * block and the note are made by the path Preview's highlights take, and a
   * Reader highlight cannot be one that Ingest would not have found.
   */
  async function highlightOne(
    source: string,
    intent: HighlightIntent
  ): Promise<Highlighted> {
    const found = candidates(null).find((c) => c.source === source);
    if (found === undefined) {
      throw new VaultError("refused", "That Source has no PDF in the vault.");
    }
    // Brought up to date first, so the annotations already in the file have
    // their identities before ours joins them.
    await ingestOne(found);
    const [held] = index.select<{ hash: string | null }>(
      "SELECT hash FROM files WHERE markdown = 0 AND path = ?",
      found.pdf
    );
    if (held?.hash == null) {
      throw new VaultError(
        "refused",
        "The PDF is not on this Mac yet: your sync folder has not delivered it."
      );
    }
    const absolute = join(vaultPath, found.pdf);
    const bytes = await readFile(absolute);
    const nm = newId();
    let made;
    try {
      made = await engine.highlight(bytes, {
        page: intent.page - 1,
        rects: intent.rects,
        color: HIGHLIGHT_RGB[intent.colour],
        note: intent.note,
        nm,
        author,
        at: now().toISOString(),
      });
    } catch (cause) {
      if (!(cause instanceof PdfUnreadable)) throw cause;
      throw new VaultError(
        "refused",
        `This PDF could not be read because ${cause.reason}.`
      );
    }
    if (!made.written) throw new VaultError("refused", made.reason);
    // Temp file, then rename: a write that fails leaves the original as it was.
    await writeAtomically(absolute, made.bytes);
    await index.refresh([found.pdf]);
    // A Source that had no `id:` has one now.
    const after = candidates(new Set([found.pdf])).find(
      (c) => c.source === source
    );
    await ingestOne(after ?? found);
    const sidecar = after?.id ? await readSidecar(vaultPath, after.id) : null;
    const entry = sidecar?.annotations.find((a) => a.id === nm);
    if (entry?.block === undefined) {
      throw new VaultError(
        "refused",
        "The highlight was written into the PDF, but could not be recorded yet."
      );
    }
    return { id: entry.id, block: entry.block, quote: entry.quote };
  }

  const tombstoned = (source: string, ids: readonly string[]) =>
    resolving(source, (sidecar, stamped) => {
      const done = tombstone(sidecar, ids, stamped, {
        newId,
        hasBlock: (kind) => HAS_BLOCK.has(kind),
      });
      return { ...done, result: undefined };
    });

  return {
    /**
     * *Relink* (stories 47–48): the Unmatched identity takes one of the
     * annotations now in the file, and its links follow. A candidate that
     * already has a fresh identity must be one nothing links to — it is
     * retired, and a link to its block would rot — which only a current
     * index can show.
     */
    relink: (source: string, annotation: string, ref: string) =>
      resolving(source, async (sidecar, stamped) => {
        const entry = unmatchedEntry(sidecar, annotation);
        const chosen = candidate(sidecar, entry, ref);
        if (ref.startsWith("entry:")) {
          await index.refresh([]);
          if (!isCurrent()) {
            throw new VaultError(
              "refused",
              "The vault is still being read, so it cannot yet be shown that nothing links to that annotation. Try again in a moment."
            );
          }
          const block = sidecar.annotations.find(
            (a) => `entry:${a.id}` === ref
          )?.block;
          if (
            block !== undefined &&
            inboundLinks(index, source, block).length
          ) {
            throw new VaultError(
              "refused",
              `Something already links to that annotation (p.${chosen.page + 1}), so it cannot be folded into this one.`
            );
          }
        }
        return {
          sidecar: relink(sidecar, annotation, ref, stamped),
          result: undefined,
        };
      }),
    /**
     * *Drop the links* and *treat as new* (stories 49–51, 54): the same
     * Tombstone, because one terminal state means one thing. Two entry
     * points so a caller says what it meant; they cannot differ in effect.
     * Batch acts pass every id, and all resolve or none does.
     */
    /**
     * Highlight a passage from the Reader (#426; ADR 0007 decisions 6 and
     * 12). On Ingest's queue because it rewrites the PDF and the sidecar: a
     * run beside it would read the file half-way through the swap.
     */
    highlight: (source: string, intent: HighlightIntent) =>
      serially(() => highlightOne(source, intent)),
    dropLinks: tombstoned,
    treatAsNew: tombstoned,
    /**
     * Remember where the reader stopped in a Source (#424). On Ingest's own
     * queue because both rewrite the whole sidecar: a scroll landing between
     * an Ingest's read and its write would be overwritten by it, or would
     * overwrite the annotations it added. False when the Source has no
     * sidecar yet — there is nothing to attach a place to, and a sidecar is
     * never made by anything but an Ingest.
     */
    readingPosition: (
      id: string,
      position: ReadingPosition
    ): Promise<{ written: boolean }> =>
      serially(async () => {
        const sidecar = await readSidecar(vaultPath, id);
        if (sidecar === null) return { written: false };
        await writeSidecar(vaultPath, id, {
          ...sidecar,
          reading_position: position,
        });
        return { written: true };
      }),
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
            summary.questions += took.questions;
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
        return sources.length === 0 &&
          changed.length === 0 &&
          summary.questions === 0
          ? null
          : { summary, sources, changed };
      }),
  };
}

export type Ingest = ReturnType<typeof createIngest>;
