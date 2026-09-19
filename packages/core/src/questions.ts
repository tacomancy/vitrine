import { open, readdir } from "node:fs/promises";
import { join } from "node:path";
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
  // Provenance keys, present when the file has them.
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
      unreadable.push({ path: dir, reason: describe(error) });
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const CHUNK = 4096;
// A frontmatter block longer than this is not one; stop rather than read a
// whole file looking for a closing fence that is never coming.
const MAX_FRONTMATTER = 64 * 1024;

/**
 * The YAML between the opening and closing `---` fences, read in chunks so
 * the body past the block is never loaded. Null when the file has no block.
 */
async function readFrontmatter(path: string): Promise<string | null> {
  const handle = await open(path, "r");
  try {
    let text = "";
    const buffer = Buffer.alloc(CHUNK);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, CHUNK, null);
      text += buffer.toString("utf8", 0, bytesRead);
      if (!/^---\r?\n/.test(text)) return null;
      const close = /\r?\n---(\r?\n|$)/.exec(text.slice(3));
      if (close) return text.slice(3, 3 + close.index + 1);
      if (bytesRead < CHUNK || text.length > MAX_FRONTMATTER) {
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

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** The Question a frontmatter block describes, or null when a required key is missing. */
function toQuestion(path: string, fm: Frontmatter): Question | null {
  const question = str(fm["question"]);
  const captured = str(fm["captured"]);
  if (question === undefined || captured === undefined) return null;
  if (Number.isNaN(Date.parse(captured))) return null;
  // A Question that was never triaged is open; only a status the vocabulary
  // does not know makes the file partial.
  const status = fm["status"] === undefined ? "open" : fm["status"];
  if (!STATUSES.includes(status as QuestionStatus)) return null;
  const q: Question = {
    path,
    question,
    status: status as QuestionStatus,
    captured,
    context: str(fm["context"]) ?? "other",
  };
  const id = str(fm["id"]);
  if (id !== undefined) q.id = id;
  const from = str(fm["from"]);
  if (from !== undefined) q.from = from;
  if (typeof fm["page"] === "number") q.page = fm["page"];
  const annotation = str(fm["annotation"]);
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
    let fm: Frontmatter | null;
    try {
      fm = await parseFrontmatter(path);
    } catch (error) {
      listing.unreadable.push({ path, reason: describe(error) });
      continue;
    }
    if (fm === null || fm["kind"] !== "question") continue;
    const question = toQuestion(path, fm);
    if (question) {
      listing.questions.push(question);
    } else {
      const handle = await open(path, "r");
      const { mtime } = await handle.stat().finally(() => handle.close());
      listing.partial.push({
        path,
        name: path.slice(path.lastIndexOf("/") + 1, -".md".length),
        mtime: mtime.toISOString(),
      });
    }
  }
  const sign = order === "newest" ? -1 : 1;
  listing.questions.sort(
    (a, b) => sign * (Date.parse(a.captured) - Date.parse(b.captured))
  );
  listing.partial.sort(
    (a, b) => sign * (Date.parse(a.mtime) - Date.parse(b.mtime))
  );
  return listing;
}
