import { unlink } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { parseWikilink, type Heading, type ListItem } from "markdown";
import { stringify } from "yaml";
import { errorMessage, VaultError } from "./errors.js";
import { wikilinkTo } from "./link-text.js";
import {
  asString,
  quoted,
  readQuestionForWrite,
  type QuestionFile,
  type QuestionStatus,
} from "./question-kind.js";
import { onOneLine, topLevelItems, type Revision } from "./position-history.js";
import {
  bodyText,
  itemText,
  linkLine,
  MARKER,
  readPageFile,
  revisionsOf,
  section,
  type LinkLine,
  type PageFile,
} from "./page-file.js";
import {
  notExactlyOne,
  saveEditedSection,
  savePosition,
  writeOwn,
  type PageContext,
  type PageKind,
  type SavedAnswer,
} from "./page-write.js";
import {
  createFile,
  locate,
  write,
  type Operation,
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

export type { LinkLine, PageContext, SavedAnswer };

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
    ...copiedKeys(question, tags),
    "---",
    "",
  ];
  const related = stringList(question["related"]);
  for (const name of SECTIONS) {
    lines.push(`## ${name}`, "");
    if (name === "Related questions" && related.length > 0) {
      lines.push(...related.map((link) => `- ${link}`), "");
    }
  }
  return lines.join("\n");
}

/**
 * The Question's Provenance and tags as frontmatter lines, copied rather
 * than re-derived (PROM-5): a key the Question lacks is not invented. Every
 * page promoted from a Question carries these, whichever Kind it is.
 */
export function copiedKeys(
  question: Record<string, unknown>,
  tags: string[]
): string[] {
  const lines: string[] = [];
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
  return lines;
}

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

const TASK = /^\[( |x|X)\]\s*/;

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
  const read = await readPageFile(vaultPath, path, [PAGE.kind], PAGE.noun);
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
    KIND,
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
/** The Edited section that is also a Position, and the field its Revisions carry. */
const WORKING_ANSWER = "Working answer";
const FIELD = "working answer";
export type EditedSection = (typeof EDITED_SECTIONS)[number];

/** What this Kind's writes expect the file to be (`page-write.ts`). */
export const PAGE: PageKind = { kind: KIND, noun: "a Research Question" };

/**
 * Tick or untick one thread: the task marker on the line whose text is
 * `text` is rewritten and `## Open threads` replaced whole, an Edited
 * section, so a resolved thread stays beside what was learned (CONTEXT.md
 * *Open thread*). The thread is named by its text, not its position, so a
 * file edited underneath still takes the tick where it was meant — or
 * refuses, when the thread is no longer there to take it.
 */
export async function tickThread(
  ctx: PageContext,
  path: string,
  { text, done }: { text: string; done: boolean }
): Promise<WriteResult> {
  return writeOwn(ctx, path, PAGE, ({ content, outline, hash }) => {
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
      return notExactlyOne(matches.length, {
        none: `no open thread reads "${text}"`,
        several: `${matches.length} open threads read "${text}"`,
      });
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
 * An Edited section saved as the user's own typing, with no Revision —
 * these sections are prose, not Positions (ADR 0020 decision 4). The write
 * is every Kind's (`saveEditedSection`).
 */
export async function saveSection(
  ctx: PageContext,
  path: string,
  input: { section: EditedSection; body: string; basedOn: string; was: string }
): Promise<WriteResult> {
  return saveEditedSection(ctx, path, PAGE, input);
}

/**
 * The Working answer saved, and the Revision it records (#213; ADR 0020
 * decisions 1–2): `saveSection`'s sibling, differing in exactly one way —
 * this section is also a Position, so editing it adds to the history
 * rather than overwriting it (brief § Position history). The write itself
 * is every Kind's (`savePosition`).
 */
export async function saveWorkingAnswer(
  ctx: PageContext,
  path: string,
  input: {
    text: string;
    basedOn: string;
    was: string;
    at: Date;
    coalesceMs: number;
  }
): Promise<SavedAnswer> {
  return savePosition(ctx, path, PAGE, {
    ...input,
    section: WORKING_ANSWER,
    field: FIELD,
  });
}

/** The two sides a source attaches to, and the only two (ADR 0020 decision 5). */
export const SIDES = ["supporting", "opposing"] as const;
export type Side = (typeof SIDES)[number];

/** Each side's heading, as promotion writes it. */
const SIDE_SECTION: Record<Side, string> = {
  supporting: "Supporting sources",
  opposing: "Opposing sources",
};

/** The Kinds a side can hold: a paper, with or without its PDF yet. */
const ATTACHABLE = new Set(["source", "source-stub"]);

/** What the index calls a Markdown file that declares no `kind:` — a null column, not a missing row. */
const NOTE = "note";

/**
 * Attach a source to one side (#218; § Vault layout's source line grammar):
 * one `appendToSection` writing `- [[citekey]] — why it is here` under the
 * chosen heading, with the note left off when there is none. There is no
 * third side, so the side is the judgement the caller has already made and
 * this write has no default to fall back on (ADR 0020 decision 5).
 *
 * The target must be a Source or a stub the Index knows: a side is where
 * evidence goes, and a Question or a Note landing there would read as
 * evidence ever after. A paper not yet judged is Related, or nothing.
 */
export async function attachSource(
  ctx: PageContext,
  path: string,
  {
    target,
    side,
    note,
    basedOn,
  }: { target: string; side: Side; note: string; basedOn: string }
): Promise<WriteResult> {
  const { index, vaultPath } = ctx;
  const { relativePath: targetPath } = await locate(vaultPath, target);
  const row = index.select<{ kind: string | null }>(
    "SELECT kind FROM files WHERE path = ?",
    targetPath
  )[0];
  // A file the Index has no row for is `wikilinkTo`'s refusal to give — it
  // says so in the same words Link does. A row it *has* is asked its Kind,
  // and a null column is a Note, which is a Kind like any other here and
  // not the absence of one.
  if (row !== undefined && !ATTACHABLE.has(row.kind ?? NOTE)) {
    throw new VaultError(
      "refused",
      `${targetPath} is not a Source or a stub; a paper not yet judged is Related, or nothing.`
    );
  }
  return writeOwn(ctx, path, PAGE, ({ relativePath }) => {
    const wikilink = wikilinkTo(index, relativePath, targetPath);
    return {
      operations: [
        {
          op: "appendToSection",
          target: { section: SIDE_SECTION[side] },
          line: sourceLine(wikilink, note),
        },
      ],
      basedOn,
    };
  });
}

/**
 * `- [[citekey]] — note`, on one line whatever was typed: the list item's
 * own rule, which `onOneLine` states and a why obeys too.
 */
function sourceLine(wikilink: string, note: string): string {
  const text = onOneLine(note);
  return text === "" ? `- ${wikilink}` : `- ${wikilink} \u2014 ${text}`;
}

/** What a link onto a Research Question did, as `Linked` says it for a Question. */
export type LinkedToPage = { path: string; target: string; linked: boolean };

/**
 * Accept a candidate onto a Research Question (#489; ADR 0041 decision 9):
 * one `appendToSection` of `- [[cite]]` under `## Related questions`, the
 * place this Kind keeps its Related edge. `questions.link` sets a key a page
 * does not have. Never Supporting or Opposing: a paper nobody has judged is
 * not evidence.
 *
 * `appendToSection` would *create* a missing heading at the end of the file,
 * and a doubled one is not knowably the one meant; both refuse instead, as
 * `relocate` does. A paper the section already links — by any line, as
 * Coverage counts it — leaves the file untouched.
 */
export async function linkToResearchQuestion(
  ctx: PageContext,
  path: string,
  targetPath: string
): Promise<LinkedToPage> {
  const { index, vaultPath } = ctx;
  const { relativePath: target } = await locate(vaultPath, targetPath);
  let linked = true;
  let wikilink = "";
  const result = await writeOwn(ctx, path, PAGE, (read) => {
    const { heading, count } = section(read.outline, "Related questions");
    if (count !== 1 || heading === undefined) {
      return notExactlyOne(count, {
        none: "no ## Related questions heading was found",
        several: "more than one ## Related questions heading was found",
      });
    }
    if (target === read.relativePath) {
      return {
        written: false,
        reason: "changedAndUnreapplyable",
        detail: `${target} cannot be related to itself.`,
      };
    }
    wikilink = wikilinkTo(index, read.relativePath, target);
    const listed = read.outline.links.some(
      (l) =>
        l.syntax === "wikilink" &&
        l.range.start >= heading.body.start &&
        l.range.end <= heading.body.end &&
        index.resolve(read.relativePath, l).resolvedPath === target
    );
    if (listed) {
      linked = false;
      // Nothing to write; the plan answers with the refusal-shaped no-op the
      // caller reads `linked` past, so a file already right is never rewritten.
      return {
        written: false,
        reason: "changedAndUnreapplyable",
        detail: "already listed",
      };
    }
    return {
      operations: [
        {
          op: "appendToSection",
          target: { section: "Related questions" },
          line: `- ${wikilink}`,
        },
      ],
      basedOn: read.hash,
    };
  });
  if (!result.written && linked) {
    throw new VaultError("refused", `Couldn't link ${path}: ${result.detail}`);
  }
  return { path, target: wikilink, linked };
}

/** The other side; there are only two, so this is a fact and not a lookup (ADR 0020 decision 5). */
const otherSide = (side: Side): Side =>
  side === "supporting" ? "opposing" : "supporting";

/**
 * Move a source to the other side (#219; spec #206 story 27): the line
 * leaves one heading and joins the end of the other, its note and its
 * block id with it. Both sides are replaced whole — they are Edited
 * sections, the user's prose the app rewrites only because the user asked
 * it to — and no Revision is recorded: the history is of positions, not of
 * the bibliography, and a move that changed a mind is named by the why on
 * the next Revision (ADR 0020 decision 4).
 */
export async function moveSource(
  ctx: PageContext,
  path: string,
  { from, text, basedOn }: { from: Side; text: string; basedOn: string }
): Promise<WriteResult> {
  return relocate(ctx, path, { from, to: otherSide(from), text, basedOn });
}

/**
 * Detach a source: the line goes, and only the side it was on is replaced.
 * Nothing else is written — the paper itself is untouched, and a page that
 * has stopped citing it says so by not citing it.
 */
export async function detachSource(
  ctx: PageContext,
  path: string,
  { side, text, basedOn }: { side: Side; text: string; basedOn: string }
): Promise<WriteResult> {
  return relocate(ctx, path, { from: side, to: null, text, basedOn });
}

/**
 * The write both verbs make. The line is named by its text, as a ticked
 * thread is, so a file edited underneath takes the move where it was meant
 * — or refuses, when the text is no longer there or reads twice and which
 * line was meant would be a guess written to disk. Every other line on
 * either side goes back exactly as it was written, so a hand-written line
 * survives a move to the byte.
 */
async function relocate(
  ctx: PageContext,
  path: string,
  {
    from,
    to,
    text,
    basedOn,
  }: { from: Side; to: Side | null; text: string; basedOn: string }
): Promise<WriteResult> {
  return writeOwn(ctx, path, PAGE, ({ content, outline }) => {
    const heading = section(outline, SIDE_SECTION[from]).heading;
    // A retyped heading is its own refusal, said in those words: falling
    // through to "no source reads …" would name the line when the heading
    // is what is gone, and send the user looking for the wrong thing.
    if (heading === undefined) return noHeading(from);
    const matches = topLevelItems(outline, heading).filter(
      (item) => itemText(content, item) === text
    );
    if (matches.length !== 1) {
      return notExactlyOne(matches.length, {
        none: `no ${from} source reads "${text}"`,
        several: `${matches.length} ${from} sources read "${text}"`,
      });
    }
    const [item] = matches as [ListItem];
    const line = content.slice(item.range.start, item.range.end);
    const operations: Operation[] = [
      {
        op: "replaceSection",
        name: SIDE_SECTION[from],
        body: withoutItem(content, heading.body, item),
      },
    ];
    if (to !== null) {
      const target = section(outline, SIDE_SECTION[to]).heading;
      // `replaceSection` would write the heading at the end of the file,
      // putting the moved source below `## Position history`. A retyped
      // heading is already named in the page's problems; this write says
      // so too rather than restructuring the file to get its line in.
      if (target === undefined) return noHeading(to);
      const body = bodyText(content, target);
      operations.push({
        op: "replaceSection",
        name: SIDE_SECTION[to],
        body: body === "" ? line : `${body}\n${line}`,
      });
    }
    return { operations, basedOn };
  });
}

/** A side whose heading has been retyped: named as itself, not as a line that is missing. */
const noHeading = (side: Side): WriteResult => ({
  written: false,
  reason: "changedAndUnreapplyable",
  detail: `no ## ${SIDE_SECTION[side]} heading was found`,
});

/**
 * The section's body with one item cut out, its line ending with it:
 * cutting the range alone would leave that newline behind as a blank line,
 * and the next read would find a paragraph break where the list was.
 */
function withoutItem(
  content: string,
  body: { start: number; end: number },
  item: ListItem
): string {
  const ending = /^\r?\n/.exec(content.slice(item.range.end, body.end));
  const after = item.range.end + (ending?.[0].length ?? 0);
  return (
    content.slice(body.start, item.range.start) + content.slice(after, body.end)
  ).trim();
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
  ctx: PageContext,
  path: string,
  /** `at` is the resolution's timestamp, formatted by the caller's clock. */
  { status, at }: { status: "answered" | "abandoned"; at: string }
): Promise<ResolveResult> {
  // The page as the write itself found it: the Question is named by the
  // page's own frontmatter, and a second read could name one the write
  // never saw. Kept from inside the queue, where that read happens.
  const seen: { page: PageFile | null } = { page: null };
  const page = await writeOwn(ctx, path, PAGE, (read) => {
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
  // The Question's own file, so it takes the index and the vault path
  // rather than the page context: `writeBack` runs outside the page queue
  // on purpose, and has no pending Revisions of its own to fold in.
  const question = await writeBack(ctx.index, ctx.vaultPath, resolved, {
    status,
    at,
  });
  return { page, question };
}

/**
 * The Question the page was promoted from, answered or abandoned with one
 * line in its lead (`writeToQuestion`).
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
  const parent = resolvePromotedFrom(index, page.relativePath, promotedFrom);
  if ("reason" in parent) return { written: false, reason: parent.reason };
  const line = `${status === "answered" ? "Answered by" : "Abandoned with"} [[${basename(page.relativePath, ".md")}]] — ${dateOf(at)}`;
  return writeToQuestion(index, vaultPath, parent.path, {
    keys: keysFor(status, at),
    line,
  });
}

/**
 * The file a page's `promoted_from` names, or why none can be written to:
 * not a wikilink, no file by that name, or two — which resolves to
 * nothing rather than to whichever was indexed first. Where the link lands
 * is the index's to say, by the same rule every `links` row is resolved
 * by — never a guess from the link's text. Shared by every write-back — a
 * resolved Research Question's and a closed Hypothesis loop's (#338) — so
 * one broken link is refused in the same words wherever it is followed.
 */
export function resolvePromotedFrom(
  index: VaultIndex,
  linkingPath: string,
  promotedFrom: string
): { path: string } | { reason: string } {
  const inner = /^\[\[(.*)\]\]$/.exec(promotedFrom.trim())?.[1];
  if (inner === undefined) {
    return { reason: `promoted_from is not a wikilink: ${promotedFrom}` };
  }
  const { resolution, resolvedPath } = index.resolve(
    linkingPath,
    parseWikilink(inner)
  );
  if (resolvedPath === null) {
    return {
      reason: `${promotedFrom} ${
        resolution === "ambiguous"
          ? "matches more than one file"
          : "matches no file in the vault"
      }`,
    };
  }
  return { path: resolvedPath };
}

/**
 * A write-back landing on a Question: `keys` and one line in its *lead* —
 * the body before the first `##`, so the line can never land inside a
 * section the user keeps (ADR 0008 decision 2) — in one write, so the
 * Question never carries one without the other. Outside any page queue,
 * because the file is not the page's: a triage action racing it from the
 * Inbox is what the protocol's hash check is for, and the loser refuses
 * rather than overwrites. Any Status: the write-back is the page's act,
 * and a Question answered once can be answered again. The index is told
 * before this returns, so the Inbox row reads the new Status at once.
 */
export async function writeToQuestion(
  index: VaultIndex,
  vaultPath: string,
  path: string,
  { keys, line }: { keys: Record<string, string>; line: string }
): Promise<WriteBack> {
  // The same read every triage action makes, with the same refusals — a
  // write-back is triage the page asked for. Its throw is data here: the
  // caller decides whether a write-back that could not land is a report
  // or a refusal.
  let question: QuestionFile;
  try {
    question = await readQuestionForWrite(vaultPath, path, ANY_STATUS);
  } catch (cause) {
    return { written: false, reason: errorMessage(cause) };
  }
  const result = await write(vaultPath, question.path, {
    operations: [
      { op: "setFrontmatter", keys },
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
export const dateOf = (iso: string) => iso.slice(0, 10);

/**
 * Reopen the page: `status: open`, and nothing else — the body, the
 * history, the Question's line, and the page's own `answered` all stay
 * where they are, because resolving is a status and not an archive (ADR
 * 0020 decision 6) and no operation removes a key. Setting the Question
 * back to open is the Inbox's own *reopen* (#212), the surface that owns
 * the Question's Status.
 */
export async function reopenResearchQuestion(
  ctx: PageContext,
  path: string
): Promise<WriteResult> {
  return writeOwn(ctx, path, PAGE, (read) => ({
    operations: [{ op: "setFrontmatter", keys: { status: "open" } }],
    basedOn: read.hash,
  }));
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

  const marked = await markPromoted(vaultPath, relativePath, hash, pagePath);
  await index.own(pagePath, created.content);
  await index.own(relativePath, marked);
  return { path: pagePath };
}

/**
 * The second write of a promotion from a Question: its `status: promoted`
 * and `promoted_to`, naming the page just created, or the page taken back
 * (`orTakeBack`). Returns the Question's new content, for the index.
 */
export async function markPromoted(
  vaultPath: string,
  questionPath: string,
  basedOn: string,
  pagePath: string
): Promise<string> {
  return orTakeBack(
    vaultPath,
    pagePath,
    `Couldn't mark ${questionPath} promoted`,
    () =>
      write(vaultPath, questionPath, {
        basedOn,
        operations: [
          {
            op: "setFrontmatter",
            keys: {
              status: "promoted",
              promoted_to: `[[${basename(pagePath, ".md")}]]`,
            },
          },
        ],
      })
  );
}

/**
 * The second write of any promotion — the object promoted from, made to
 * point at the page just created. A page nothing points at is a stray the
 * user never asked for, so when this write is refused (`refusedAs` and the
 * protocol's detail) or fails outright, the page is taken back before the
 * reason is thrown. Returns the written file's new content.
 */
export async function orTakeBack(
  vaultPath: string,
  pagePath: string,
  refusedAs: string,
  second: () => Promise<WriteResult>
): Promise<string> {
  const takeBack = () =>
    unlink(join(vaultPath, pagePath)).catch(() => undefined);
  let result: WriteResult;
  try {
    result = await second();
  } catch (cause) {
    await takeBack();
    throw cause;
  }
  if (!result.written) {
    await takeBack();
    throw new VaultError("refused", `${refusedAs}: ${result.detail}`);
  }
  return result.content;
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
