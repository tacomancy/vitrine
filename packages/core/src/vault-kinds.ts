import type { VaultIndex } from "./vault-index.js";

/**
 * `vault.kinds`: every `kind:` the vault holds at least one file of, sorted —
 * a Markdown file that declares none is absent, not `note`. The Sidebar reads
 * it to tell a built surface with nothing in it from one with something
 * (#347); a presence test, not a count, because the rail names no numbers.
 */
export function kindsHeld(index: VaultIndex): string[] {
  return index
    .select<{
      kind: string;
    }>("SELECT DISTINCT kind FROM files WHERE kind IS NOT NULL ORDER BY kind")
    .map((row) => row.kind);
}
