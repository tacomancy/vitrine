import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomically } from "./atomic-write.js";
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
};

export type Sidecar = {
  /** The PDF's file name under `sources/pdf/`, as the Source's `pdf:` wrote it. */
  pdf: string;
  /** The PDF as last ingested; a stat and hash equal to it is no change. */
  file: { size: number; mtime: number; hash: string };
  document_fingerprint: { id: string; pages: number };
  /** The per-Source `^h` counter: never reused, not even after removal. */
  next_block: number;
  annotations: SidecarAnnotation[];
  /**
   * Set while an Ingest has written the counter and its new annotations but
   * not yet the note's blocks: how many annotations were there before it. A
   * run that finds it knows the last one did not finish, and starts from
   * those instead of adding the same annotations a second time.
   */
  pending?: { kept: number };
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
  await mkdir(join(vaultPath, FOLDER), { recursive: true });
  await writeAtomically(
    join(vaultPath, FOLDER, `${sourceId}.json`),
    JSON.stringify(sidecar, null, 2) + "\n"
  );
}
