import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pageWords, type Fingerprint } from "./document-fingerprint.js";
import { PdfUnreadable, type PdfEngine } from "./pdf-engine.js";

/**
 * The document fingerprint of PDFs nobody has ingested (spec #416 stories
 * 59–63): a conflict copy and a file offered to *locate* are both judged by
 * whether they are a Source's document, and that takes the engine.
 *
 * Kept by content hash, in memory. Loose Ends is read on every visit and the
 * engine is a WebAssembly job per file, so the answer for bytes already read
 * is not asked for twice; a file replaced is a different hash and is read
 * afresh. `null` is a file that would not read — remembered too, so a
 * damaged file is not offered to the engine at every visit (story 66).
 */
export type Fingerprints = Map<string, Fingerprint | null>;

export async function fingerprintOf(
  { engine, fingerprints }: { engine: PdfEngine; fingerprints: Fingerprints },
  vaultPath: string,
  path: string,
  hash: string
): Promise<Fingerprint | null> {
  if (fingerprints.has(hash)) return fingerprints.get(hash)!;
  let found: Fingerprint | null = null;
  try {
    const read = await engine.annotations(
      await readFile(join(vaultPath, path))
    );
    found = {
      id: read.fileId,
      pages: read.pages,
      page_words: read.pageText.map(pageWords),
    };
  } catch (cause) {
    // A file that cannot be read is not a copy of anything; it stays the
    // row it already was, and *create a Source* is where its reason is said.
    // Anything but the engine saying so is a fault to raise, not to cache.
    if (!(cause instanceof PdfUnreadable) && !isMissing(cause)) throw cause;
  }
  fingerprints.set(hash, found);
  return found;
}

const isMissing = (cause: unknown) =>
  (cause as NodeJS.ErrnoException).code === "ENOENT";
