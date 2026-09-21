import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  BOM,
  outline,
  type BlockId,
  type Heading,
  type InlineField,
  type InvalidTag,
  type Link,
  type ListItem,
  type Outline,
  type Range,
  type Tag,
} from "markdown";
import { VaultError } from "./vault.js";

/**
 * The core's reading of one Markdown file: the outline `packages/markdown`
 * produces plus what only the core knows — the file's Kind, which sections
 * are owned, what a `### … ^c<n>` under `## Criteria` is, and where the
 * file falls short of its Kind. Read-only here; the write side is #121.
 *
 * The response shape is fixed by this module so that beat 1b's re-assembly
 * of `vault.outline` from the index (ADR 0014) is invisible to callers.
 */
export type OutlineResponse =
  | {
      readable: true;
      /** Vault-relative, as the index keys it. */
      path: string;
      /** `kind:` verbatim; null when there is no frontmatter or no key. */
      kind: string | null;
      file: FileChoices;
      outline: FileOutline;
      /** The Kind's criteria; empty for every other Kind. */
      criteria: Criterion[];
      shape: ShapeProblem[];
    }
  | { readable: false; path: string; reason: string };

/** What the writer (#121) restores so a file's encoding never changes because the app touched it. */
export type FileChoices = {
  bom: boolean;
  eol: "lf" | "crlf";
  trailingNewline: boolean;
};

/**
 * The package's outline with the `yaml` Document replaced by its plain
 * value: what crosses the RPC boundary. Frontmatter that does not parse
 * never gets this far — the file is unreadable — so there is no unparsed arm.
 */
export type FileOutline = Omit<Outline, "frontmatter"> & {
  frontmatter: { range: Range; content: Range; value: unknown } | null;
};

export type Relationship = "confirming" | "falsifying" | "diagnostic";
export type Outcome = "met" | "not met" | "inconclusive";

/** A `### <text> ^c<n>` under `## Criteria`; a field outside its vocabulary reads as absent. */
export type Criterion = {
  id: string;
  text: string;
  relationship: Relationship | null;
  outcome: Outcome | null;
};

/**
 * An app-owned file missing structure its Kind expects — the row beat 1b's
 * `problems` table stores. `block` is the block the problem sits in where
 * one applies: the `^c<n>` of a criterion field, the heading text of an
 * id-less criterion, the name of a duplicated owned section.
 */
export type ShapeProblem = {
  path: string;
  kind: string;
  problem:
    | "criteriaMissing"
    | "criterionWithoutId"
    | "ownedSectionDuplicated"
    | "fieldOutsideVocabulary";
  block?: string;
};

// Re-exported so the renderer can import the outline's node types from one place.
export type {
  BlockId,
  Heading,
  InlineField,
  InvalidTag,
  Link,
  ListItem,
  Range,
  Tag,
};

const RELATIONSHIPS: readonly Relationship[] = [
  "confirming",
  "falsifying",
  "diagnostic",
];
const OUTCOMES: readonly Outcome[] = ["met", "not met", "inconclusive"];

/** Which `##` sections the app rewrites whole, by Kind (§ Vault layout). */
const OWNED_SECTIONS: Record<string, readonly string[]> = {
  source: ["Annotations"],
  "source-stub": ["Annotations"],
  "research-question": ["Position history"],
  hypothesis: ["Position history"],
  experiment: ["Position history"],
};

const CRITERION_ID = /^c\d+$/;

/**
 * Resolve a caller's path — vault-relative or absolute — to the file on
 * disk, refusing anything the app does not treat as vault content: a path
 * outside the folder, a dot-entry, a symlink that leaves the vault (the
 * walks never follow one, so a single read must not either), or a file that
 * is not Markdown.
 */
async function locate(
  vaultPath: string,
  path: string
): Promise<{ absolute: string; relativePath: string }> {
  const absolute = isAbsolute(path) ? resolve(path) : resolve(vaultPath, path);
  const relativePath = relative(vaultPath, absolute);
  const outside =
    relativePath === "" ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath) ||
    relativePath.split(sep).some((part) => part.startsWith("."));
  if (outside) {
    throw new VaultError("outsideVault", `${path} is not in the vault.`);
  }
  if (!absolute.endsWith(".md")) {
    throw new VaultError("notMarkdown", `${path} is not a Markdown file.`);
  }
  // The walks (`list.ts`) skip every symlink, so a single read refuses one
  // too — the file itself, or any folder on the way to it — rather than
  // reading through a link the walk would never have listed. A missing file
  // is not an input error; the read below reports it.
  try {
    const [realFile, realVault] = await Promise.all([
      realpath(absolute),
      realpath(vaultPath),
    ]);
    const linked =
      relative(realVault, realFile) !== relativePath ||
      (await lstat(absolute)).isSymbolicLink();
    if (linked) {
      throw new VaultError("outsideVault", `${path} is not in the vault.`);
    }
  } catch (error) {
    if (error instanceof VaultError) throw error;
  }
  return { absolute, relativePath: relativePath.split(sep).join("/") };
}

function fileChoices(raw: string): { text: string; file: FileChoices } {
  const bom = raw.startsWith(BOM);
  const text = bom ? raw.slice(BOM.length) : raw;
  return {
    text,
    file: {
      bom,
      // One choice per file: a file with any CRLF is a CRLF file, so the
      // writer never has to guess per line. Obsidian converts a file it
      // edits to LF wholesale (S3), so mixed endings only come from
      // elsewhere and are normalised the same way on the app's first write.
      eol: text.includes("\r\n") ? "crlf" : "lf",
      trailingNewline: text.endsWith("\n"),
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The criteria of a Hypothesis and what is wrong with them. Only a `###`
 * inside `## Criteria` is a criterion, and only a field under a `### … ^c<n>`
 * there is a criterion field (ADR 0006 decision 2): a `key:: value` in prose
 * elsewhere is the user's.
 */
function readCriteria(
  path: string,
  kind: string,
  parsed: Outline
): { criteria: Criterion[]; shape: ShapeProblem[] } {
  const criteria: Criterion[] = [];
  const shape: ShapeProblem[] = [];
  const problem = (problem: ShapeProblem["problem"], block?: string) =>
    shape.push(
      block === undefined
        ? { path, kind, problem }
        : { path, kind, problem, block }
    );
  const section = parsed.headings.find(
    (h) => h.level === 2 && h.text === "Criteria"
  );
  if (!section) {
    problem("criteriaMissing");
    return { criteria, shape };
  }
  const within = (range: Range) =>
    range.start >= section.body.start && range.end <= section.body.end;
  // A field whose value is outside its vocabulary reads as absent, so the
  // derived state is the same inconclusive an unset field gives — and the
  // shape row says why (ADR 0008 decision 12).
  const vocabulary = <T extends string>(
    field: InlineField,
    id: string,
    values: readonly T[]
  ): T | null => {
    if (values.includes(field.value as T)) return field.value as T;
    problem("fieldOutsideVocabulary", id);
    return null;
  };
  for (const heading of parsed.headings) {
    if (heading.level !== 3 || !within(heading.range)) continue;
    const id = heading.blockId;
    if (id === null || !CRITERION_ID.test(id)) {
      problem("criterionWithoutId", heading.text);
      continue;
    }
    const criterion: Criterion = {
      id,
      text: heading.text,
      relationship: null,
      outcome: null,
    };
    for (const field of parsed.inlineFields) {
      if (field.under !== id || !within(field.range)) continue;
      if (field.key === "relationship") {
        criterion.relationship = vocabulary(field, id, RELATIONSHIPS);
      } else if (field.key === "outcome") {
        criterion.outcome = vocabulary(field, id, OUTCOMES);
      }
    }
    criteria.push(criterion);
  }
  return { criteria, shape };
}

/** A duplicated owned section: the first is the app's, the second untouched, the duplicate reported (ADR 0008 decision 10). */
function duplicatedOwnedSections(
  path: string,
  kind: string,
  parsed: Outline
): ShapeProblem[] {
  const shape: ShapeProblem[] = [];
  for (const name of OWNED_SECTIONS[kind] ?? []) {
    const count = parsed.headings.filter(
      (h) => h.level === 2 && h.text === name
    ).length;
    if (count > 1) {
      shape.push({
        path,
        kind,
        problem: "ownedSectionDuplicated",
        block: name,
      });
    }
  }
  return shape;
}

/**
 * One file's outline, or `unreadable` with the reason. Never writes. A
 * refused path is a VaultError (`outsideVault`, `notMarkdown`) rather than
 * an unreadable file: the caller asked for something the vault does not hold.
 */
export async function readOutline(
  vaultPath: string,
  path: string
): Promise<OutlineResponse> {
  const { absolute, relativePath } = await locate(vaultPath, path);
  let raw: string;
  try {
    raw = await readFile(absolute, "utf8");
  } catch (error) {
    return { readable: false, path: relativePath, reason: errorMessage(error) };
  }
  // The BOM is stripped here and remembered in `file`, so every offset in
  // the outline is into the text the writer will splice.
  const { text, file } = fileChoices(raw);
  const parsed = outline(text);
  const unreadable = (reason: string): OutlineResponse => ({
    readable: false,
    path: relativePath,
    reason,
  });

  let frontmatter: FileOutline["frontmatter"] = null;
  let kind: string | null = null;
  if (parsed.frontmatter) {
    if (!parsed.frontmatter.parsed) {
      return unreadable(
        `frontmatter does not parse: ${parsed.frontmatter.reason}`
      );
    }
    // An empty block (`---\n---`) is a map with no keys, not no frontmatter:
    // the fence is there, and the writer may set keys into it.
    const value: unknown = parsed.frontmatter.document.toJS() ?? {};
    if (typeof value !== "object" || Array.isArray(value)) {
      return unreadable("frontmatter is not a map of keys");
    }
    // A `kind:` that is not a string is a wrong value, not a missing key
    // (ADR 0009 decision 5): reported, never quietly read as no Kind.
    const declared = (value as Record<string, unknown>)["kind"];
    if (declared !== undefined && typeof declared !== "string") {
      return unreadable(`kind is not a string: ${JSON.stringify(declared)}`);
    }
    kind = declared ?? null;
    frontmatter = {
      range: parsed.frontmatter.range,
      content: parsed.frontmatter.content,
      value,
    };
  }

  const shape: ShapeProblem[] = [];
  let criteria: Criterion[] = [];
  if (kind !== null) {
    if (kind === "hypothesis") {
      const read = readCriteria(relativePath, kind, parsed);
      criteria = read.criteria;
      shape.push(...read.shape);
    }
    shape.push(...duplicatedOwnedSections(relativePath, kind, parsed));
  }

  return {
    readable: true,
    path: relativePath,
    kind,
    file,
    outline: { ...parsed, frontmatter },
    criteria,
    shape,
  };
}
