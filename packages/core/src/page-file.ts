import { readFile } from "node:fs/promises";
import { BOM, type Heading, type ListItem, type Outline } from "markdown";
import { errorMessageWithoutPath } from "./errors.js";
import { readRevisions, type Revision } from "./position-history.js";
import {
  analyseFile,
  locate,
  sha256,
  type Criterion,
  type FileOutline,
  type Resolution,
  type ShapeProblem,
} from "./vault-files.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * What every Kind with a page reads the same way (`research-question.ts`,
 * `hypothesis.ts`): the file read for its Kind, a `##` section and its
 * body, a `- [[link]] — note` line, and the Position history's entries.
 * The Kinds differ in which sections they own and what their lines mean,
 * never in how a section is found or a link resolved.
 */

/** A `- [[target#^h12]] — note` line: the link's resolution is the index's, the note the rest of the line. */
export type LinkLine = {
  /** The item's text without its `- ` marker. */
  text: string;
  /** Null when the line does not begin with a wikilink; the whole text is then the note. */
  link: {
    target: string;
    blockId: string | null;
    resolution: Resolution;
    resolvedPath: string | null;
    /**
     * The files the *name* reached, whatever the link then did; absent when
     * it reached none. Two of them means the name is ambiguous; one beside
     * an `unresolved` means the name landed and the `#^id` after it did
     * not — a block an Ingest renumbered, not a citekey to retype.
     */
    candidates?: string[];
    /** The `kind:` of the file the link lands on: what decides whether the page can open it. */
    resolvedKind: string | null;
  } | null;
  note: string;
};

/** The first `## <name>` — the page's, when the file carries two — and how many there are. */
export function section(
  outline: Pick<Outline, "headings">,
  name: string
): { heading: Heading | undefined; count: number } {
  const matches = outline.headings.filter(
    (h) => h.level === 2 && h.text === name
  );
  return { heading: matches[0], count: matches.length };
}

/** A section's body with the blank lines the app keeps around it removed. */
export function bodyText(
  content: string,
  heading: Heading | undefined
): string {
  if (heading === undefined) return "";
  return content.slice(heading.body.start, heading.body.end).trim();
}

export const MARKER = /^\s*[-*+]\s+/;
// The separator the app writes between a link and its note; a line without
// one is a link and no note, or a note and no link.
const SEPARATOR = /^\s*[—–-]\s*/;

/** The item's text with its list marker gone; a nested item's continuation lines are kept as written. */
export function itemText(content: string, item: ListItem): string {
  return content.slice(item.range.start, item.range.end).replace(MARKER, "");
}

/**
 * `- [[target#^id]] — note` → the link and the note. The link must open the
 * line: a mention later in a sentence is prose, and a line that opens with
 * anything else is kept whole as its own note, so nothing the user wrote
 * under the heading is dropped (brief § Ingest review's rule, generalised:
 * an unmatched line surfaces rather than disappears).
 */
export function linkLine(
  index: VaultIndex,
  path: string,
  outline: FileOutline,
  content: string,
  item: ListItem
): LinkLine {
  const text = itemText(content, item);
  const textStart = item.range.end - text.length;
  const link = outline.links.find(
    (l) => l.syntax === "wikilink" && l.range.start === textStart
  );
  if (link === undefined) return { text, link: null, note: text };
  const note = text.slice(link.range.end - textStart).replace(SEPARATOR, "");
  const { candidates, ...resolved } = index.resolve(path, link);
  const resolvedKind =
    resolved.resolvedPath === null
      ? null
      : (index.select<{ kind: string | null }>(
          "SELECT kind FROM files WHERE path = ?",
          resolved.resolvedPath
        )[0]?.kind ?? null);
  return {
    text,
    link: {
      target: link.target,
      blockId: link.blockId,
      ...resolved,
      ...(candidates.length === 0 ? {} : { candidates }),
      resolvedKind,
    },
    note: note.trim(),
  };
}

export type PageFile = {
  readable: true;
  relativePath: string;
  /** The text the outline's offsets are into: BOM-less, as the writer splices it. */
  content: string;
  outline: FileOutline;
  hash: string;
  kind: string;
  file: { bom: boolean };
  shape: ShapeProblem[];
  /** A Hypothesis's `### … ^c<n>` list as the core's criteria reader gives it; empty for every other Kind. */
  criteria: Criterion[];
};

/**
 * Why the page could not read its file (#277). The page prints this beside
 * the file's vault-relative path, so whatever it says is read by a person —
 * in the window, in a screenshot, in a bug report — and never carries the
 * machine's filesystem layout.
 *
 * A missing file is the ordinary case here: a stale hash, or a link into a
 * page since renamed. It gets the app's own words, in the register of the
 * removal line beside it on the page, rather than Node's errno — which
 * would only repeat the path the line already carries and then add the part
 * no reader can use. *Missing*, not *not in the vault*: the vault refuses a
 * path outside its root by those words already (`locate`), and the two mean
 * opposite things — refused, against absent. The Inbox's own refusal says
 * *the file is no longer there* (#285): a page reached by a stale link and
 * a row whose file went out from under it are not the same absence, so they
 * do not borrow each other's words.
 *
 * Every other failure — a permission, a folder where a file was — is the
 * case where the cause genuinely helps, so it keeps Node's, minus the path.
 */
function unreadable(
  relativePath: string,
  error: unknown
): { readable: false; path: string; reason: string } {
  const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
  return {
    readable: false,
    path: relativePath,
    reason: missing ? "missing from the vault" : errorMessageWithoutPath(error),
  };
}

/**
 * One file read as a page of one of `kinds`, for the page and for every write the
 * page makes: the bytes, their hash, and the outline of those same bytes. A
 * file that is not this Kind is not readable as a page, whichever caller
 * asked — a tick must no more land on a Note with an `## Open threads`
 * heading than the page may show one. `noun` is the Kind as the refusal
 * names it: *not a Research Question: kind is question*.
 */
export async function readPageFile(
  vaultPath: string,
  path: string,
  kinds: readonly string[],
  noun: string
): Promise<PageFile | { readable: false; path: string; reason: string }> {
  const { absolute, relativePath } = await locate(vaultPath, path);
  let bytes: Buffer;
  try {
    bytes = await readFile(absolute);
  } catch (error) {
    return unreadable(relativePath, error);
  }
  const raw = bytes.toString("utf8");
  const read = analyseFile(relativePath, raw, sha256(bytes));
  if (!read.readable) return read;
  if (read.kind === null || !kinds.includes(read.kind)) {
    return {
      readable: false,
      path: relativePath,
      reason: `not ${noun}: kind is ${read.kind ?? "absent"}`,
    };
  }
  return {
    readable: true,
    relativePath,
    content: read.file.bom ? raw.slice(BOM.length) : raw,
    outline: read.outline,
    hash: read.hash,
    kind: read.kind,
    file: read.file,
    shape: read.shape,
    criteria: read.criteria,
  };
}

/**
 * The entries under `## Position history`, in file order, and — as a shape
 * problem naming its first line — each item that is not one, so a hand
 * edit to the history is never silently discarded (§ Vault layout,
 * Position history). The item itself stays in the file.
 */
export function revisionsOf(
  path: string,
  kind: string,
  content: string,
  outline: Pick<Outline, "listItems">,
  heading: Heading | undefined
): { entries: Revision[]; problems: ShapeProblem[] } {
  const entries: Revision[] = [];
  const problems: ShapeProblem[] = [];
  if (heading === undefined) return { entries, problems };
  for (const { range, revision } of readRevisions(content, outline, heading)) {
    if (revision !== null) {
      entries.push(revision);
    } else {
      const firstLine = content.slice(range.start, range.end).split(/\r?\n/)[0];
      problems.push({
        path,
        kind,
        problem: "historyEntryUnparsed",
        ...(firstLine === undefined ? {} : { block: firstLine }),
      });
    }
  }
  return { entries, problems };
}
