import { readFile, unlink } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import {
  BOM,
  parseWikilink,
  type Heading,
  type ListItem,
  type Outline,
} from "markdown";
import { stringify } from "yaml";
import { errorMessage, VaultError } from "./errors.js";
import {
  asString,
  readQuestionForWrite,
  type QuestionFile,
  type QuestionStatus,
} from "./question-kind.js";
import {
  coalesce,
  formatRevision,
  readRevisions,
  topLevelItems,
  type Revision,
  type Save,
} from "./position-history.js";
import {
  analyseFile,
  createFile,
  locate,
  sha256,
  write,
  type FileOutline,
  type Operation,
  type Write,
  type Resolution,
  type ShapeProblem,
  type WriteResult,
} from "./vault-files.js";
import type { Position, ReadableOutline, VaultIndex } from "./vault-index.js";

/**
 * The Research Question Kind (`docs/architecture.md` § Vault layout,
 * § Research Question view and triage; ADR 0020): how the page is read from
 * a `kind: research-question` file, and what the Kind reports as its
 * Position; what promotion writes (#210); and the section writes this Kind
 * makes on the user's behalf — each an Edited section replaced whole
 * (ADR 0020 decision 4), the Working answer's save also recording its
 * Revision (#213).
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
  /**
   * The section's body verbatim, and the entries that parse from it,
   * newest first (`position-history.ts`); an item that is not an entry is
   * left out here and left in place in the file.
   */
  positionHistory: { present: boolean; text: string; entries: Revision[] };
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

/**
 * The page a promotion creates, whole (§ Vault layout, Research Question):
 * the Question's keys copied — not re-derived from the index, which may
 * lag the file — the page's own keys, and the six headings in order with
 * the Question's `related:` as lines under the fourth. The body is left on
 * the Question. `tags` are the Question's as the locator read them, so the
 * legacy comma string is split by the package's rule, not restated here.
 * Pure, so the file can be read off a table of cases.
 */
export function composeResearchQuestion(
  question: Record<string, unknown>,
  tags: string[],
  page: { id: string; promotedFrom: string; promoted: string }
): string {
  const lines = [
    "---",
    `id: ${page.id}`,
    `kind: ${KIND}`,
    `question: ${quoted(asString(question["question"]) ?? "")}`,
    "status: open",
    `promoted_from: ${quoted(page.promotedFrom)}`,
    `promoted: ${page.promoted}`,
  ];
  // The Provenance, as the Question holds it; a key it lacks is not invented.
  const captured = question["captured"];
  if (typeof captured === "string") lines.push(`captured: ${plain(captured)}`);
  const context = question["context"];
  if (typeof context === "string") lines.push(`context: ${plain(context)}`);
  const from = question["from"];
  if (typeof from === "string") lines.push(`from: ${quoted(from)}`);
  const pageNumber = question["page"];
  if (typeof pageNumber === "number") lines.push(`page: ${pageNumber}`);
  const annotation = question["annotation"];
  if (typeof annotation === "string") {
    lines.push(`annotation: ${plain(annotation)}`);
  }
  if (tags.length > 0) {
    lines.push("tags:", ...tags.map((tag) => `  - ${plain(tag)}`));
  }
  lines.push("---", "");
  const related = stringList(question["related"]);
  for (const name of SECTIONS) {
    lines.push(`## ${name}`, "");
    if (name === "Related questions" && related.length > 0) {
      lines.push(...related.map((link) => `- ${link}`), "");
    }
  }
  return lines.join("\n");
}

// Always double-quoted, as the Question's own `question:` is: deciding when
// a plain scalar is safe means carrying YAML's rules, and one wrong call
// makes the page unreadable. A wikilink starts with `[`, which is why the
// fixture pages quote `from:` and `promoted_from:` too.
const quoted = (value: string) =>
  stringify(value, { lineWidth: 0, defaultStringType: "QUOTE_DOUBLE" }).trim();
/** Plain where YAML allows it, quoted by `yaml` where it does not. */
const plain = (value: string) => stringify(value, { lineWidth: 0 }).trim();

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

const STATUSES: readonly ResearchQuestionStatus[] = [
  "open",
  "answered",
  "abandoned",
];

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

type PageFile = {
  readable: true;
  relativePath: string;
  /** The text the outline's offsets are into: BOM-less, as the writer splices it. */
  content: string;
  outline: FileOutline;
  hash: string;
  kind: string;
  file: { bom: boolean };
  shape: ShapeProblem[];
};

/**
 * One file read as a Research Question, for the page and for every write
 * the page makes: the bytes, their hash, and the outline of those same
 * bytes. A file that is not this Kind is not readable as a page, whichever
 * caller asked — a tick must no more land on a Note with an `## Open
 * threads` heading than the page may show one.
 */
async function readPageFile(
  vaultPath: string,
  path: string
): Promise<PageFile | { readable: false; path: string; reason: string }> {
  const { absolute, relativePath } = await locate(vaultPath, path);
  let bytes: Buffer;
  try {
    bytes = await readFile(absolute);
  } catch (error) {
    return { readable: false, path: relativePath, reason: errorMessage(error) };
  }
  const raw = bytes.toString("utf8");
  const read = analyseFile(relativePath, raw, sha256(bytes));
  if (!read.readable) return read;
  if (read.kind !== KIND) {
    return {
      readable: false,
      path: relativePath,
      reason: `not a Research Question: kind is ${read.kind ?? "absent"}`,
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
  };
}

/**
 * The entries under `## Position history`, in file order, and — as a shape
 * problem naming its first line — each item that is not one, so a hand
 * edit to the history is never silently discarded (§ Vault layout,
 * Position history). The item itself stays in the file.
 */
function revisionsOf(
  path: string,
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
        kind: KIND,
        problem: "historyEntryUnparsed",
        ...(firstLine === undefined ? {} : { block: firstLine }),
      });
    }
  }
  return { entries, problems };
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
  const read = await readPageFile(vaultPath, path);
  if (!read.readable) return read;
  const { relativePath } = read;
  let frontmatter: ResearchQuestionFrontmatter;
  try {
    frontmatter = readResearchQuestion(
      (read.outline.frontmatter?.value ?? {}) as Record<string, unknown>
    );
  } catch (error) {
    return { readable: false, path: relativePath, reason: errorMessage(error) };
  }

  const { content, outline } = read;
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
  const history = revisionsOf(
    relativePath,
    content,
    outline,
    found["Position history"]
  );
  problems.push(...history.problems);
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
        present: found["Position history"] !== undefined,
        text: bodyText(content, found["Position history"]),
        entries: history.entries,
      },
    },
    problems,
  };
}

/** The sections a plain text field on the page saves whole; Working answer joins with its Revision (#213). */
export const EDITED_SECTIONS = ["Open threads", "Related questions"] as const;
/** Thirty minutes (ADR 0006 decision 5) — a number in code, per spec #206; tests inject a shorter one. */
export const COALESCE_MS = 30 * 60 * 1000;
/** The Edited section that is also a Position, and the field its Revisions carry. */
const WORKING_ANSWER = "Working answer";
const FIELD = "working answer";
export type EditedSection = (typeof EDITED_SECTIONS)[number];

/**
 * What one page write does to the file it finds: the operations and the
 * hash they were computed from, or a result to answer with and write
 * nothing (a refusal, or a save that turned out to change nothing).
 */
type Plan = (read: PageFile) => Write | WriteResult;

// Page writes run one at a time, as captures do (`questions.ts`). Planning
// a write means reading the file — which thread is ticked, what the Working
// answer changed from, whether the head Revision is still inside its
// window — so two writes that both read before either wrote would each
// plan against a file that no longer exists by the time they land: two
// Revisions where the coalescing rule wants one. The protocol's hash check
// would not catch it, because re-apply faithfully applies operations that
// were correct when they were computed and are not any more.
let previous: Promise<unknown> = Promise.resolve();

/**
 * One planned write through the protocol, then the index told of the app's
 * own write, as a capture does — the whole of it inside the queue above.
 */
function writeOwn(
  index: VaultIndex,
  vaultPath: string,
  path: string,
  plan: Plan
): Promise<WriteResult> {
  const run = async (): Promise<WriteResult> => {
    const read = await readPageFile(vaultPath, path);
    if (!read.readable) {
      return { written: false, reason: "unreadable", detail: read.reason };
    }
    const planned = plan(read);
    if ("written" in planned) return planned;
    const result = await write(vaultPath, path, planned);
    if (result.written) await index.own(read.relativePath, result.content);
    return result;
  };
  // A write that threw leaves the queue usable for the next one.
  const queued = previous.then(run, run);
  previous = queued;
  return queued;
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
  return writeOwn(index, vaultPath, path, ({ content, outline, hash }) => {
    const { heading } = section(outline, "Open threads");
    const matches =
      heading === undefined
        ? []
        : topLevelItems(outline, heading).filter((candidate) => {
            const thread = openThread(content, candidate);
            return thread.done !== null && thread.text === text;
          });
    // Two threads with one text: which was meant is not knowable from the
    // text, and ticking the first would be a guess written to disk.
    if (matches.length !== 1) {
      return {
        written: false,
        reason: "changedAndUnreapplyable",
        detail:
          matches.length === 0
            ? `no open thread reads "${text}"`
            : `${matches.length} open threads read "${text}"`,
      };
    }
    const [item] = matches as [ListItem];
    const { body: range } = heading as Heading;
    // The marker sits right after the list marker; the rest of the line and
    // every other line of the section are the user's and go back as they were.
    const line = content.slice(item.range.start, item.range.end);
    const marker = MARKER.exec(line)?.[0] ?? "";
    const ticked =
      line.slice(0, marker.length) +
      line.slice(marker.length).replace(TASK, done ? "[x] " : "[ ] ");
    const body =
      content.slice(range.start, item.range.start) +
      ticked +
      content.slice(item.range.end, range.end);
    return {
      operations: [
        { op: "replaceSection", name: "Open threads", body: body.trim() },
      ],
      basedOn: hash,
    };
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
  return writeOwn(index, vaultPath, path, () => ({
    operations: [{ op: "replaceSection", name, body: body.trim() }],
    basedOn,
  }));
}

/**
 * The Working answer saved, and the Revision it records (#213; ADR 0020
 * decisions 1–2): one write — `replaceSection` on the section, and the
 * entry either prepended or, inside the coalescing window, the head
 * re-stamped by replacing `## Position history` whole with every other
 * byte of it spliced back. It is `saveSection`'s sibling and differs in
 * exactly one way: this section is also a Position, so editing it adds to
 * the history rather than overwriting it (brief § Position history).
 * Text the file already holds is not a save, so a blur that changed
 * nothing records nothing.
 */
export async function saveWorkingAnswer(
  index: VaultIndex,
  vaultPath: string,
  path: string,
  {
    text: typed,
    basedOn,
    at,
    coalesceMs,
  }: { text: string; basedOn: string; at: Date; coalesceMs: number }
): Promise<WriteResult> {
  const text = typed.replace(/\r\n/g, "\n").trim();
  return writeOwn(index, vaultPath, path, (read) => {
    const { content, outline } = read;
    // The Position as the file holds it now: what the Revision is *from*.
    const from = bodyText(content, section(outline, WORKING_ANSWER).heading);
    // Nothing to write, so nothing to base on: the file's hash is the
    // page's fresh view of it, whatever hash the page carried in.
    if (from === text) {
      return { written: true, hash: read.hash, content, shape: read.shape };
    }
    return {
      operations: [
        { op: "replaceSection", name: WORKING_ANSWER, body: text },
        ...historyOperations(
          content,
          outline,
          { field: FIELD, from, at },
          coalesceMs
        ),
      ],
      basedOn,
    };
  });
}

/** What the write-back reached, or why it reached no Question; `path` is vault-relative. */
export type WriteBack =
  { written: true; path: string } | { written: false; reason: string };

/** Resolving is two writes, the page's first: each answers for itself. */
export type ResolveResult = { page: WriteResult; question: WriteBack };

// The write-back does not care what the Question's Status is: the page is
// the authority for a pursuit that ended, and a page resolved twice across
// a reopen must still be able to say so.
const ANY_STATUS: readonly QuestionStatus[] = [
  "open",
  "promoted",
  "answered",
  "abandoned",
];

/**
 * Resolve or abandon the page (ADR 0020 decision 6; § Vault layout,
 * Research Question): the Working answer as it stands is the answer — there
 * is no second field — so this is `status` (and, on *answered*, the date the
 * page was resolved) and then the write-back to the Question it came from.
 *
 * Two writes, the page first, and no rollback between them: a page that was
 * resolved stays resolved and the write-back says what it could not do, so a
 * Question that is gone or is not a Question costs the user the line, not
 * the resolution. *Abandon* sets no `answered:` — the date is in the line —
 * as *drop* on a Question sets only its status.
 */
export async function resolveResearchQuestion(
  index: VaultIndex,
  vaultPath: string,
  path: string,
  /** `at` is the resolution's timestamp, formatted by the caller's clock. */
  { status, at }: { status: "answered" | "abandoned"; at: string }
): Promise<ResolveResult> {
  // The page as the write itself found it: the Question is named by the
  // page's own frontmatter, and a second read could name one the write
  // never saw. Kept from inside the queue, where that read happens.
  const seen: { page: PageFile | null } = { page: null };
  const page = await writeOwn(index, vaultPath, path, (read) => {
    seen.page = read;
    return {
      operations: [{ op: "setFrontmatter", keys: keysFor(status, at) }],
      basedOn: read.hash,
    };
  });
  const resolved = seen.page;
  if (!page.written || resolved === null) {
    return {
      page,
      question: { written: false, reason: "the page was not resolved" },
    };
  }
  const question = await writeBack(index, vaultPath, resolved, { status, at });
  return { page, question };
}

/**
 * The Question the page was promoted from, answered or abandoned with one
 * line in its *lead* — the body before the first `##`, so the line can never
 * land inside a section the user keeps (ADR 0008 decision 2). One write:
 * the keys and the line together, so the Question never carries one without
 * the other. Outside the page queue, because the file is not this page: a
 * triage action racing it from the Inbox is what the protocol's hash check
 * is for, and the loser refuses rather than overwrites.
 */
async function writeBack(
  index: VaultIndex,
  vaultPath: string,
  page: PageFile,
  { status, at }: { status: "answered" | "abandoned"; at: string }
): Promise<WriteBack> {
  const fm = (page.outline.frontmatter?.value ?? {}) as Record<string, unknown>;
  const promotedFrom = asString(fm["promoted_from"]);
  if (promotedFrom === undefined) {
    return {
      written: false,
      reason: "the page has no promoted_from: there is no Question to answer",
    };
  }
  const inner = /^\[\[(.*)\]\]$/.exec(promotedFrom.trim())?.[1];
  if (inner === undefined) {
    return {
      written: false,
      reason: `promoted_from is not a wikilink: ${promotedFrom}`,
    };
  }
  // Where the link lands is the index's to say, by the same rule every
  // `links` row is resolved by — never a guess from the link's text.
  const { resolution, resolvedPath } = index.resolve(
    page.relativePath,
    parseWikilink(inner)
  );
  if (resolvedPath === null) {
    return {
      written: false,
      reason: `${promotedFrom} ${
        resolution === "ambiguous"
          ? "matches more than one file"
          : "matches no file in the vault"
      }`,
    };
  }
  // The same read every triage action makes, with the same refusals — a
  // write-back is triage the page asked for. Its throw is data here: the
  // page is already resolved, so this half reports rather than raises.
  let question: QuestionFile;
  try {
    question = await readQuestionForWrite(vaultPath, resolvedPath, ANY_STATUS);
  } catch (cause) {
    return { written: false, reason: errorMessage(cause) };
  }
  const line = `${status === "answered" ? "Answered by" : "Abandoned with"} [[${basename(page.relativePath, ".md")}]] — ${dateOf(at)}`;
  const result = await write(vaultPath, question.path, {
    operations: [
      { op: "setFrontmatter", keys: keysFor(status, at) },
      { op: "appendToSection", target: "lead", line },
    ],
    basedOn: question.hash,
  });
  if (!result.written) {
    return {
      written: false,
      reason: `${question.path}: ${result.reason} — ${result.detail}`,
    };
  }
  await index.own(question.path, result.content);
  return { written: true, path: question.path };
}

/**
 * The keys a resolution sets, the same on the page and on its Question.
 * *Abandon* sets no date: there is no `abandoned:` key in the vault's
 * vocabulary (§ Vault layout), the day is in the write-back line, and a
 * dropped Question likewise carries only its status.
 */
const keysFor = (status: "answered" | "abandoned", at: string) =>
  status === "answered" ? { status, answered: at } : { status };

// The line is prose the user reads, so it carries the day, not the second;
// the timestamp itself is in `answered:`, where a machine reads it.
const dateOf = (iso: string) => iso.slice(0, 10);

/**
 * Reopen the page: `status: open`, and nothing else — the body, the
 * history, the Question's line, and the page's own `answered` all stay
 * where they are, because resolving is a status and not an archive (ADR
 * 0020 decision 6) and no operation removes a key. Setting the Question
 * back to open is the Inbox's own *reopen* (#212), the surface that owns
 * the Question's Status.
 */
export async function reopenResearchQuestion(
  index: VaultIndex,
  vaultPath: string,
  path: string
): Promise<WriteResult> {
  return writeOwn(index, vaultPath, path, (read) => ({
    operations: [{ op: "setFrontmatter", keys: { status: "open" } }],
    basedOn: read.hash,
  }));
}

/**
 * The history's part of one save. A new entry is prepended; a save inside
 * the window re-stamps the head entry, which means the owned section is
 * replaced whole — the operation set has no "edit one entry", and this is
 * the path a why added after the fact takes too (§ Research Question view
 * and triage).
 */
function historyOperations(
  content: string,
  outline: Pick<Outline, "headings" | "listItems">,
  save: Save,
  coalesceMs: number
): Operation[] {
  const history = section(outline, "Position history").heading;
  const items =
    history === undefined ? [] : readRevisions(content, outline, history);
  const head = items[0];
  const { coalesced, revision } = coalesce(
    head?.revision ?? null,
    save,
    coalesceMs
  );
  const entry = formatRevision(revision);
  if (!coalesced || history === undefined || head === undefined) {
    return [{ op: "prependEntry", section: "Position history", entry }];
  }
  const body =
    content.slice(history.body.start, head.range.start) +
    entry +
    content.slice(head.range.end, history.body.end);
  return [
    { op: "replaceSection", name: "Position history", body: body.trim() },
  ];
}

/** Where a promotion landed: the new page's path, vault-relative, for the hash. */
export type Promotion = { path: string };

/**
 * Promote a Question (#210; § Research Question view and triage, Triage
 * from the Inbox): the page first, whole, then the Question's two keys
 * through the protocol. A page that could not be created leaves the
 * Question untouched, and a Question the protocol would not mark takes the
 * page back with it, so the vault never holds a page nothing points at.
 * The index is told of both writes before this returns, so the row reads
 * *promoted* and the page reads at once. The caller serialises this with
 * captures: both pick a free name in the Question's folder.
 */
export async function promoteQuestion(
  vaultPath: string,
  index: VaultIndex,
  path: string,
  /** The timestamp for `promoted:`, formatted by the caller's clock, and the id source. */
  { promoted, newId }: { promoted: string; newId: () => string }
): Promise<Promotion> {
  const {
    path: relativePath,
    hash,
    frontmatter: fm,
    outline,
  } = await readQuestionForWrite(vaultPath, path, ["open"]);

  const stem = basename(relativePath, ".md");
  const tags = outline.tags
    .filter((t) => t.valid && t.source === "frontmatter")
    .map((t) => t.text);
  const content = composeResearchQuestion(fm, tags, {
    id: newId(),
    promotedFrom: `[[${stem}]]`,
    promoted,
  });
  const { pagePath, created } = await createPage(
    vaultPath,
    dirname(relativePath),
    stem,
    content
  );

  const marked = await write(vaultPath, relativePath, {
    basedOn: hash,
    operations: [
      {
        op: "setFrontmatter",
        keys: {
          status: "promoted",
          promoted_to: `[[${basename(pagePath, ".md")}]]`,
        },
      },
    ],
  });
  if (!marked.written) {
    await unlink(join(vaultPath, pagePath)).catch(() => undefined);
    throw new VaultError(
      "refused",
      `Couldn't mark ${relativePath} promoted: ${marked.detail}`
    );
  }
  await index.own(pagePath, created.content);
  await index.own(relativePath, marked.content);
  return { path: pagePath };
}

/**
 * The page beside the Question as ` (RQ)`, then ` (RQ) (2)`, …: the name is
 * the Question's, and a file that already holds it — a note, a hand-made
 * page — is never replaced. `createFile` refuses only on that; anything
 * else it says no to is an I/O fault, reported as one.
 */
async function createPage(
  vaultPath: string,
  folder: string,
  stem: string,
  content: string
): Promise<{ pagePath: string; created: WriteResult & { written: true } }> {
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${stem} (RQ)` : `${stem} (RQ) (${n})`;
    const pagePath = join(folder, `${name}.md`).split(sep).join("/");
    const created = await createFile(vaultPath, pagePath, content);
    if (created.written) return { pagePath, created };
    if (created.reason !== "alreadyExists") {
      throw new VaultError(
        "writeFailed",
        `Couldn't write ${pagePath}: ${created.detail}`
      );
    }
  }
}
