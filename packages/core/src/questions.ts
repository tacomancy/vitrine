import { randomBytes } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { writeAtomically } from "./atomic-write.js";
import { errorMessage, VaultError } from "./errors.js";
import { readQuestion } from "./question-kind.js";
import { composeResearchQuestion } from "./research-question.js";
import {
  analyseFile,
  createFile,
  locate,
  sha256,
  write,
  type WriteResult,
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

/** Where a promotion landed: the new page's path, vault-relative, for the hash. */
export type Promotion = { path: string };

export type QuestionService = {
  capture: (text: string, provenance: Provenance) => Promise<Question>;
  /** Promote to Research Question (#210): the page written whole, then the Question marked. */
  promote: (path: string) => Promise<Promotion>;
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

  /**
   * The page first, whole, then the Question's two keys: a page that could
   * not be created leaves the Question untouched, and a Question the
   * protocol would not mark takes the page back with it, so the vault never
   * holds a page nothing points at. The index is told of both writes before
   * this returns, so the row reads *promoted* and the page reads at once.
   */
  async function promote(
    vaultPath: string,
    index: VaultIndex,
    path: string
  ): Promise<Promotion> {
    const { absolute, relativePath } = await locate(vaultPath, path);
    const bytes = await readFile(absolute).catch((cause: unknown) => {
      throw new VaultError(
        "unreadable",
        `Couldn't read ${relativePath}: ${errorMessage(cause)}`
      );
    });
    const read = analyseFile(
      relativePath,
      bytes.toString("utf8"),
      sha256(bytes)
    );
    if (!read.readable) {
      throw new VaultError("unreadable", `${relativePath}: ${read.reason}`);
    }
    const fm = (read.outline.frontmatter?.value ?? {}) as Record<
      string,
      unknown
    >;
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
    const content = composeResearchQuestion(fm, {
      id: newId(),
      promotedFrom: `[[${stem}]]`,
      promoted: localIso(now()),
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
   * The page beside the Question as ` (RQ)`, then ` (RQ) (2)`, …: the name
   * is the Question's, and a file that already holds it — a note, a
   * hand-made page — is never replaced.
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
          "refused",
          `Couldn't create ${pagePath}: ${created.detail}`
        );
      }
    }
  }

  /** Captures and promotions run one at a time: both pick a free name in questions/. */
  function serially<T>(work: () => Promise<T>): Promise<T> {
    const run = previous.then(work, work);
    previous = run;
    return run;
  }

  return {
    capture: (text, provenance) => serially(() => capture(text, provenance)),
    promote: (path) =>
      serially(async () => {
        const opened = await vault.opened();
        if (opened === null) {
          throw new VaultError(
            "noVault",
            "No vault is open. Open a vault first."
          );
        }
        return promote(opened.vault.path, opened.index, path);
      }),
  };
}
