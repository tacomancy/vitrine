import { readFile } from "node:fs/promises";
import { BOM, type Heading, type ListItem, type Outline } from "markdown";
import { errorMessage } from "./errors.js";
import {
  analyseFile,
  locate,
  sha256,
  write,
  type FileOutline,
  type Resolution,
  type ShapeProblem,
  type WriteResult,
} from "./vault-files.js";
import type { Position, ReadableOutline, VaultIndex } from "./vault-index.js";

/**
 * The Research Question Kind (`docs/architecture.md` § Vault layout,
 * § Research Question view and triage; ADR 0020): how the page is read from
 * a `kind: research-question` file, and what the Kind reports as its
 * Position; and the section writes this Kind makes on the user's behalf —
 * each an Edited section replaced whole (ADR 0020 decision 4).
 */

export type ResearchQuestionStatus = "open" | "answered" | "abandoned";

/** The page's frontmatter: the Question's keys copied at promotion, plus the page's own. */
export type ResearchQuestionFrontmatter = {
  id?: string;
  question: string;
  status: ResearchQuestionStatus;
  promotedFrom?: string;
  promoted?: string;
  answered?: string;
  captured?: string;
  context: string;
  from?: string;
  page?: number;
  annotation?: string;
  tags: string[];
};

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
    /** The `kind:` of the file the link lands on: what decides whether the page can open it. */
    resolvedKind: string | null;
  } | null;
  note: string;
};

/** A `- [ ] …` line; `done` is null when the item is not a task-list line. */
export type OpenThread = { text: string; done: boolean | null };

/** Each section as parsed; `present: false` when its heading is not in the file. */
export type ResearchQuestionSections = {
  workingAnswer: { present: boolean; text: string };
  supporting: { present: boolean; lines: LinkLine[] };
  opposing: { present: boolean; lines: LinkLine[] };
  /** `text` is the section's body as the plain text field edits it; `lines` its reading. */
  related: { present: boolean; text: string; lines: LinkLine[] };
  openThreads: { present: boolean; text: string; threads: OpenThread[] };
  /** The section's body verbatim; parsing it into Revisions is the history module's. */
  positionHistory: { present: boolean; text: string };
};

export type ResearchQuestionPage =
  | {
      readable: true;
      /** Vault-relative, as the index keys it. */
      path: string;
      /** SHA-256 of the bytes read: what the page's later writes are `basedOn`. */
      hash: string;
      frontmatter: ResearchQuestionFrontmatter;
      sections: ResearchQuestionSections;
      /** What could not be shown: the file's shape problems, then a section missing or doubled. */
      problems: ShapeProblem[];
    }
  | { readable: false; path: string; reason: string };

export const KIND = "research-question";

/** The six headings, in the order promotion writes them. */
export const SECTIONS = [
  "Working answer",
  "Supporting sources",
  "Opposing sources",
  "Related questions",
  "Open threads",
  "Position history",
] as const;

const STATUSES: readonly ResearchQuestionStatus[] = [
  "open",
  "answered",
  "abandoned",
];

const asString = (v: unknown) => (typeof v === "string" ? v : undefined);

/**
 * The page's frontmatter from the file's; the throw's message is the reason
 * the file is not readable as a page. Lenient where the Question reader is
 * (ADR 0009): a missing `status` is open, a missing Provenance key is a gap.
 */
export function readResearchQuestion(
  fm: Record<string, unknown>
): ResearchQuestionFrontmatter {
  const question = asString(fm["question"]);
  if (question === undefined) throw new Error("question is missing");
  const status = fm["status"] === undefined ? "open" : fm["status"];
  if (!STATUSES.includes(status as ResearchQuestionStatus)) {
    throw new Error(
      `status is not open, answered, or abandoned: ${JSON.stringify(status)}`
    );
  }
  const tags = Array.isArray(fm["tags"])
    ? fm["tags"].filter((t): t is string => typeof t === "string")
    : [];
  const out: ResearchQuestionFrontmatter = {
    question,
    status: status as ResearchQuestionStatus,
    context: asString(fm["context"]) ?? "other",
    tags,
  };
  const id = asString(fm["id"]);
  if (id !== undefined) out.id = id;
  const promotedFrom = asString(fm["promoted_from"]);
  if (promotedFrom !== undefined) out.promotedFrom = promotedFrom;
  const promoted = asString(fm["promoted"]);
  if (promoted !== undefined) out.promoted = promoted;
  const answered = asString(fm["answered"]);
  if (answered !== undefined) out.answered = answered;
  const captured = asString(fm["captured"]);
  if (captured !== undefined) out.captured = captured;
  const from = asString(fm["from"]);
  if (from !== undefined) out.from = from;
  const annotation = asString(fm["annotation"]);
  if (annotation !== undefined) out.annotation = annotation;
  if (typeof fm["page"] === "number") out.page = fm["page"];
  return out;
}

/** The first `## <name>` — the page's, when the file carries two — and how many there are. */
function section(
  outline: Pick<Outline, "headings">,
  name: string
): { heading: Heading | undefined; count: number } {
  const matches = outline.headings.filter(
    (h) => h.level === 2 && h.text === name
  );
  return { heading: matches[0], count: matches.length };
}

/** A section's body with the blank lines the app keeps around it removed. */
function bodyText(content: string, heading: Heading | undefined): string {
  if (heading === undefined) return "";
  return content.slice(heading.body.start, heading.body.end).trim();
}

/**
 * The Kind's one Position: the body of `## Working answer` (ADR 0020). A
 * page whose heading was retyped has no Position to diff — nothing is
 * reported rather than an empty text that would read as "the answer was
 * cleared" when the heading comes back.
 */
export function researchQuestionPositions(
  outline: ReadableOutline,
  content: string
): Position[] {
  const { heading } = section(outline.outline, "Working answer");
  if (heading === undefined) return [];
  return [{ field: "working answer", text: bodyText(content, heading) }];
}

/**
 * The top-level list items inside a section: those within its body that
 * no other item contains. A nested item belongs to its parent line — a
 * source's note may run on to an indented line, and that is the note's.
 */
function topLevelItems(
  outline: Pick<Outline, "listItems">,
  heading: Heading
): ListItem[] {
  const inside = outline.listItems.filter(
    (item) =>
      item.range.start >= heading.body.start &&
      item.range.end <= heading.body.end
  );
  return inside.filter(
    (item) =>
      !inside.some(
        (other) =>
          other !== item &&
          other.range.start <= item.range.start &&
          other.range.end >= item.range.end
      )
  );
}

const MARKER = /^\s*[-*+]\s+/;
const TASK = /^\[( |x|X)\]\s*/;
// The separator the app writes between a link and its note; a line without
// one is a link and no note, or a note and no link.
const SEPARATOR = /^\s*[—–-]\s*/;

/** The item's text with its list marker gone; a nested item's continuation lines are kept as written. */
function itemText(content: string, item: ListItem): string {
  return content.slice(item.range.start, item.range.end).replace(MARKER, "");
}

/**
 * `- [[target#^id]] — note` → the link and the note. The link must open the
 * line: a mention later in a sentence is prose, and a line that opens with
 * anything else is kept whole as its own note, so nothing the user wrote
 * under the heading is dropped (brief § Ingest review's rule, generalised:
 * an unmatched line surfaces rather than disappears).
 */
function linkLine(
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
  const resolved = index.resolve(path, link);
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
      resolvedKind,
    },
    note: note.trim(),
  };
}

function openThread(content: string, item: ListItem): OpenThread {
  const text = itemText(content, item);
  const task = TASK.exec(text);
  if (task === null) return { text, done: null };
  return { text: text.slice(task[0].length), done: task[1] !== " " };
}

/**
 * The page as the file holds it. The body is read from disk — it is what
 * the page shows and edits, and the hash a later write is `basedOn` — and
 * outlined from those same bytes, so a section's range can never come from
 * one version of the file and its text from another; the index supplies
 * only what a single file cannot know, where each link lands.
 */
export async function readResearchQuestionPage(
  index: VaultIndex,
  vaultPath: string,
  path: string
): Promise<ResearchQuestionPage> {
  const { absolute, relativePath } = await locate(vaultPath, path);
  let bytes: Buffer;
  try {
    bytes = await readFile(absolute);
  } catch (error) {
    return { readable: false, path: relativePath, reason: errorMessage(error) };
  }
  const read = analyseFile(relativePath, bytes.toString("utf8"), sha256(bytes));
  if (!read.readable) return read;
  if (read.kind !== KIND) {
    return {
      readable: false,
      path: relativePath,
      reason: `not a Research Question: kind is ${read.kind ?? "absent"}`,
    };
  }
  let frontmatter: ResearchQuestionFrontmatter;
  try {
    frontmatter = readResearchQuestion(
      (read.outline.frontmatter?.value ?? {}) as Record<string, unknown>
    );
  } catch (error) {
    return { readable: false, path: relativePath, reason: errorMessage(error) };
  }

  // The offsets are into the BOM-less text `analyseFile` outlined.
  const raw = bytes.toString("utf8");
  const content = read.file.bom ? raw.slice(BOM.length) : raw;
  const { outline } = read;
  const problems: ShapeProblem[] = [...read.shape];
  const found = {} as Record<(typeof SECTIONS)[number], Heading | undefined>;
  for (const name of SECTIONS) {
    const { heading, count } = section(outline, name);
    found[name] = heading;
    // A duplicated owned section is already the file's shape problem.
    if (count === 0 || (count > 1 && name !== "Position history")) {
      problems.push({
        path: relativePath,
        kind: KIND,
        problem: count === 0 ? "sectionMissing" : "sectionDuplicated",
        block: name,
      });
    }
  }
  const lines = (heading: Heading | undefined) =>
    heading === undefined
      ? []
      : topLevelItems(outline, heading).map((item) =>
          linkLine(index, relativePath, outline, content, item)
        );
  const threads = found["Open threads"];
  const history = found["Position history"];
  return {
    readable: true,
    path: relativePath,
    hash: read.hash,
    frontmatter,
    sections: {
      workingAnswer: {
        present: found["Working answer"] !== undefined,
        text: bodyText(content, found["Working answer"]),
      },
      supporting: {
        present: found["Supporting sources"] !== undefined,
        lines: lines(found["Supporting sources"]),
      },
      opposing: {
        present: found["Opposing sources"] !== undefined,
        lines: lines(found["Opposing sources"]),
      },
      related: {
        present: found["Related questions"] !== undefined,
        text: bodyText(content, found["Related questions"]),
        lines: lines(found["Related questions"]),
      },
      openThreads: {
        present: threads !== undefined,
        text: bodyText(content, threads),
        threads:
          threads === undefined
            ? []
            : topLevelItems(outline, threads).map((item) =>
                openThread(content, item)
              ),
      },
      positionHistory: {
        present: history !== undefined,
        text: bodyText(content, history),
      },
    },
    problems,
  };
}

/** The sections a plain text field on the page saves whole; Working answer joins with its Revision (#213). */
export const EDITED_SECTIONS = ["Open threads", "Related questions"] as const;
export type EditedSection = (typeof EDITED_SECTIONS)[number];

/**
 * The page's read of a file for a write: the outline the operation is
 * located against and the hash it is `basedOn`. Null when the file cannot
 * be read as a page, with the refusal to answer with.
 */
async function readForWrite(
  vaultPath: string,
  path: string
): Promise<
  | { ok: true; content: string; outline: FileOutline; hash: string }
  | { ok: false; result: WriteResult }
> {
  const { absolute, relativePath } = await locate(vaultPath, path);
  let bytes: Buffer;
  try {
    bytes = await readFile(absolute);
  } catch (error) {
    return {
      ok: false,
      result: {
        written: false,
        reason: "changedAndUnreapplyable",
        detail: `${relativePath}: ${errorMessage(error)}`,
      },
    };
  }
  const raw = bytes.toString("utf8");
  const read = analyseFile(relativePath, raw, sha256(bytes));
  if (!read.readable) {
    return {
      ok: false,
      result: { written: false, reason: "unreadable", detail: read.reason },
    };
  }
  return {
    ok: true,
    content: read.file.bom ? raw.slice(BOM.length) : raw,
    outline: read.outline,
    hash: read.hash,
  };
}

/** One write through the protocol, then the index told of the app's own write, as a capture does. */
async function writeOwn(
  index: VaultIndex,
  vaultPath: string,
  path: string,
  operation: Parameters<typeof write>[2]
): Promise<WriteResult> {
  const result = await write(vaultPath, path, operation);
  if (result.written) {
    const { relativePath } = await locate(vaultPath, path);
    await index.own(relativePath, result.content);
  }
  return result;
}

/**
 * Tick or untick one thread: the task marker on the line whose text is
 * `text` is rewritten and `## Open threads` replaced whole, an Edited
 * section, so a resolved thread stays beside what was learned (CONTEXT.md
 * *Open thread*). The thread is named by its text, not its position, so a
 * file edited underneath still takes the tick where it was meant — or
 * refuses, when the thread is no longer there to take it.
 */
export async function tickThread(
  index: VaultIndex,
  vaultPath: string,
  path: string,
  { text, done }: { text: string; done: boolean }
): Promise<WriteResult> {
  const read = await readForWrite(vaultPath, path);
  if (!read.ok) return read.result;
  const { content, outline, hash } = read;
  const { heading } = section(outline, "Open threads");
  const item =
    heading === undefined
      ? undefined
      : topLevelItems(outline, heading).find((candidate) => {
          const thread = openThread(content, candidate);
          return thread.done !== null && thread.text === text;
        });
  if (heading === undefined || item === undefined) {
    return {
      written: false,
      reason: "changedAndUnreapplyable",
      detail: `no open thread reads "${text}"`,
    };
  }
  // The marker sits right after the list marker; the rest of the line and
  // every other line of the section are the user's and go back as they were.
  const line = content.slice(item.range.start, item.range.end);
  const marker = MARKER.exec(line)?.[0] ?? "";
  const ticked =
    line.slice(0, marker.length) +
    line.slice(marker.length).replace(TASK, done ? "[x] " : "[ ] ");
  const body =
    content.slice(heading.body.start, item.range.start) +
    ticked +
    content.slice(item.range.end, heading.body.end);
  return writeOwn(index, vaultPath, path, {
    operations: [
      { op: "replaceSection", name: "Open threads", body: body.trim() },
    ],
    basedOn: hash,
  });
}

/**
 * An Edited section saved as the user's own typing: `replaceSection` with
 * the body the plain text field holds, `basedOn` the hash the page was
 * given, and no Revision — these sections are prose, not Positions (ADR
 * 0020 decision 4). A file changed underneath is the protocol's to re-apply
 * or refuse; the refusal comes back as data for the page to show in place.
 */
export async function saveSection(
  index: VaultIndex,
  vaultPath: string,
  path: string,
  {
    section: name,
    body,
    basedOn,
  }: { section: EditedSection; body: string; basedOn: string }
): Promise<WriteResult> {
  return writeOwn(index, vaultPath, path, {
    operations: [{ op: "replaceSection", name, body: body.trim() }],
    basedOn,
  });
}
