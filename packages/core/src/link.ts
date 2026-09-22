import { basename } from "node:path";
import { parseWikilink } from "markdown";
import { VaultError } from "./errors.js";
import { readQuestionForWrite, type QuestionStatus } from "./question-kind.js";
import { locate, write } from "./vault-files.js";
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

/**
 * Every Status: linking is not a state change, so there is no Status it
 * does not apply to — where promote wants an open Question and reopen a
 * triaged one (§ Research Question view and triage).
 */
const ANY_STATUS: readonly QuestionStatus[] = [
  "open",
  "promoted",
  "answered",
  "abandoned",
];

// Links run one at a time, as the page's writes do (`research-question.ts`).
// A link reads `related` and writes the whole list back, so two that both
// read before either wrote would each plan against a `related` that no
// longer exists by the time the second lands, and the first link would be
// gone. The protocol's hash check cannot catch it: re-apply faithfully
// applies operations that were correct when they were computed. The queue
// lives here rather than in the caller so that reading and writing cannot
// be pulled apart by a caller that forgets to hold it — answer, drop and
// reopen need none, because each only sets keys or appends a line.
let previous: Promise<unknown> = Promise.resolve();

export function linkQuestion(
  vaultPath: string,
  index: VaultIndex,
  questionPath: string,
  targetPath: string
): Promise<Linked> {
  const run = () => link(vaultPath, index, questionPath, targetPath);
  // A link that threw leaves the queue usable for the next one.
  const queued = previous.then(run, run);
  previous = queued;
  return queued;
}

/** One link, whole: the read it plans from and the write it plans, inside the queue above. */
async function link(
  vaultPath: string,
  index: VaultIndex,
  questionPath: string,
  targetPath: string
): Promise<Linked> {
  // The same read, and the same refusals, as every other triage action
  // (#212): a file that is not readable or is not a Question says so in
  // one voice, whichever key the user pressed.
  const found = await readQuestionForWrite(vaultPath, questionPath, ANY_STATUS);
  const target = await locate(vaultPath, targetPath);
  if (found.path === target.relativePath) {
    throw new VaultError(
      "refused",
      `${found.path} cannot be related to itself.`
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

  const related = relatedList(found.frontmatter["related"], found.path);
  const wikilink = linkText(index, found.path, target.relativePath);
  const already = related.some(
    (entry) =>
      entry === wikilink ||
      resolves(index, found.path, entry) === target.relativePath
  );
  if (already) return { path: found.path, target: wikilink, linked: false };

  const result = await write(vaultPath, found.path, {
    basedOn: found.hash,
    operations: [
      { op: "setFrontmatter", keys: { related: [...related, wikilink] } },
    ],
  });
  if (!result.written) {
    throw new VaultError(
      "refused",
      `Couldn't link ${found.path}: ${result.detail}`
    );
  }
  await index.own(found.path, result.content);
  return { path: found.path, target: wikilink, linked: true };
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
