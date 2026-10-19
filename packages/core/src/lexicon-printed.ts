import { readSidecar } from "./annotation-sidecar.js";
import type { VaultIndex } from "./vault-index.js";

/** A paper's path → the keywords its PDF printed, as the sidecar recorded them. */
export type PrintedKeywords = ReadonlyMap<string, readonly string[]>;

/**
 * What each Source's sidecar holds for the Lexicon (ADR 0018 decision 3). Read
 * when a Lexicon is derived and never copied into the Index, which holds
 * nothing from a sidecar or a PDF (§ Index). A Source with no `id:` has no
 * sidecar, and one whose sidecar is missing or does not parse contributes
 * only its frontmatter: the sidecar is Ingest's to repair, and Loose Ends
 * already surfaces a broken Source, so the Lexicon never refuses over it.
 */
export async function readPrintedKeywords(
  vaultPath: string,
  index: VaultIndex
): Promise<PrintedKeywords> {
  const sources = index.select<{ path: string; value: string }>(
    `SELECT f.path AS path, fm.value AS value FROM files f
       JOIN frontmatter fm ON fm.path = f.path WHERE f.kind = 'source'`
  );
  const printed = new Map<string, readonly string[]>();
  await Promise.all(
    sources.map(async ({ path, value }) => {
      try {
        const id = (JSON.parse(value) as Record<string, unknown>)["id"];
        if (typeof id !== "string" || id === "") return;
        const keywords = (await readSidecar(vaultPath, id))?.keywords;
        if (Array.isArray(keywords)) {
          printed.set(
            path,
            keywords.filter((k): k is string => typeof k === "string")
          );
        }
      } catch {
        // See above: an unreadable sidecar is a thinner Lexicon, not an error.
      }
    })
  );
  return printed;
}
