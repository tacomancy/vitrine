import type { TagSource } from "markdown";
import {
  deriveKind,
  locate,
  type FileChoices,
  type FileOutline,
  type OutlineResponse,
  type ResolvedLink,
} from "./vault-files.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * `vault.outline(path)` from beat 1b on (ADR 0014 decision 3; `docs/
 * architecture.md` § Index, Reads): the rows the index holds for one path,
 * assembled into the shape `readOutline` produces, with each link's
 * resolution — the derived column every other surface sees — filled in.
 * Never a fresh outline of the file: that could disagree with `vault.tags`
 * about the same file. A path the index has not reached yet is `readable:
 * false` with a reason that says so; `vault.status` says why.
 */
export type IndexedOutlineResponse = OutlineResponse<ResolvedLink>;

type FilesRow = {
  markdown: number;
  hash: string | null;
  kind: string | null;
  bom: number | null;
  eol: FileChoices["eol"] | null;
  trailing_newline: number | null;
};

export async function outlineFromIndex(
  index: VaultIndex,
  vaultPath: string,
  path: string
): Promise<IndexedOutlineResponse> {
  // The same input errors as a disk read — outside the vault, a dot-entry,
  // a symlink, not Markdown — so the caller's contract does not change.
  const { relativePath } = await locate(vaultPath, path);
  const [file] = index.select<FilesRow>(
    "SELECT markdown, hash, kind, bom, eol, trailing_newline FROM files WHERE path = ?",
    relativePath
  );
  if (file === undefined) {
    const { current } = index.status();
    return {
      readable: false,
      path: relativePath,
      reason: current.ok
        ? "not in the index"
        : `not in the index yet: ${current.reason}`,
    };
  }
  // A Markdown row with no file choices was never outlined: the read failed
  // or the frontmatter did not parse, and the reason is its problem row.
  if (file.eol === null || file.hash === null) {
    const [problem] = index.select<{ problem: string }>(
      "SELECT problem FROM problems WHERE path = ? AND channel = 'unreadable' LIMIT 1",
      relativePath
    );
    return {
      readable: false,
      path: relativePath,
      reason: problem?.problem ?? "unreadable",
    };
  }

  const range = (row: { start: number; end: number }) => ({
    start: row.start,
    end: row.end,
  });
  const [front] = index.select<{
    start: number;
    end: number;
    content_start: number;
    content_end: number;
    value: string;
  }>(
    "SELECT start, end, content_start, content_end, value FROM frontmatter WHERE path = ?",
    relativePath
  );
  // Every table is read in insertion order, which is document order — the
  // order the outline listed them in.
  const headings = index
    .select<{
      level: number;
      text: string;
      start: number;
      end: number;
      body_start: number;
      body_end: number;
      block: string | null;
    }>(
      "SELECT level, text, start, end, body_start, body_end, block FROM headings WHERE path = ? ORDER BY rowid",
      relativePath
    )
    .map((h) => ({
      level: h.level as FileOutline["headings"][number]["level"],
      text: h.text,
      range: range(h),
      body: { start: h.body_start, end: h.body_end },
      blockId: h.block,
    }));
  const blockIds = index
    .select<{
      id: string;
      start: number;
      end: number;
      marker_start: number;
      marker_end: number;
    }>(
      "SELECT id, start, end, marker_start, marker_end FROM blocks WHERE path = ? ORDER BY rowid",
      relativePath
    )
    .map((b) => ({
      id: b.id,
      range: range(b),
      marker: { start: b.marker_start, end: b.marker_end },
    }));
  const links = index
    .select<{
      syntax: ResolvedLink["syntax"];
      target: string;
      heading: string;
      block: string | null;
      alias: string | null;
      embed: number;
      start: number;
      end: number;
      resolution: ResolvedLink["resolution"];
      resolved_path: string | null;
    }>(
      "SELECT syntax, target, heading, block, alias, embed, start, end, resolution, resolved_path FROM links WHERE path = ? ORDER BY rowid",
      relativePath
    )
    .map((l): ResolvedLink => ({
      syntax: l.syntax,
      target: l.target,
      heading: JSON.parse(l.heading) as string[],
      blockId: l.block,
      alias: l.alias,
      embed: l.embed === 1,
      range: range(l),
      resolution: l.resolution,
      resolvedPath: l.resolved_path,
    }));
  const tags = index
    .select<{
      canonical: string | null;
      written: string;
      source: TagSource;
      start: number;
      end: number;
      invalid: string | null;
    }>(
      "SELECT canonical, written, source, start, end, invalid FROM tags WHERE path = ? ORDER BY rowid",
      relativePath
    )
    .map((t): FileOutline["tags"][number] =>
      t.canonical === null
        ? {
            valid: false,
            text: t.written,
            reason: t.invalid ?? "invalid",
            source: t.source,
            range: range(t),
          }
        : {
            valid: true,
            text: t.written,
            canonical: t.canonical,
            source: t.source,
            range: range(t),
          }
    );
  const inlineFields = index
    .select<{
      block: string | null;
      key: string;
      value: string;
      start: number;
      end: number;
      value_start: number;
      value_end: number;
    }>(
      "SELECT block, key, value, start, end, value_start, value_end FROM fields_inline WHERE path = ? ORDER BY rowid",
      relativePath
    )
    .map((f) => ({
      key: f.key,
      value: f.value,
      range: range(f),
      valueRange: { start: f.value_start, end: f.value_end },
      under: f.block,
    }));
  const listItems = index
    .select<{ start: number; end: number }>(
      "SELECT start, end FROM list_items WHERE path = ? ORDER BY rowid",
      relativePath
    )
    .map((item) => ({ range: range(item) }));

  const outline: FileOutline<ResolvedLink> = {
    frontmatter:
      front === undefined
        ? null
        : {
            range: range(front),
            content: { start: front.content_start, end: front.content_end },
            value: JSON.parse(front.value) as unknown,
          },
    headings,
    blockIds,
    links,
    tags,
    inlineFields,
    listItems,
  };
  return {
    readable: true,
    path: relativePath,
    kind: file.kind,
    hash: file.hash,
    file: {
      bom: file.bom === 1,
      eol: file.eol,
      trailingNewline: file.trailing_newline === 1,
    },
    outline,
    ...deriveKind(relativePath, file.kind, outline),
  };
}
