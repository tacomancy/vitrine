import { basename } from "node:path";
import { parseWikilink } from "markdown";
import { VaultError } from "./errors.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * How the app writes a wikilink to a file the user picked. Shared by the
 * two writes that take a choice from the one picker: Link's `related`
 * (#211) and a source attached to a side of a Research Question (#218).
 */

/**
 * The shortest wikilink that reaches the chosen file and nothing else: the
 * bare name, as Obsidian and the rest of the app write links, unless the
 * Index says that name is ambiguous or lands elsewhere — then the
 * vault-relative path. Picking a name the user chose a *file* for and
 * letting it resolve to another file would be the silent failure the brief
 * forbids, so the choice is checked against the same resolver the `links`
 * column is computed by. A file the Index has not seen is refused for the
 * same reason: a bare name for it may reach something else entirely.
 */
export function wikilinkTo(
  index: VaultIndex,
  linkingPath: string,
  targetPath: string
): string {
  const known = index.select<{ path: string }>(
    "SELECT path FROM files WHERE path = ?",
    targetPath
  );
  if (known.length === 0) {
    throw new VaultError(
      "refused",
      `${targetPath} is not a file in the vault.`
    );
  }
  const bare = basename(targetPath, ".md");
  if (resolvesTo(index, linkingPath, `[[${bare}]]`) === targetPath) {
    return `[[${bare}]]`;
  }
  return `[[${targetPath.replace(/\.md$/, "")}]]`;
}

/**
 * Where a `[[…]]` entry lands, with the landed file's Kind and Display
 * name — what a line that points at a page needs to open it and name it.
 * All three are null when the entry is not a wikilink or resolves nowhere.
 */
export function landing(
  index: VaultIndex,
  linkingPath: string,
  entry: string
): { path: string | null; kind: string | null; display: string | null } {
  const path = resolvesTo(index, linkingPath, entry);
  if (path === null) return { path: null, kind: null, display: null };
  const [file] = index.select<{ kind: string | null; display: string }>(
    "SELECT kind, display FROM files WHERE path = ?",
    path
  );
  return { path, kind: file?.kind ?? null, display: file?.display ?? null };
}

/** Where a `[[…]]` entry lands, or null when it is not a resolving wikilink. */
export function resolvesTo(
  index: VaultIndex,
  linkingPath: string,
  entry: string
): string | null {
  const inner = /^\[\[(.*)\]\]$/.exec(entry)?.[1];
  if (inner === undefined) return null;
  return index.resolve(linkingPath, parseWikilink(inner)).resolvedPath;
}
