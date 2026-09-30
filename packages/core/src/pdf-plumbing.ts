import { rename } from "node:fs/promises";
import { join } from "node:path";
import { readSidecar, type Sidecar } from "./annotation-sidecar.js";
import { sameDocument } from "./document-fingerprint.js";
import { errorMessage, VaultError } from "./errors.js";
import type { Host } from "./host.js";
import { fingerprintOf } from "./pdf-fingerprint.js";
import { PDF_FOLDER } from "./pdf-folder.js";
import {
  namedPath,
  pdfKeys,
  unnamedPdfs,
  type PdfReads,
  type UnreadablePdfs,
} from "./sources.js";
import { inboundLinks } from "./unmatched.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * The PDF folder's three later rows (#423; spec #416 stories 59–64, 68–69;
 * `docs/architecture.md` § Watcher and Ingest, *PDF folder rows*), and the
 * two resolutions that act on the file itself. Every row is a function of
 * the index, the sidecars and the PDFs' fingerprints — nothing is stored, so
 * the row a researcher reads cannot disagree with the vault.
 *
 * No `reason` here carries a path (ADR 0028): a row names the file as the
 * PDF folder knows it, which is the name the researcher gave it.
 */

/**
 * A second PDF that is a Source's document (CONTEXT.md *Conflict copy*):
 * what the sync service makes when two machines wrote one file. Never a
 * Source of its own; it replaces the no-Source row the same file would be.
 */
export type ConflictCopy = {
  kind: "conflict-copy";
  subject: string;
  /** Vault-relative: the copy. */
  path: string;
  /** The copy's file name inside the PDF folder. */
  title: string;
  /** Vault-relative: the Source it is a copy for. */
  source: string;
  sourceTitle: string;
};

/** A Source whose `pdf:` names a file the vault no longer holds. */
export type PdfMissing = {
  kind: "pdf-missing";
  subject: string;
  /** Vault-relative: the Source's note, which is what *open* opens. */
  path: string;
  title: string;
  /** The file's name, as `pdf:` wrote it. */
  file: string;
  /** PDFs no Source names, offered to *locate*; the fingerprint decides. */
  candidates: Array<{ path: string; title: string }>;
};

/** A Source whose annotations nothing links to (Disconnected material). */
export type UnlinkedAnnotations = {
  kind: "unlinked-annotations";
  subject: string;
  path: string;
  title: string;
  /** How many annotations have a block to be linked to. */
  annotations: number;
};

export type PdfPlumbingRow = ConflictCopy | PdfMissing | UnlinkedAnnotations;

type SourceFacts = {
  path: string;
  id: string;
  title: string;
  /** `pdf:` as written; null when none is named (a detached Source). */
  pdf: string | null;
  /** The PDF the index holds for it, or null when it holds none. */
  file: { path: string; hash: string | null } | null;
  sidecar: Sidecar;
};

/**
 * Every Source with a sidecar: the ones there is something to compare a PDF
 * to. A sidecar that cannot be read is named, never skipped — a row that
 * belongs here would otherwise be missing without a word.
 */
async function sourcesWithSidecars(
  index: VaultIndex,
  vaultPath: string
): Promise<{ sources: SourceFacts[]; problems: string[] }> {
  const named = new Map(pdfKeys(index).map((k) => [k.path, k.pdf]));
  const sources: SourceFacts[] = [];
  const problems: string[] = [];
  for (const row of index.select<{
    path: string;
    id: string;
    display: string;
  }>(
    `SELECT path, id, display FROM files
      WHERE kind = 'source' AND id IS NOT NULL AND id <> '' ORDER BY path`
  )) {
    let sidecar: Sidecar | null;
    try {
      sidecar = await readSidecar(vaultPath, row.id);
    } catch (cause) {
      problems.push(
        `${row.path}: its annotations could not be read: ${errorMessage(cause)}`
      );
      continue;
    }
    if (sidecar === null) continue;
    const pdf = named.get(row.path) ?? null;
    const [file] =
      pdf === null
        ? []
        : index.select<{ path: string; hash: string | null }>(
            "SELECT path, hash FROM files WHERE markdown = 0 AND lpath = ?",
            namedPath(pdf)
          );
    sources.push({
      path: row.path,
      id: row.id,
      title: row.display,
      pdf,
      file: file ?? null,
      sidecar,
    });
  }
  return { sources, problems };
}

/** PDFs no Source names that the engine has not already refused. */
function offered(index: VaultIndex, unreadable: UnreadablePdfs) {
  return unnamedPdfs(index).flatMap((path) => {
    const [row] = index.select<{ hash: string }>(
      "SELECT hash FROM files WHERE path = ?",
      path
    );
    if (row === undefined) return [];
    return unreadable.get(path)?.hash === row.hash
      ? []
      : [{ path, hash: row.hash }];
  });
}

/**
 * The Source this file is another copy of, or null. Only a Source whose own
 * PDF is present is compared: one whose file is gone is *PDF missing*, and
 * offering its return as a copy would give the same file two rows.
 */
async function copyOf(
  reads: PdfReads,
  vaultPath: string,
  sources: SourceFacts[],
  copy: { path: string; hash: string }
): Promise<SourceFacts | null> {
  const candidates = sources.filter((s) => s.file !== null);
  if (candidates.length === 0) return null;
  const found = await fingerprintOf(reads, vaultPath, copy.path, copy.hash);
  if (found === null) return null;
  return (
    candidates.find((s) =>
      sameDocument(s.sidecar.document_fingerprint, found)
    ) ?? null
  );
}

export async function pdfPlumbingRows(
  index: VaultIndex,
  vaultPath: string,
  reads: PdfReads
): Promise<{ rows: PdfPlumbingRow[]; problems: string[] }> {
  const { sources, problems } = await sourcesWithSidecars(index, vaultPath);
  const rows: PdfPlumbingRow[] = [];
  const unnamed = offered(index, reads.unreadable);

  for (const copy of unnamed) {
    const of = await copyOf(reads, vaultPath, sources, copy);
    if (of === null) continue;
    rows.push({
      kind: "conflict-copy",
      subject: copy.path,
      path: copy.path,
      title: copy.path.slice(PDF_FOLDER.length + 1),
      source: of.path,
      sourceTitle: of.title,
    });
  }

  for (const s of sources) {
    // A Source with no PDF named was detached on purpose. A folder that no
    // longer resolves does not empty the index (the last-seen files stay
    // until a sweep can read it), so a broken link is the *papers not
    // arriving* line's to say and not a row per Source.
    if (s.pdf !== null && s.file === null) {
      rows.push({
        kind: "pdf-missing",
        subject: s.id,
        path: s.path,
        title: s.title,
        file: s.pdf.split("/").pop() ?? s.pdf,
        candidates: unnamed.map(({ path }) => ({
          path,
          title: path.slice(PDF_FOLDER.length + 1),
        })),
      });
    }
    // Only annotations that can be linked to count: ink has no block, and a
    // removed or dropped identity is decided. A Source that has any and
    // none is linked is a paper read and never used.
    const linkable = s.sidecar.annotations.filter(
      (a) =>
        a.block !== undefined &&
        a.removed_at === undefined &&
        a.gone_at === undefined
    );
    if (
      linkable.length > 0 &&
      linkable.every((a) => inboundLinks(index, s.path, a.block!).length === 0)
    ) {
      rows.push({
        kind: "unlinked-annotations",
        subject: s.id,
        path: s.path,
        title: s.title,
        annotations: linkable.length,
      });
    }
  }
  return { rows, problems };
}

const refuse = (message: string) => new VaultError("refused", message);

/** The Source a conflict copy is for, or the reason the file is not one. */
async function conflictOf(
  index: VaultIndex,
  vaultPath: string,
  reads: PdfReads,
  copy: string
): Promise<{ copy: string; source: SourceFacts }> {
  const [row] = index.select<{ path: string; hash: string | null }>(
    "SELECT path, hash FROM files WHERE markdown = 0 AND lpath = ?",
    copy.toLowerCase()
  );
  const gone = refuse(
    "That file is no longer a copy of a Source's PDF — the folder has changed since this was shown."
  );
  if (row === undefined || row.hash === null) throw gone;
  if (!unnamedPdfs(index).includes(row.path)) throw gone;
  const { sources } = await sourcesWithSidecars(index, vaultPath);
  const source = await copyOf(reads, vaultPath, sources, {
    path: row.path,
    hash: row.hash,
  });
  if (source === null) throw gone;
  return { copy: row.path, source };
}

/**
 * *Use this copy*: the copy's bytes become the canonical file, under the
 * canonical file's name, and the next Ingest re-matches every identity
 * through the tiers — nothing is trusted because the copy says so (story
 * 61). A rename, so the canonical file is never half-written; the copy is
 * gone with it, which is what the row's resolution was.
 */
export async function useCopy(
  vaultPath: string,
  index: VaultIndex,
  reads: PdfReads,
  ingest: (paths: readonly string[]) => Promise<void>,
  { copy }: { copy: string }
): Promise<void> {
  const found = await conflictOf(index, vaultPath, reads, copy);
  const canonical = found.source.file!.path;
  try {
    await rename(join(vaultPath, found.copy), join(vaultPath, canonical));
  } catch (cause) {
    throw new VaultError(
      "writeFailed",
      `Couldn't replace ${canonical} with the copy: ${errorMessage(cause)}`
    );
  }
  await index.refresh([found.copy, canonical]);
  await ingest([canonical]);
}

/** *Discard*: the copy goes to the Trash, never deleted outright (ADR 0013 decision 7). */
export async function discardCopy(
  vaultPath: string,
  index: VaultIndex,
  reads: PdfReads,
  host: Host,
  { copy }: { copy: string }
): Promise<void> {
  const found = await conflictOf(index, vaultPath, reads, copy);
  try {
    await host.trash(join(vaultPath, found.copy));
  } catch (cause) {
    throw new VaultError(
      "writeFailed",
      `Couldn't move the copy to the Trash: ${errorMessage(cause)}`
    );
  }
  await index.refresh([found.copy]);
}
