import { parseWikilink } from "markdown";
import type { Resolution } from "./vault-files.js";
import type { VaultIndex } from "./vault-index.js";

/** One file a link might mean, with what it is. */
export type LinkFile = { path: string; kind: string | null };

/** Where one `[[…]]` lands, and what it landed on (spec #680 story 41). */
export type LinkResolution = {
  resolution: Resolution;
  /** The file, when `resolved`. */
  path: string | null;
  /** That file's `kind:` verbatim, so the editor can send it to its own surface. */
  kind: string | null;
  /** The files the name reached when it did not land on one: both of an ambiguous pair, the one whose `#fragment` is missing. */
  candidates: LinkFile[];
};

export type LinkResolutions = Record<string, LinkResolution>;

/**
 * `vault.resolveLinks`: for each link text (the inside of `[[…]]`) the open
 * file holds, the index's own verdict — `index.resolve`, the rule the `links`
 * table is filled by — so the editor never colours a link as landing where
 * the index would not count it. Keyed by the text as written.
 */
export function resolveLinks(
  index: VaultIndex,
  from: string,
  links: string[]
): LinkResolutions {
  const kinds = new Map(
    index
      .select<{ path: string; kind: string | null }>(
        "SELECT path, kind FROM files"
      )
      .map((f) => [f.path, f.kind])
  );
  const file = (path: string): LinkFile => ({
    path,
    kind: kinds.get(path) ?? null,
  });
  const out: LinkResolutions = {};
  for (const link of links) {
    const found = index.resolve(from, parseWikilink(link));
    out[link] = {
      resolution: found.resolution,
      path: found.resolvedPath,
      kind:
        found.resolvedPath === null
          ? null
          : (kinds.get(found.resolvedPath) ?? null),
      candidates: found.candidates.map(file),
    };
  }
  return out;
}
