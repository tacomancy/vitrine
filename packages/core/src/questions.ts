import { randomBytes } from "node:crypto";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VaultError, type VaultService } from "./vault.js";

/** Where a Question came from. This slice knows one context: Unattached. */
export type Provenance = { context: "other" };

export type Question = {
  id: string;
  path: string;
  question: string;
  status: "open";
  captured: string;
  context: Provenance["context"];
};

export type QuestionService = {
  capture: (text: string, provenance: Provenance) => Promise<Question>;
};

export type QuestionServiceOptions = {
  vault: VaultService;
  /** The clock, so a test can pin `captured`. */
  now?: () => Date;
  /** The id source, so a test can know a file's name before it exists. */
  newId?: () => string;
};

// RFC 4648 base32, lowercased: 32 symbols, 5 bits each.
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** A 10-character id from 50 random bits (docs/architecture.md § Vault layout). */
export function newId(): string {
  return Array.from(randomBytes(10), (byte) => BASE32[byte & 31]).join("");
}

const NAME_LIMIT = 80;
// Obsidian refuses these in a file name; the second set breaks wikilinks.
const FORBIDDEN = /[*"\\/<>:|?#^[\]]/g;

/**
 * The file name a Question's text yields, or the id when nothing survives.
 * Pure, so the rules can be read off a table of cases.
 */
export function fileName(text: string, id: string): string {
  let name = text.replace(FORBIDDEN, "").replace(/\s+/g, " ").trim();
  // A leading dot would make the file a dot-entry, which every scan of the
  // vault skips — a captured Question that never appears in the Inbox.
  name = name.replace(/^\.+/, "").trimStart();
  if (name.length > NAME_LIMIT) {
    const cut = name.lastIndexOf(" ", NAME_LIMIT);
    name = name.slice(0, cut > 0 ? cut : NAME_LIMIT).trimEnd();
  }
  return name === "" ? id : name;
}

/** ISO 8601 at seconds precision with the local UTC offset, never `Z`. */
export function localIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const hh = pad(Math.floor(Math.abs(offset) / 60));
  const mm = pad(Math.abs(offset) % 60);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${hh}:${mm}`
  );
}

// Always double-quoted: deciding when a plain scalar is safe means carrying
// YAML's rules for leading `-`, `: `, ` #`, numbers, booleans and the rest,
// and getting one wrong makes a Question unreadable. Quoting is never wrong.
function yamlString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

/** The whole file: frontmatter keys in ADR 0006's order, then an empty body. */
function questionFile(q: Question): string {
  return [
    "---",
    `id: ${q.id}`,
    `kind: ${"question"}`,
    `question: ${yamlString(q.question)}`,
    `status: ${q.status}`,
    `captured: ${q.captured}`,
    `context: ${q.context}`,
    "---",
    "",
  ].join("\n");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** `<name>.md`, or `<name> (2).md`, `<name> (3).md`, … whichever is free. */
async function freePath(folder: string, name: string): Promise<string> {
  let candidate = join(folder, `${name}.md`);
  for (let n = 2; await exists(candidate); n++) {
    candidate = join(folder, `${name} (${n}).md`);
  }
  return candidate;
}

/**
 * Write whole, then rename into place: a crash mid-write leaves a temp file
 * the vault scan ignores (it is a dot-entry), never a half Question.
 */
async function writeAtomically(path: string, content: string): Promise<void> {
  const temp = join(join(path, ".."), `.${randomBytes(6).toString("hex")}.tmp`);
  await writeFile(temp, content, { flag: "wx" });
  try {
    await rename(temp, path);
  } catch (cause) {
    await unlink(temp).catch(() => undefined);
    throw cause;
  }
}

export function createQuestionService({
  vault,
  now = () => new Date(),
  newId: nextId = newId,
}: QuestionServiceOptions): QuestionService {
  return {
    capture: async (text, provenance) => {
      const current = await vault.current();
      if (current === null) {
        throw new VaultError(
          "noVault",
          "No vault is open. Open a vault first."
        );
      }
      const question: Omit<Question, "path"> = {
        id: nextId(),
        question: text.trim(),
        status: "open",
        captured: localIso(now()),
        context: provenance.context,
      };
      const folder = join(current.path, "questions");
      await mkdir(folder, { recursive: true });
      const path = await freePath(
        folder,
        fileName(question.question, question.id)
      );
      const written: Question = { ...question, path };
      await writeAtomically(path, questionFile(written));
      return written;
    },
  };
}
