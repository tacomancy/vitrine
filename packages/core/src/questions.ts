import { randomBytes } from "node:crypto";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { writeAtomically } from "./atomic-write.js";
import { errorMessageWithoutPath, VaultError } from "./errors.js";
import { fileName } from "./file-name.js";
import { linkQuestion, type Linked } from "./link.js";
import {
  readQuestionForWrite,
  type QuestionFile,
  type QuestionStatus,
} from "./question-kind.js";
import {
  promoteToHypothesis,
  promoteResearchQuestionToHypothesis,
} from "./hypothesis.js";
import { promoteQuestion, type Promotion } from "./research-question.js";
import { serialised } from "./serialise.js";
import { localIso } from "./time.js";
import { readOutline, write, type Operation } from "./vault-files.js";
import type { VaultIndex } from "./vault-index.js";
import type { VaultService } from "./vault.js";

/**
 * The two folders a capture writes into, as the vault holds them. They are
 * named in the failure messages as well as joined onto the vault path, and
 * the message must say the same folder the write meant (#288).
 */
const QUESTIONS_FOLDER = "questions";
const META_FOLDER = ".vitrine";

/**
 * Where a Question came from (CONTEXT.md *Provenance*): Unattached;
 * captured on a Research Question's or a Hypothesis's page — `page` is that
 * page's vault-relative path, and the Question is a sub-question of it; or
 * the follow-up a Hypothesis's result raised (#339, CAP-5).
 */
export type Provenance =
  | { context: "other" }
  | { context: "pursuing"; page: string }
  | { context: "resolving"; hypothesis: string };

/** The page a capture was made on, and the Kinds its context allows there. */
function pageOf(
  provenance: Provenance
): { path: string; kinds: readonly string[]; noun: string } | null {
  switch (provenance.context) {
    case "other":
      return null;
    case "pursuing":
      return {
        path: provenance.page,
        kinds: ["research-question", "hypothesis"],
        noun: "a Research Question or a Hypothesis",
      };
    case "resolving":
      return {
        path: provenance.hypothesis,
        kinds: ["hypothesis"],
        noun: "a Hypothesis",
      };
  }
}

export type Question = {
  id: string;
  path: string;
  question: string;
  status: "open";
  captured: string;
  /** The wikilink to what was open at capture; absent when Unattached. */
  from?: string;
  context: Provenance["context"];
};

/** Where a triage write landed: the Question's path, vault-relative. */
export type Triage = { path: string };

export type QuestionService = {
  capture: (text: string, provenance: Provenance) => Promise<Question>;
  /** Promote to Research Question (#210): the page written whole, then the Question marked. */
  promote: (path: string) => Promise<Promotion>;
  /** Promote to Hypothesis (#331): the page written whole from the typed claim, then the Question marked. */
  promoteToHypothesis: (path: string, claim: string) => Promise<Promotion>;
  /** Sharpen a Research Question into a Hypothesis (#332): the page written whole, then the sharpened line. */
  promoteResearchQuestionToHypothesis: (
    path: string,
    claim: string
  ) => Promise<Promotion>;
  /** Link (#211): a wikilink appended to the Question's `related`, the linking side only. */
  link: (path: string, target: string) => Promise<Linked>;
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
    // A wikilink opens with `[[`, a flow sequence to YAML: always quoted.
    ...(q.from === undefined ? [] : [`from: ${yamlString(q.from)}`]),
    `context: ${q.context}`,
    "---",
    "",
  ].join("\n");
}

/** `questions/Name (RQ).md` → `[[Name (RQ)]]`: how a Question names the page it was captured on. */
const wikilinkTo = (path: string) => `[[${basename(path, ".md")}]]`;

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
  const folder = join(vaultPath, META_FOLDER);
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

// Which Statuses each triage action allows (§ Research Question view and
// triage). A promoted Question is in neither set: it is left to its page,
// whose resolve and abandon write back to both files.
const OPEN: readonly QuestionStatus[] = ["open"];
const TRIAGED: readonly QuestionStatus[] = ["answered", "abandoned"];

/**
 * One triage write through the protocol, and the index told of it before
 * this returns so the row reads its new Status without waiting for the
 * watcher. A write the protocol would not make is the refusal, with its
 * detail — never silent.
 */
async function triage(
  vaultPath: string,
  index: VaultIndex,
  { path, hash }: QuestionFile,
  verb: string,
  operations: Operation[]
): Promise<Triage> {
  const result = await write(vaultPath, path, { basedOn: hash, operations });
  if (!result.written) {
    throw new VaultError(
      "refused",
      `Couldn't ${verb} ${path}: ${result.detail}`
    );
  }
  await index.own(path, result.content);
  return { path };
}

export function createQuestionService({
  vault,
  now = () => new Date(),
  newId = randomId,
}: QuestionServiceOptions): QuestionService {
  // Captures and promotions run one at a time: each picks a free name, in
  // questions/ or in hypotheses/. Two arriving together (the window and,
  // later, the iPad) would otherwise both find the same name free and the
  // second rename would silently replace the first — one record where
  // there should be two. The queue is per service, not per module: two services are two
  // vaults, and a capture in one has no name to lose to the other.
  const serially = serialised();

  /** The file on disk, whole or not at all; its content comes back for the index. */
  async function writeQuestion(
    vaultPath: string,
    question: Omit<Question, "path">
  ): Promise<{ written: Question; content: string }> {
    const folder = join(vaultPath, QUESTIONS_FOLDER);
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
      if (!(await exists(join(vaultPath, META_FOLDER, "vault.json")))) {
        await writeVaultMeta(vaultPath, {
          id: newId(),
          created: question.captured,
        }).catch(async (cause: unknown) => {
          await unlink(written.path).catch(() => undefined);
          // The marker's failure, not the Question's — which was written
          // and taken back. With the errno's path gone (#288) this message
          // is all that says which of the two writes could not happen.
          throw new VaultError(
            "writeFailed",
            `Couldn't write the vault marker into ${META_FOLDER}/: ${errorMessageWithoutPath(cause)}`
          );
        });
      }
      return { written, content };
    } catch (cause) {
      // The marker's own failure already says what it was. It is the only
      // VaultError reachable in this try and it is `writeFailed` too, so
      // nothing a surface switches on moves; a second one thrown in here
      // would need its own kind to be the right one to come out.
      if (cause instanceof VaultError) throw cause;
      // Permissions, a full disk, a folder that vanished: the text stays
      // in the capture line with this message, never lost and never silent.
      throw new VaultError(
        "writeFailed",
        `Couldn't write the Question into ${QUESTIONS_FOLDER}/: ${errorMessageWithoutPath(cause)}`
      );
    }
  }

  /**
   * The other half of a capture made while pursuing: the page's `## Related
   * questions` gains the new Question's link — on a page that edge is the
   * section, not a `related:` key (§ Vault layout). One `appendToSection`
   * through the protocol, `basedOn` a fresh read, so the line joins the
   * list already there. A page that cannot take it is the capture's
   * failure, not a quiet half: the caller takes the Question back.
   */
  async function linkFromPage(
    vaultPath: string,
    pagePath: string,
    question: Question
  ): Promise<{ path: string; content: string }> {
    const page = await readOutline(vaultPath, pagePath);
    if (!page.readable) throw new Error(`${page.path}: ${page.reason}`);
    if (page.kind !== "research-question") {
      throw new Error(
        `${page.path} is not a Research Question: kind is ${page.kind ?? "absent"}`
      );
    }
    const result = await write(vaultPath, pagePath, {
      operations: [
        {
          op: "appendToSection",
          target: { section: "Related questions" },
          line: `- ${wikilinkTo(question.path)}`,
        },
      ],
      basedOn: page.hash,
    });
    if (!result.written) {
      throw new Error(`${page.path}: ${result.reason} — ${result.detail}`);
    }
    return { path: page.path, content: result.content };
  }

  async function capture(
    text: string,
    provenance: Provenance
  ): Promise<Question> {
    const current = await vault.current();
    if (current === null) {
      throw new VaultError("noVault", "No vault is open. Open a vault first.");
    }
    const onPage = pageOf(provenance);
    // Checked before anything is written, so a page of the wrong Kind costs
    // nothing to take back. Only a Research Question's page is written to
    // as well: a Hypothesis's neighbours are a query over `from:` (ADR 0031
    // decision 11), so a capture there is the Question alone.
    let linkOnPage = false;
    if (onPage !== null) {
      const page = await readOutline(current.path, onPage.path);
      const kind = page.readable ? page.kind : null;
      if (kind === null || !onPage.kinds.includes(kind)) {
        throw new VaultError(
          "writeFailed",
          `Couldn't capture on the page: ${
            page.readable
              ? `${page.path} is not ${onPage.noun}: kind is ${kind ?? "absent"}`
              : `${page.path}: ${page.reason}`
          }`
        );
      }
      linkOnPage = kind === "research-question";
    }
    const { written, content } = await writeQuestion(current.path, {
      id: newId(),
      question: text.trim(),
      status: "open",
      captured: localIso(now()),
      ...(onPage === null ? {} : { from: wikilinkTo(onPage.path) }),
      context: provenance.context,
    });
    const opened = await vault.opened();
    const relativePath = (path: string) =>
      relative(current.path, path).split(sep).join("/");
    if (onPage !== null && linkOnPage) {
      let page: { path: string; content: string };
      try {
        page = await linkFromPage(current.path, onPage.path, written);
      } catch (cause) {
        // Whole or not at all, as with the vault marker: the text is still
        // in the capture line, and a retry is never a duplicate. A Question
        // that could not be taken back is named, so it is never a stray.
        const message = `Couldn't link the Question from the page: ${errorMessageWithoutPath(cause)}`;
        const leftover = await unlink(written.path).then(
          () => "",
          (error: unknown) =>
            ` (and ${relativePath(written.path)} could not be removed: ${errorMessageWithoutPath(error)})`
        );
        throw new VaultError("writeFailed", message + leftover);
      }
      await opened?.index.own(page.path, page.content);
    }
    // The capture lands in the Inbox before this returns (ADR 0010): the
    // index is written from the content just written, in one transaction,
    // and the watcher will recognise the file's hash as the app's own.
    await opened?.index.own(relativePath(written.path), content);
    return written;
  }

  /** The open vault, or the refusal every procedure that writes raises. */
  async function opened() {
    const open = await vault.opened();
    if (open === null) {
      throw new VaultError("noVault", "No vault is open. Open a vault first.");
    }
    return open;
  }

  // Answer, drop, reopen and link are not serialised with captures: they
  // write to a file that already exists and pick no name, so nothing can
  // collide over a name. Link has a hazard of its own — it reads `related`
  // and writes the list back — and holds its own queue for it, in
  // `link.ts`, where the read and the write cannot be pulled apart.
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
    // In the same queue: the Hypothesis's name is picked as the page's is,
    // and two promotions of one claim must not both find it free.
    promoteToHypothesis: (path, claim) =>
      serially(async () => {
        const open = await opened();
        return promoteToHypothesis(open.vault.path, open.index, path, claim, {
          promoted: localIso(now()),
          newId,
        });
      }),
    // The same name, picked from a Research Question's page (#332): in the
    // same queue, so the Inbox and the page promoting one claim at once
    // cannot both find it free.
    promoteResearchQuestionToHypothesis: (path, claim) =>
      serially(async () => {
        const { vault: open, index, pending } = await opened();
        return promoteResearchQuestionToHypothesis(
          { vaultPath: open.path, index, pending },
          path,
          claim,
          { promoted: localIso(now()), newId }
        );
      }),
    link: async (path, target) => {
      const open = await opened();
      return linkQuestion(open.vault.path, open.index, path, target);
    },
    answer: async (path, line) => {
      const { vault: open, index } = await opened();
      const found = await readQuestionForWrite(open.path, path, OPEN);
      return triage(open.path, index, found, "answer", [
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
      const found = await readQuestionForWrite(open.path, path, OPEN);
      return triage(open.path, index, found, "drop", [
        { op: "setFrontmatter", keys: { status: "abandoned" } },
      ]);
    },
    reopen: async (path) => {
      const { vault: open, index } = await opened();
      const found = await readQuestionForWrite(open.path, path, TRIAGED);
      // `answered:` stays: no operation removes a key, and the Status is
      // what says the Question is open again. The body — the answer text
      // included — is not touched at all (CONTEXT.md *Reopen*).
      return triage(open.path, index, found, "reopen", [
        { op: "setFrontmatter", keys: { status: "open" } },
      ]);
    },
  };
}
