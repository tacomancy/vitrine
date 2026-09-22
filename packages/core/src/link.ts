import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseWikilink } from "markdown";
import { errorMessage, VaultError } from "./errors.js";
import { readQuestion } from "./question-kind.js";
import { analyseFile, locate, sha256, write } from "./vault-files.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * The Question Kind's *link* write (#211; `docs/architecture.md` § Vault
 * layout: "*link* appends to `related`"). One `setFrontmatter` through the
 * protocol, and only the linking side — the other side's backlink is the
 * Index's (CONTEXT.md *Related*).
 */

/** What a link did: the wikilink as written, and whether the file was touched at all. */
export type Linked = {
  /** The Question, vault-relative. */
  path: string;
  /** The wikilink as it now stands in `related`. */
  target: string;
  /** False when the Question already linked there, and nothing was written. */
  linked: boolean;
};

export async function linkQuestion(
  vaultPath: string,
  index: VaultIndex,
  questionPath: string,
  targetPath: string
): Promise<Linked> {
  const question = await locate(vaultPath, questionPath);
  const target = await locate(vaultPath, targetPath);
  if (question.relativePath === target.relativePath) {
    throw new VaultError(
      "refused",
      `${question.relativePath} cannot be related to itself.`
    );
  }
  // The target must be a file the Index knows, because the link text below
  // is chosen by what the Index says the name reaches: a target it has not
  // seen would get a bare name that may reach something else entirely.
  const known = index.select<{ path: string }>(
    "SELECT path FROM files WHERE path = ?",
    target.relativePath
  );
  if (known.length === 0) {
    throw new VaultError(
      "refused",
      `${target.relativePath} is not a file in the vault.`
    );
  }

  const bytes = await readFile(question.absolute).catch((cause: unknown) => {
    throw new VaultError(
      "unreadable",
      `Couldn't read ${question.relativePath}: ${errorMessage(cause)}`
    );
  });
  const read = analyseFile(
    question.relativePath,
    bytes.toString("utf8"),
    sha256(bytes)
  );
  if (!read.readable) {
    throw new VaultError(
      "unreadable",
      `${question.relativePath}: ${read.reason}`
    );
  }
  const fm = (read.outline.frontmatter?.value ?? {}) as Record<string, unknown>;
  if (read.kind !== "question" || readQuestion(fm) === null) {
    throw new VaultError(
      "refused",
      `${question.relativePath} is not a Question.`
    );
  }

  const related = relatedList(fm["related"], question.relativePath);
  const link = linkText(index, question.relativePath, target.relativePath);
  const already = related.some(
    (entry) =>
      entry === link ||
      resolves(index, question.relativePath, entry) === target.relativePath
  );
  if (already) {
    return { path: question.relativePath, target: link, linked: false };
  }

  const result = await write(vaultPath, question.relativePath, {
    basedOn: read.hash,
    operations: [
      { op: "setFrontmatter", keys: { related: [...related, link] } },
    ],
  });
  if (!result.written) {
    throw new VaultError(
      "refused",
      `Couldn't link ${question.relativePath}: ${result.detail}`
    );
  }
  await index.own(question.relativePath, result.content);
  return { path: question.relativePath, target: link, linked: true };
}

/**
 * `related` as a list of entries to write back. A scalar is the one-item
 * list Obsidian reads it as; anything else — a map, a list holding a number
 * — is refused rather than replaced, because the write below sets the whole
 * key and would otherwise drop what it could not read.
 */
function relatedList(value: unknown, path: string): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value;
  }
  throw new VaultError(
    "refused",
    `${path}: related is not a list of links; fix it in the file first.`
  );
}

/**
 * The shortest wikilink that reaches the chosen file and nothing else: the
 * bare name, as Obsidian and the rest of the app write links, unless the
 * Index says that name is ambiguous or lands elsewhere — then the
 * vault-relative path. Picking a name the user chose a *file* for and
 * letting it resolve to another file would be the silent failure the brief
 * forbids, so the choice is checked against the same resolver the `links`
 * column is computed by.
 */
function linkText(
  index: VaultIndex,
  linkingPath: string,
  targetPath: string
): string {
  const bare = basename(targetPath, ".md");
  if (resolves(index, linkingPath, `[[${bare}]]`) === targetPath) {
    return `[[${bare}]]`;
  }
  return `[[${targetPath.replace(/\.md$/, "")}]]`;
}

/** Where an entry of `related` lands, or null when it is not a resolving wikilink. */
function resolves(
  index: VaultIndex,
  linkingPath: string,
  entry: string
): string | null {
  const inner = /^\[\[(.*)\]\]$/.exec(entry)?.[1];
  if (inner === undefined) return null;
  return index.resolve(linkingPath, parseWikilink(inner)).resolvedPath;
}
