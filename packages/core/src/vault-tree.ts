import { fileName } from "./file-name.js";
import { VaultError } from "./errors.js";
import { createFile } from "./vault-files.js";
import type { VaultIndex } from "./vault-index.js";

/** The one folder *new note* writes to (spec #680; `docs/architecture.md` § Vault surface). */
const NOTES_FOLDER = "notes";

export type TreeFile = {
  /** Vault-relative, as the index keys it. */
  path: string;
  /** What `kind:` says, verbatim; null for a file that declares none, and for every file that is not Markdown. */
  kind: string | null;
  /** A Source's highlight count; absent on anything that is not a Source, so a stub never reads as "0 read". */
  annotations?: number;
};

/**
 * `vault.tree`: every non-dot file the index holds — the walk already leaves
 * out dot entries, `.vitrine/` among them — sorted by path, so the folders
 * the renderer draws are implied by the paths and need no row of their own.
 *
 * A Source's count is its `^h<n>` blocks: the note carries one per highlight
 * (ADR 0007), which is what a reader of the tree means by "how much I have
 * read of it". Ink and stamps carry no block and are not counted here.
 */
export function vaultTree(index: VaultIndex): TreeFile[] {
  const counts = new Map(
    index
      .select<{ path: string; n: number }>(
        "SELECT path, COUNT(*) AS n FROM blocks WHERE id GLOB 'h[0-9]*' GROUP BY path"
      )
      .map((row) => [row.path, row.n])
  );
  return index
    .select<{
      path: string;
      kind: string | null;
    }>("SELECT path, kind FROM files ORDER BY path")
    .map(({ path, kind }) =>
      kind === "source"
        ? { path, kind, annotations: counts.get(path) ?? 0 }
        : { path, kind }
    );
}

/**
 * `vault.create`: an empty note in `notes/`, named by the rule a Question's
 * file is (`fileName`). A taken name is refused and never suffixed: the user
 * typed a name for this note, and a ` (2)` they did not choose would be a
 * second note quietly standing in for the first they meant.
 */
export async function createNote(
  vaultPath: string,
  index: VaultIndex,
  name: string
): Promise<{ path: string }> {
  const stem = fileName(name.replace(/\.md$/i, ""), "");
  if (stem === "") {
    throw new VaultError(
      "refused",
      "That name has nothing left once the characters a file name cannot hold are taken out; type another."
    );
  }
  const path = `${NOTES_FOLDER}/${stem}.md`;
  const created = await createFile(vaultPath, path, "");
  if (!created.written) {
    throw new VaultError(
      "refused",
      created.reason === "alreadyExists"
        ? `A note named ${stem} is already in ${NOTES_FOLDER}; pick another name.`
        : `Couldn't make ${path}: ${created.detail}`
    );
  }
  await index.own(path, created.content);
  return { path };
}
