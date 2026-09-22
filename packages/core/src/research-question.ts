import { readFile, unlink } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { BOM, type Heading, type ListItem, type Outline } from "markdown";
import { stringify } from "yaml";
import { errorMessage, VaultError } from "./errors.js";
import { asString, readQuestion } from "./question-kind.js";
import {
  coalesce,
  formatRevision,
  readRevisions,
  topLevelItems,
  type Revision,
  type Save,
} from "./position-history.js";
import type { VaultService } from "./vault.js";
import {
  analyseFile,
  createFile,
  locate,
  sha256,
  write,
  type FileOutline,
  type Operation,
  type Resolution,
  type ShapeProblem,
  type WriteRefusal,
  type WriteResult,
} from "./vault-files.js";
import type { Position, ReadableOutline, VaultIndex } from "./vault-index.js";

/**
 * The Research Question Kind (`docs/architecture.md` § Vault layout,
 * § Research Question view and triage; ADR 0020): how the page is read from
 * a `kind: research-question` file, and what the Kind reports as its
 * Position; what promotion writes (#210); and how a save of `## Working
 * answer` records its Revision (#213). The other sections' writes arrive
 * with the tickets that own them.
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
  related: { present: boolean; lines: LinkLine[] };
  openThreads: { present: boolean; threads: OpenThread[] };
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
  return {
    text,
    link: {
      target: link.target,
      blockId: link.blockId,
      ...index.resolve(path, link),
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

/** The file's text as outlined — BOM-less, so the outline's offsets index it — with its outline. */
type PageFile = {
  content: string;
  outline: FileOutline;
  hash: string;
  shape: ShapeProblem[];
};

/**
 * A Research Question file from disk, or why it is not one. The body is
 * read from disk — it is what the page shows and edits, and the hash a
 * later write is `basedOn` — and outlined from those same bytes, so a
 * section's range can never come from one version of the file and its
 * text from another.
 */
async function readPageFile(
  absolute: string,
  relativePath: string
): Promise<{ ok: true; file: PageFile } | { ok: false; reason: string }> {
  let bytes: Buffer;
  try {
    bytes = await readFile(absolute);
  } catch (error) {
    return { ok: false, reason: errorMessage(error) };
  }
  const raw = bytes.toString("utf8");
  const read = analyseFile(relativePath, raw, sha256(bytes));
  if (!read.readable) return { ok: false, reason: read.reason };
  if (read.kind !== KIND) {
    return {
      ok: false,
      reason: `not a Research Question: kind is ${read.kind ?? "absent"}`,
    };
  }
  return {
    ok: true,
    file: {
      content: read.file.bom ? raw.slice(BOM.length) : raw,
      outline: read.outline,
      hash: read.hash,
      shape: read.shape,
    },
  };
}

/**
 * The page as the file holds it; the index supplies only what a single
 * file cannot know, where each link lands.
 */
export async function readResearchQuestionPage(
  index: VaultIndex,
  vaultPath: string,
  path: string
): Promise<ResearchQuestionPage> {
  const { absolute, relativePath } = await locate(vaultPath, path);
  const read = await readPageFile(absolute, relativePath);
  if (!read.ok)
    return { readable: false, path: relativePath, reason: read.reason };
  const { content, outline, hash } = read.file;
  let frontmatter: ResearchQuestionFrontmatter;
  try {
    frontmatter = readResearchQuestion(
      (outline.frontmatter?.value ?? {}) as Record<string, unknown>
    );
  } catch (error) {
    return { readable: false, path: relativePath, reason: errorMessage(error) };
  }
  const problems: ShapeProblem[] = [...read.file.shape];
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
    hash,
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
        lines: lines(found["Related questions"]),
      },
      openThreads: {
        present: threads !== undefined,
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

export type SaveResult =
  | { written: true; hash: string }
  | { written: false; reason: WriteRefusal; detail: string };

export type ResearchQuestionService = {
  /**
   * Save `## Working answer` as the user typed it, recording the Revision
   * (spec #206 stories 14, 31, 32): one write, `basedOn` the hash the page
   * was given. Text the file already holds is not a save.
   */
  saveWorkingAnswer: (
    path: string,
    text: string,
    basedOn: string
  ) => Promise<SaveResult>;
};

export type ResearchQuestionServiceOptions = {
  vault: VaultService;
  now?: (() => Date) | undefined;
  /** ADR 0006 decision 5's coalescing window; tests pass a short one. */
  coalesceMs?: number | undefined;
};

/** Thirty minutes (ADR 0006 decision 5) — a number in code, per spec #206. */
export const COALESCE_MS = 30 * 60 * 1000;

const FIELD = "working answer";

export function createResearchQuestionService({
  vault,
  now = () => new Date(),
  coalesceMs = COALESCE_MS,
}: ResearchQuestionServiceOptions): ResearchQuestionService {
  // Saves run one at a time: two landing together would each read the
  // same head entry and both prepend, where the second should re-stamp.
  let previous: Promise<unknown> = Promise.resolve();

  async function saveWorkingAnswer(
    path: string,
    typed: string,
    basedOn: string
  ): Promise<SaveResult> {
    const opened = await vault.opened();
    if (opened === null) {
      throw new VaultError("noVault", "No vault is open. Open a vault first.");
    }
    const vaultPath = opened.vault.path;
    const { absolute, relativePath } = await locate(vaultPath, path);
    const read = await readPageFile(absolute, relativePath);
    if (!read.ok) {
      return { written: false, reason: "unreadable", detail: read.reason };
    }
    const { content, outline, hash } = read.file;
    const text = typed.replace(/\r\n/g, "\n").trim();
    // The Position as the file holds it now: what the Revision is *from*.
    // The page was given this same text unless the file changed underneath,
    // which the write protocol catches (#215 turns that into a line).
    const from = bodyText(content, section(outline, "Working answer").heading);
    // Nothing to write, so nothing to base on: the file's hash is the
    // page's fresh view of it, whatever hash the page carried in.
    if (from === text) return { written: true, hash };

    const operations: Operation[] = [
      { op: "replaceSection", name: "Working answer", body: text },
      ...historyOperation(content, outline, { field: FIELD, from, at: now() }),
    ];
    const result = await write(vaultPath, relativePath, {
      operations,
      basedOn,
    });
    if (!result.written) return result;
    // Indexed from the content just written, as a capture is (ADR 0014):
    // the `positions` row follows the save before the reply, and the
    // watcher recognises the file's hash as the app's own.
    await opened.index.own(relativePath, result.content);
    return { written: true, hash: result.hash };
  }

  /**
   * The history's part of one save (ADR 0020 decision 2): a new entry is
   * prepended; a save inside the window re-stamps the head entry, which
   * means the owned section is replaced whole — with every other byte of
   * it, hand-typed lines included, spliced back as it was.
   */
  function historyOperation(
    content: string,
    outline: Pick<Outline, "headings" | "listItems">,
    save: Save
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

  return {
    saveWorkingAnswer: (path, text, basedOn) => {
      const run = previous.then(
        () => saveWorkingAnswer(path, text, basedOn),
        () => saveWorkingAnswer(path, text, basedOn)
      );
      previous = run;
      return run;
    },
  };
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
  const { absolute, relativePath } = await locate(vaultPath, path);
  const bytes = await readFile(absolute).catch((cause: unknown) => {
    throw new VaultError(
      "unreadable",
      `Couldn't read ${relativePath}: ${errorMessage(cause)}`
    );
  });
  const read = analyseFile(relativePath, bytes.toString("utf8"), sha256(bytes));
  if (!read.readable) {
    throw new VaultError("unreadable", `${relativePath}: ${read.reason}`);
  }
  const fm = (read.outline.frontmatter?.value ?? {}) as Record<string, unknown>;
  const question = read.kind === "question" ? readQuestion(fm) : null;
  if (question === null) {
    throw new VaultError("refused", `${relativePath} is not a Question.`);
  }
  if (question.status !== "open") {
    throw new VaultError(
      "refused",
      `${relativePath} is ${question.status}, not open; reopen it first.`
    );
  }

  const stem = basename(relativePath, ".md");
  const tags = read.outline.tags
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
    basedOn: read.hash,
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
