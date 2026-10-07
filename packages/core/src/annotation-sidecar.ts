import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomically } from "./atomic-write.js";
import type { Fingerprint } from "./document-fingerprint.js";
import { errorMessageWithoutPath, VaultError } from "./errors.js";
import type { MatchedBy } from "./annotation-matcher.js";
import type { AnnotationKind } from "./pdf-engine.js";

/**
 * `.vitrine/annotations/<source-id>.json` (ADR 0007; `docs/architecture.md`
 * § Annotation identity): the identity index for one Source's PDF, keyed by
 * the Source's `id:` so a rename of either file never loses it.
 *
 * It holds **raw** values only — the quote as the engine extracted it, the
 * quads as the file wrote them. Every normalisation rule and threshold that
 * compares them is code, so tuning one never migrates a sidecar; storing a
 * normalised quote here would freeze today's rule into files the next
 * build has to read.
 */
export type SidecarAnnotation = {
  /** What /NM carries when Vitrine wrote the object; otherwise minted at first sight. */
  id: string;
  /** `h<n>`. Absent on ink, stamp and shape: counted, never a link target. */
  block?: string;
  kind: AnnotationKind;
  /** 0-based. */
  page: number;
  quads: number[][];
  quote: string;
  note: string;
  /** The Question this annotation's `Q:` note spawned, once; never a second (ADR 0013 d.8). */
  question?: string;
  color: number[] | null;
  last_matched: string;
  /** How the last Ingest found it; absent on the run that first saw it. */
  matched_by?: MatchedBy;
  /**
   * The quote before a geometry match found a different one under this
   * identity, and when. One level only, enough for the panel to say what it
   * was; a quote is not a Position and is not kept in more than that.
   */
  previous_quote?: string;
  changed_at?: string;
  /**
   * Set when an identity failed every tier and nothing links to it (or,
   * with ink, nothing could). The entry stays so its block number is never
   * reused; its block leaves the note.
   */
  removed_at?: string;
  /**
   * Set when an identity something links to — or that the index could not
   * be shown to be unlinked — failed every tier, or two of them contested
   * one annotation. Cleared when a later Ingest finds it again.
   */
  unmatched_since?: string;
  /** Set on an Unmatched identity by a run that found the whole document replaced: what groups it under that one event. */
  document_changed_at?: string;
  /** The Tombstone (*drop the links*): skipped by every Ingest, its links keep resolving. */
  gone_at?: string;
};

/**
 * An annotation in the file that no identity could be shown to own, held
 * with the Unmatched identities that contested it so *relink* can offer it.
 * Raw values, replaced by every Ingest: a held annotation is found again
 * from the file, never trusted from here.
 */
export type HeldAnnotation = Pick<
  SidecarAnnotation,
  "kind" | "page" | "quads" | "quote" | "note" | "color"
>;

export type ReadingPosition = { page: number; offset: number };

export type Sidecar = {
  /** The PDF's file name under `sources/pdf/`, as the Source's `pdf:` wrote it. */
  pdf: string;
  /** The PDF as last ingested; a stat and hash equal to it is no change. */
  file: { size: number; mtime: number; hash: string };
  document_fingerprint: Fingerprint;
  /** The per-Source `^h` counter: never reused, not even after removal. */
  next_block: number;
  annotations: SidecarAnnotation[];
  /** Read by *relink* (the Unmatched row, #421). */
  held?: HeldAnnotation[];
  /**
   * Where the reader stopped (#424): a 1-based page and how far down it, 0
   * to 1. Lives here, in the Source's own file, so it follows the Source
   * and needs no store of its own; written only through Ingest's queue.
   */
  reading_position?: ReadingPosition;
  /**
   * Set while an Ingest has written the counter and its new annotations but
   * not yet the note's blocks: how many annotations were there before it. A
   * run that finds it knows the last one did not finish, and starts from
   * those instead of adding the same annotations a second time. It carries
   * what the run already recorded on the entries it kept — removals and new
   * Unmatched — because the retry will find them recorded and not count them
   * again, and the summary would lose them.
   */
  pending?: { kept: number; removed: number; unmatched: number };
};

const FOLDER = ".vitrine/annotations";

/** The sidecar, or null when this Source has never been ingested. */
export async function readSidecar(
  vaultPath: string,
  sourceId: string
): Promise<Sidecar | null> {
  try {
    return JSON.parse(
      await readFile(join(vaultPath, FOLDER, `${sourceId}.json`), "utf8")
    ) as Sidecar;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw cause;
  }
}

export async function writeSidecar(
  vaultPath: string,
  sourceId: string,
  sidecar: Sidecar
): Promise<void> {
  // Two steps, each in its own words: the cut takes the syscall with the path,
  // so `EACCES: permission denied` alone cannot tell the folder's making from
  // the file's write.
  await mkdir(join(vaultPath, FOLDER), { recursive: true }).catch(
    (cause: unknown) => {
      throw new VaultError(
        "writeFailed",
        `Couldn't create ${FOLDER}/: ${errorMessageWithoutPath(cause)}`
      );
    }
  );
  const relativePath = `${FOLDER}/${sourceId}.json`;
  try {
    await writeAtomically(
      join(vaultPath, relativePath),
      JSON.stringify(sidecar, null, 2) + "\n"
    );
  } catch (cause) {
    // Named vault-relative, never by the joined path, which would put back
    // what the errno's cut takes out. The name is also what the reader needs:
    // Node named a temp file nobody made (ADR 0028).
    throw new VaultError(
      "writeFailed",
      `Couldn't write ${relativePath}: ${errorMessageWithoutPath(cause)}`
    );
  }
}
