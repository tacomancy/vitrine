import { open, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { parse as parseYaml } from "yaml";

export type QuestionStatus = "open" | "promoted" | "answered" | "abandoned";

/** A Question as the Inbox lists it: frontmatter fields, nothing from the body. */
export type Question = {
  /** Absent on a file another tool wrote without one; the path identifies it. */
  id?: string;
  path: string;
  question: string;
  status: QuestionStatus;
  captured: string;
  context: string;
  from?: string;
  page?: number;
  annotation?: string;
};

/** A `kind: question` file missing what a row needs; shown by name and mtime. */
export type PartialQuestion = { path: string; name: string; mtime: string };

export type Listing = {
  questions: Question[];
  partial: PartialQuestion[];
  unreadable: Array<{ path: string; reason: string }>;
};

export type Order = "newest" | "oldest";

const STATUSES: readonly QuestionStatus[] = [
  "open",
  "promoted",
  "answered",
  "abandoned",
];

/**
 * Every `.md` file under the vault, skipping dot-entries (files and folders
 * alike — `.obsidian/`, `.git/`, `.vitrine/`) and never following symlinks.
 * A folder that cannot be listed is reported, not skipped.
 */
async function markdownFiles(
  root: string,
  unreadable: Listing["unreadable"]
): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      unreadable.push({ path: dir, reason: errorMessage(error) });
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) files.push(full);
    }
  }
  await walk(root);
  return files.sort();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const CHUNK = 4096;
// A frontmatter block longer than this is not one; stop rather than read a
// whole file looking for a closing fence that is never coming.
const MAX_FRONTMATTER = 64 * 1024;

const OPEN_FENCE = /^---\r?\n/;
const CLOSE_FENCE = /\r?\n---\r?\n/;
// A file may end on its closing fence with no newline after it.
const CLOSE_FENCE_AT_EOF = /\r?\n---$/;

/**
 * The YAML between the opening and closing `---` fences, read in chunks so
 * the body past the block is never loaded. Null when the file has no block.
 */
async function readFrontmatter(path: string): Promise<string | null> {
  const handle = await open(path, "r");
  try {
    // Decoded incrementally: a multibyte character can straddle two reads.
    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.alloc(CHUNK);
    let text = "";
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, CHUNK, null);
      const eof = bytesRead < CHUNK;
      text += decoder.write(buffer.subarray(0, bytesRead));
      if (eof) text += decoder.end();
      if (!OPEN_FENCE.test(text)) return null;
      // The opening fence is three characters; the YAML starts after it and
      // runs to the newline that precedes the closing fence.
      const close =
        CLOSE_FENCE.exec(text.slice(3)) ??
        (eof ? CLOSE_FENCE_AT_EOF.exec(text.slice(3)) : null);
      if (close) return text.slice(3, 3 + close.index + 1);
      if (eof || text.length > MAX_FRONTMATTER) {
        throw new Error("frontmatter block is not closed");
      }
    }
  } finally {
    await handle.close();
  }
}

type Frontmatter = Record<string, unknown>;

async function parseFrontmatter(path: string): Promise<Frontmatter | null> {
  const yaml = await readFrontmatter(path);
  if (yaml === null) return null;
  const parsed: unknown = parseYaml(yaml);
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("frontmatter is not a map of keys");
  }
  return parsed as Frontmatter;
}

const asString = (v: unknown) => (typeof v === "string" ? v : undefined);

/**
 * The Question a frontmatter block describes; null when `question` or
 * `captured` is missing (the file is Partial). A key that is present but
 * holds a value the vocabulary cannot read is a fault to report, not a gap.
 */
function toQuestion(path: string, fm: Frontmatter): Question | null {
  const question = asString(fm["question"]);
  const captured = asString(fm["captured"]);
  if (question === undefined || captured === undefined) return null;
  if (Number.isNaN(Date.parse(captured))) {
    throw new Error(`captured is not a date: ${captured}`);
  }
  // A Question that was never triaged is open, so a file with no status is.
  const status = fm["status"] === undefined ? "open" : fm["status"];
  if (!STATUSES.includes(status as QuestionStatus)) {
    throw new Error(
      `status is not open, promoted, answered, or abandoned: ${JSON.stringify(status)}`
    );
  }
  const q: Question = {
    path,
    question,
    status: status as QuestionStatus,
    captured,
    // No context recorded means nothing was open: time and place are the
    // whole Provenance, which is what `other` says.
    context: asString(fm["context"]) ?? "other",
  };
  const id = asString(fm["id"]);
  if (id !== undefined) q.id = id;
  const from = asString(fm["from"]);
  if (from !== undefined) q.from = from;
  if (typeof fm["page"] === "number") q.page = fm["page"];
  const annotation = asString(fm["annotation"]);
  if (annotation !== undefined) q.annotation = annotation;
  return q;
}

/**
 * Every Question in the vault, wherever it sits (ADR 0006 decision 1). A file
 * that cannot be read or parsed is reported, never dropped; nothing is written.
 */
export async function listQuestions(
  vaultPath: string,
  order: Order
): Promise<Listing> {
  const listing: Listing = { questions: [], partial: [], unreadable: [] };
  for (const path of await markdownFiles(vaultPath, listing.unreadable)) {
    try {
      const fm = await parseFrontmatter(path);
      if (fm === null || fm["kind"] !== "question") continue;
      const question = toQuestion(path, fm);
      if (question) {
        listing.questions.push(question);
      } else {
        const { mtime } = await stat(path);
        listing.partial.push({
          path,
          name: basename(path, ".md"),
          mtime: mtime.toISOString(),
        });
      }
    } catch (error) {
      listing.unreadable.push({ path, reason: errorMessage(error) });
    }
  }
  const byTime = (a: string, b: string) =>
    (order === "newest" ? -1 : 1) * (Date.parse(a) - Date.parse(b));
  listing.questions.sort((a, b) => byTime(a.captured, b.captured));
  listing.partial.sort((a, b) => byTime(a.mtime, b.mtime));
  return listing;
}
