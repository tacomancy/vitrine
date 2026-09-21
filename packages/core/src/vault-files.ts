import { readFile, realpath } from "node:fs/promises";
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

/** The package's outline with the `yaml` Document replaced by its plain value: what crosses the RPC boundary. */
export type FileOutline = Omit<Outline, "frontmatter"> & {
  frontmatter:
    | { parsed: true; range: Range; content: Range; value: unknown }
    | { parsed: false; range: Range; content: Range; reason: string }
    | null;
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
  try {
    const [realFile, realVault] = await Promise.all([
      realpath(absolute),
      realpath(vaultPath),
    ]);
    const realRelative = relative(realVault, realFile);
    if (realRelative.startsWith("..") || isAbsolute(realRelative)) {
      throw new VaultError("outsideVault", `${path} is not in the vault.`);
    }
  } catch (error) {
    if (error instanceof VaultError) throw error;
    // A missing file is unreadable, reported by the read below; not an
    // input error.
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
  o: Outline
): { criteria: Criterion[]; shape: ShapeProblem[] } {
  const criteria: Criterion[] = [];
  const shape: ShapeProblem[] = [];
  const section = o.headings.find(
    (h) => h.level === 2 && h.text === "Criteria"
  );
  if (!section) {
    shape.push({ path, kind, problem: "criteriaMissing" });
    return { criteria, shape };
  }
  const within = (range: Range) =>
    range.start >= section.body.start && range.end <= section.body.end;
  for (const heading of o.headings) {
    if (heading.level !== 3 || !within(heading.range)) continue;
    const id = heading.blockId;
    if (id === null || !CRITERION_ID.test(id)) {
      shape.push({
        path,
        kind,
        problem: "criterionWithoutId",
        block: heading.text,
      });
      continue;
    }
    const criterion: Criterion = {
      id,
      text: heading.text,
      relationship: null,
      outcome: null,
    };
    const fields = o.inlineFields.filter(
      (f) => f.under === id && within(f.range)
    );
    for (const field of fields) {
      if (field.key === "relationship") {
        if (RELATIONSHIPS.includes(field.value as Relationship)) {
          criterion.relationship = field.value as Relationship;
        } else {
          shape.push({
            path,
            kind,
            problem: "fieldOutsideVocabulary",
            block: id,
          });
        }
      } else if (field.key === "outcome") {
        if (OUTCOMES.includes(field.value as Outcome)) {
          criterion.outcome = field.value as Outcome;
        } else {
          shape.push({
            path,
            kind,
            problem: "fieldOutsideVocabulary",
            block: id,
          });
        }
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
  o: Outline
): ShapeProblem[] {
  const shape: ShapeProblem[] = [];
  for (const name of OWNED_SECTIONS[kind] ?? []) {
    const count = o.headings.filter(
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
  const o = outline(text);

  let frontmatter: FileOutline["frontmatter"] = null;
  let kind: string | null = null;
  if (o.frontmatter) {
    if (!o.frontmatter.parsed) {
      return {
        readable: false,
        path: relativePath,
        reason: `frontmatter does not parse: ${o.frontmatter.reason}`,
      };
    }
    const value: unknown = o.frontmatter.document.toJS();
    if (value !== null && value !== undefined) {
      if (typeof value !== "object" || Array.isArray(value)) {
        return {
          readable: false,
          path: relativePath,
          reason: "frontmatter is not a map of keys",
        };
      }
      const k = (value as Record<string, unknown>)["kind"];
      kind = typeof k === "string" ? k : null;
    }
    frontmatter = {
      parsed: true,
      range: o.frontmatter.range,
      content: o.frontmatter.content,
      value: value ?? {},
    };
  }

  const shape: ShapeProblem[] = [];
  let criteria: Criterion[] = [];
  if (kind !== null) {
    if (kind === "hypothesis") {
      const read = readCriteria(relativePath, kind, o);
      criteria = read.criteria;
      shape.push(...read.shape);
    }
    shape.push(...duplicatedOwnedSections(relativePath, kind, o));
  }

  return {
    readable: true,
    path: relativePath,
    kind,
    file,
    outline: { ...o, frontmatter },
    criteria,
    shape,
  };
}
