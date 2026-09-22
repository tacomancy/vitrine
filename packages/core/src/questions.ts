import { randomBytes } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { writeAtomically } from "./atomic-write.js";
import { errorMessage, VaultError } from "./errors.js";
import { readQuestion, type QuestionStatus } from "./question-kind.js";
import { promoteQuestion, type Promotion } from "./research-question.js";
import {
  analyseFile,
  locate,
  sha256,
  write,
  type Operation,
} from "./vault-files.js";
import type { VaultIndex } from "./vault-index.js";
import type { VaultService } from "./vault.js";

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

/** What a triage write left behind: the Question, vault-relative, and its Status now. */
export type Triage = { path: string; status: QuestionStatus };

export type QuestionService = {
  capture: (text: string, provenance: Provenance) => Promise<Question>;
  /** Promote to Research Question (#210): the page written whole, then the Question marked. */
  promote: (path: string) => Promise<Promotion>;
  /** Answer in place (#212): the typed line into the lead, then the two keys. */
  answer: (path: string, line: string) => Promise<Triage>;
  /** Drop (#212): `status: abandoned`, and nothing else touched. */
  drop: (path: string) => Promise<Triage>;
  /** Reopen (#212): `status: open`, the body — the answer text included — left as it is. */
  reopen: (path: string) => Promise<Triage>;
};

export type QuestionServiceOptions = {
  vault: VaultService;
  /** The clock, so a test can pin `captured`. */
  now?: (() => Date) | undefined;
  /** The id source, so a test can know a file's name before it exists. */
  newId?: (() => string) | undefined;
};

// RFC 4648 base32, lowercased: 32 symbols, 5 bits each.
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/** A 10-character id from 50 random bits (docs/architecture.md § Vault layout). */
export function randomId(): string {
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
    "kind: question",
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

const VAULT_SCHEMA = 1;

/** `.vitrine/vault.json`: the folder is a Vitrine vault from here on. */
async function writeVaultMeta(
  vaultPath: string,
  meta: { id: string; created: string }
): Promise<void> {
  const folder = join(vaultPath, ".vitrine");
  await mkdir(folder, { recursive: true });
  const content = JSON.stringify(
    { id: meta.id, schema: VAULT_SCHEMA, created: meta.created },
    null,
    2
  );
  await writeFile(join(folder, "vault.json"), content + "\n", { flag: "wx" });
}

async function freePath(folder: string, name: string): Promise<string> {
  let candidate = join(folder, `${name}.md`);
  for (let n = 2; await exists(candidate); n++) {
    candidate = join(folder, `${name} (${n}).md`);
  }
  return candidate;
}

/**
 * The Question a triage key names, or the refusal the row shows: a file
 * that is not a Question, and a Status the action does not allow, are both
 * the `refused` kind (§ Research Question view and triage). A promoted
 * Question is left to its page — answering or dropping it here would leave
 * the page open behind a Question that says it is finished.
 */
async function questionForTriage(
  vaultPath: string,
  path: string,
  allowed: readonly QuestionStatus[]
): Promise<{ relativePath: string; hash: string }> {
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
  let question: ReturnType<typeof readQuestion>;
  try {
    question = read.kind === "question" ? readQuestion(fm) : null;
  } catch (cause) {
    throw new VaultError(
      "unreadable",
      `${relativePath}: ${errorMessage(cause)}`
    );
  }
  if (question === null) {
    throw new VaultError("refused", `${relativePath} is not a Question.`);
  }
  if (!allowed.includes(question.status)) {
    throw new VaultError(
      "refused",
      `${relativePath} is ${question.status}, not ${allowed.join(" or ")}.`
    );
  }
  return { relativePath, hash: read.hash };
}

/**
 * One triage write through the protocol, and the index told of it before
 * this returns so the row reads its new Status without waiting for the
 * watcher. A write the protocol would not make is the refusal, with its
 * detail — never silent.
 */
async function triage(
  vaultPath: string,
  index: VaultIndex,
  { relativePath, hash }: { relativePath: string; hash: string },
  verb: string,
  status: QuestionStatus,
  operations: Operation[]
): Promise<Triage> {
  const result = await write(vaultPath, relativePath, {
    basedOn: hash,
    operations,
  });
  if (!result.written) {
    throw new VaultError(
      "refused",
      `Couldn't ${verb} ${relativePath}: ${result.detail}`
    );
  }
  await index.own(relativePath, result.content);
  return { path: relativePath, status };
}

export function createQuestionService({
  vault,
  now = () => new Date(),
  newId = randomId,
}: QuestionServiceOptions): QuestionService {
  // Captures run one at a time. Two arriving together (the window and, later,
  // the iPad) would otherwise both find the same name free and the second
  // rename would silently replace the first — one record where there should
  // be two.
  let previous: Promise<unknown> = Promise.resolve();

  /** The file on disk, whole or not at all; its content comes back for the index. */
  async function writeQuestion(
    vaultPath: string,
    question: Omit<Question, "path">
  ): Promise<{ written: Question; content: string }> {
    const folder = join(vaultPath, "questions");
    try {
      await mkdir(folder, { recursive: true });
      const path = await freePath(
        folder,
        fileName(question.question, question.id)
      );
      const written: Question = { ...question, path };
      const content = questionFile(written);
      await writeAtomically(path, content);
      // The marker follows the Question, and a Question the marker could
      // not follow is taken back: a capture happens whole or not at all,
      // so a failure reported is a failure, and a retry is never a
      // duplicate. The text is still in the capture line.
      if (!(await exists(join(vaultPath, ".vitrine", "vault.json")))) {
        await writeVaultMeta(vaultPath, {
          id: newId(),
          created: question.captured,
        }).catch(async (cause: unknown) => {
          await unlink(written.path).catch(() => undefined);
          throw cause;
        });
      }
      return { written, content };
    } catch (cause) {
      // Permissions, a full disk, a folder that vanished: the text stays
      // in the capture line with this message, never lost and never silent.
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new VaultError(
        "writeFailed",
        `Couldn't write the Question into ${folder}: ${reason}`
      );
    }
  }

  async function capture(
    text: string,
    provenance: Provenance
  ): Promise<Question> {
    const current = await vault.current();
    if (current === null) {
      throw new VaultError("noVault", "No vault is open. Open a vault first.");
    }
    const { written, content } = await writeQuestion(current.path, {
      id: newId(),
      question: text.trim(),
      status: "open",
      captured: localIso(now()),
      context: provenance.context,
    });
    // The capture lands in the Inbox before this returns (ADR 0010): the
    // index is written from the content just written, in one transaction,
    // and the watcher will recognise the file's hash as the app's own.
    await (
      await vault.opened()
    )?.index.own(
      relative(current.path, written.path).split(sep).join("/"),
      content
    );
    return written;
  }

  /** Captures and promotions run one at a time: both pick a free name in questions/. */
  function serially<T>(work: () => Promise<T>): Promise<T> {
    const run = previous.then(work, work);
    previous = run;
    return run;
  }

  /** The open vault, or the refusal every procedure that writes raises. */
  async function opened() {
    const open = await vault.opened();
    if (open === null) {
      throw new VaultError("noVault", "No vault is open. Open a vault first.");
    }
    return open;
  }

  // Answer, drop and reopen are not serialised with captures: they write to
  // a file that already exists and pick no name, so nothing can collide.
  return {
    capture: (text, provenance) => serially(() => capture(text, provenance)),
    promote: (path) =>
      serially(async () => {
        const open = await opened();
        return promoteQuestion(open.vault.path, open.index, path, {
          promoted: localIso(now()),
          newId,
        });
      }),
    answer: async (path, line) => {
      const { vault: open, index } = await opened();
      const found = await questionForTriage(open.path, path, ["open"]);
      return triage(open.path, index, found, "answer", "answered", [
        // The lead, never inside a `##` section the user keeps below it
        // (ADR 0008 decision 2): an answer is not a note under a heading.
        { op: "appendToSection", target: "lead", line },
        {
          op: "setFrontmatter",
          keys: { status: "answered", answered: localIso(now()) },
        },
      ]);
    },
    drop: async (path) => {
      const { vault: open, index } = await opened();
      const found = await questionForTriage(open.path, path, ["open"]);
      return triage(open.path, index, found, "drop", "abandoned", [
        { op: "setFrontmatter", keys: { status: "abandoned" } },
      ]);
    },
    reopen: async (path) => {
      const { vault: open, index } = await opened();
      const found = await questionForTriage(open.path, path, [
        "answered",
        "abandoned",
      ]);
      // `answered:` stays: no operation removes a key, and the Status is
      // what says the Question is open again. The body — the answer text
      // included — is not touched at all (CONTEXT.md *Reopen*).
      return triage(open.path, index, found, "reopen", "open", [
        { op: "setFrontmatter", keys: { status: "open" } },
      ]);
    },
  };
}
