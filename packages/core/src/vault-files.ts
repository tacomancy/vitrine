import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { isMap, isScalar, isSeq, YAMLSeq, type Document } from "yaml";
import {
  BOM,
  canonicalTag,
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
import { writeAtomically } from "./atomic-write.js";
import { errorMessage, VaultError } from "./errors.js";

/**
 * The core's reading of one Markdown file: the outline `packages/markdown`
 * produces plus what only the core knows — the file's Kind, which sections
 * are owned, what a `### … ^c<n>` under `## Criteria` is, and where the
 * file falls short of its Kind. The write side is below: one protocol
 * (`write`) for the splicing operations, and the two whole-file writes.
 *
 * The response shape is fixed by this module so that beat 1b's re-assembly
 * of `vault.outline` from the index (ADR 0014) is invisible to callers.
 */
export type OutlineResponse<L extends Link = Link> =
  | {
      readable: true;
      /** Vault-relative, as the index keys it. */
      path: string;
      /** `kind:` verbatim; null when there is no frontmatter or no key. */
      kind: string | null;
      /** SHA-256 of the bytes on disk, hex: what a write is `basedOn`. */
      hash: string;
      file: FileChoices;
      outline: FileOutline<L>;
      /** The Kind's criteria; empty for every other Kind. */
      criteria: Criterion[];
      shape: ShapeProblem[];
    }
  | { readable: false; path: string; reason: string };

/**
 * Where a link lands across the vault (§ Markdown, link grammar): one file
 * by path or basename → `resolved`; several by basename → `ambiguous`,
 * which resolves to nothing rather than picking one; none, or a `#Heading`
 * or `#^id` the file lacks → `unresolved`. `resolvedPath` is filled only
 * when `resolved`. The index computes it; a single file's outline cannot.
 */
export type Resolution = "resolved" | "ambiguous" | "unresolved";
export type ResolvedLink = Link & {
  resolution: Resolution;
  resolvedPath: string | null;
};

/** What the writer restores so a file's encoding never changes because the app touched it. */
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
export type FileOutline<L extends Link = Link> = Omit<
  Outline,
  "frontmatter" | "links"
> & {
  frontmatter: { range: Range; content: Range; value: unknown } | null;
  links: L[];
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
 * id-less criterion, the name of a duplicated owned section. The last two
 * are a page's own (`research-question.ts`): a section a surface draws that
 * the file lacks — its heading retyped — or carries twice; the index never
 * stores them, since a missing section is not a fault of the file's Kind
 * (ADR 0008 decision 10), only something the page must say it could not show.
 */
export type ShapeProblem = {
  path: string;
  kind: string;
  problem:
    | "criteriaMissing"
    | "criterionWithoutId"
    | "ownedSectionDuplicated"
    | "fieldOutsideVocabulary"
    | "sectionMissing"
    | "sectionDuplicated";
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
export async function locate(
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
  // The index's walk skips every symlink, so a single read or write
  // refuses one too — the file itself, or any folder on the way to it —
  // rather than going through a link the walk would never have listed. A
  // missing file is not an input error (the read reports it; createFile
  // makes it), but its nearest existing ancestor is still checked, or a
  // new file could land outside the vault through a linked folder.
  try {
    const realVault = await realpath(vaultPath);
    let probe = absolute;
    let real: string | null = null;
    while (real === null && probe !== vaultPath) {
      try {
        real = await realpath(probe);
      } catch {
        probe = dirname(probe);
      }
    }
    const linked =
      real !== null &&
      (relative(realVault, real) !== relative(vaultPath, probe) ||
        (await lstat(probe)).isSymbolicLink());
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

/**
 * The criteria of a Hypothesis and what is wrong with them. Only a `###`
 * inside `## Criteria` is a criterion, and only a field under a `### … ^c<n>`
 * there is a criterion field (ADR 0006 decision 2): a `key:: value` in prose
 * elsewhere is the user's.
 */
function readCriteria(
  path: string,
  kind: string,
  parsed: Pick<Outline, "headings" | "inlineFields">
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
  parsed: Pick<Outline, "headings">
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

/** SHA-256 hex of a file's bytes: the hash every read, write, and index row carries. */
export const sha256 = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");

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
  let bytes: Buffer;
  try {
    bytes = await readFile(absolute);
  } catch (error) {
    return { readable: false, path: relativePath, reason: errorMessage(error) };
  }
  return analyseFile(relativePath, bytes.toString("utf8"), sha256(bytes));
}

/**
 * The core's reading of one file's text: what `readOutline`, the write's
 * verify step, and the index (which holds the content it just read or wrote)
 * share. `hash` is carried through unexamined.
 */
export function analyseFile(
  relativePath: string,
  raw: string,
  hash: string
): OutlineResponse {
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

  return {
    readable: true,
    path: relativePath,
    kind,
    hash,
    file,
    outline: { ...parsed, frontmatter },
    ...deriveKind(relativePath, kind, parsed),
  };
}

/**
 * What the core adds to an outline for its Kind — the criteria and the
 * shape problems. Applied here to a fresh outline and by `vault-outline.ts`
 * to one re-assembled from the index, so the two can never disagree.
 */
export function deriveKind(
  path: string,
  kind: string | null,
  parsed: Pick<Outline, "headings" | "inlineFields">
): { criteria: Criterion[]; shape: ShapeProblem[] } {
  const shape: ShapeProblem[] = [];
  let criteria: Criterion[] = [];
  if (kind !== null) {
    if (kind === "hypothesis") {
      const read = readCriteria(path, kind, parsed);
      criteria = read.criteria;
      shape.push(...read.shape);
    }
    shape.push(...duplicatedOwnedSections(path, kind, parsed));
  }
  return { criteria, shape };
}

/**
 * The next id in one of the app's counters — `h` for Annotations, `c` for
 * criteria — for a file: one above the highest `^<prefix><digits>` already
 * there, `<prefix>1` when there is none. The user may have written into
 * the namespace by hand; starting above it is what makes collision a
 * non-event rather than a reason for an uglier prefix (ADR 0008 decision
 * 11). Never reused: the caller records what it hands out.
 */
export function nextBlockId(
  outline: Pick<Outline, "blockIds">,
  prefix: string
): string {
  const numbered = new RegExp(`^${prefix}(\\d+)$`);
  let highest = 0;
  for (const { id } of outline.blockIds) {
    const match = numbered.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `${prefix}${highest + 1}`;
}

// ---------------------------------------------------------------------------
// The write side (ADR 0008 decisions 2–3; `docs/architecture.md` § Markdown).

/**
 * Set one or more frontmatter keys, and/or add tags. Keys keep the user's
 * order, comments, blank lines, and quoting of untouched scalars; new keys
 * are appended; nothing is ever removed. A tag is written exactly as
 * supplied — display casing is the tag tree's call (beat 1b) — into `tags:`
 * as a block sequence, a legacy comma-string `tags:` converted, unsplit, on
 * that first tag write (F2a).
 */
export type SetFrontmatter = {
  op: "setFrontmatter";
  keys?: Record<string, unknown>;
  addTags?: string[];
};

/**
 * Rewrite an owned section whole — `## Annotations`, `## Position history`
 * for the pressure valve. The heading line stays; the body between it and
 * the next heading of level ≤ 2 is replaced by `body`, set off by one blank
 * line on each side (the app's convention inside a section it owns).
 */
export type ReplaceSection = {
  op: "replaceSection";
  /** The `##` text, exact and case-sensitive. */
  name: string;
  body: string;
};

/**
 * A Revision into `## Position history`, newest first (ADR 0006 decision 5):
 * the entry goes directly under the heading line, after the blank line the
 * file keeps there if it keeps one, and whatever was first becomes second.
 */
export type PrependEntry = {
  op: "prependEntry";
  /** The `##` text, exact and case-sensitive. */
  section: string;
  entry: string;
};

/**
 * A line at the end of a `##` section (an Artifact line, a source line), of
 * a `###` block (an Evidence line under `^c<n>`), or of the *lead* — the
 * body before the first `##`, where the write-back line from a resolved
 * Hypothesis goes so that it never lands inside `## Position history`
 * (ADR 0008 decision 2). The line joins a list it follows and otherwise
 * starts its own block, so it can neither continue the user's paragraph
 * nor unseat a block id at the end of one.
 */
export type AppendToSection = {
  op: "appendToSection";
  target: "lead" | { section: string } | { block: string };
  line: string;
};

/**
 * `outcome::` or `relationship::` under the criterion carrying `^c<n>` —
 * a `###` inside `## Criteria`, the only place the app reads a `key::
 * value` (ADR 0006 decision 2). Replaces the value range only; a criterion
 * without the field gets the line, under its other field or the heading.
 */
export type SetInlineField = {
  op: "setInlineField";
  /** Without the `^`: `c3`. */
  blockId: string;
} & (
  | { field: "outcome"; value: Outcome }
  | { field: "relationship"; value: Relationship }
);

/** The splicing operations — the set is closed by ADR 0008 decision 2. */
export type Operation =
  | SetFrontmatter
  | ReplaceSection
  | PrependEntry
  | AppendToSection
  | SetInlineField;

/** One hash-checked application of operations to a file. */
export type Write = {
  operations: Operation[];
  /** The `hash` of the outline the operations were computed from. */
  basedOn: string;
};

export type WriteRefusal =
  | "changedAndUnreapplyable"
  | "verificationFailed"
  | "changedOnDisk"
  | "noFrontmatter"
  | "notACriterion"
  | "blockNotFound"
  | "unreadable"
  | "alreadyExists";

/**
 * `content` and `hash` are what beat 1b's index consumes to record an own
 * write synchronously (ADR 0014, update 2026-09-20). `shape` is the file's
 * shape problems as written — how a duplicated owned section the write
 * worked around is reported (ADR 0008 decision 10). On a refusal nothing
 * touched the disk.
 */
export type WriteResult =
  | { written: true; hash: string; content: string; shape: ShapeProblem[] }
  | { written: false; reason: WriteRefusal; detail: string };

/** Text as the app composes it: no BOM, LF. */
const asLf = (text: string) =>
  text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
/** LF text in the line endings the file as read had. */
const withEol = (lf: string, eol: FileChoices["eol"]) =>
  eol === "crlf" ? lf.replace(/\n/g, "\r\n") : lf;

const refusal = (reason: WriteRefusal, detail: string): WriteResult => ({
  written: false,
  reason,
  detail,
});

type Splice = { range: Range; text: string };
type Applied =
  | { ok: true; splices: Splice[] }
  | { ok: false; reason: WriteRefusal; detail: string };

/**
 * Add tags to a `tags:` node, whatever form the file has: absent or empty →
 * a new block sequence; a sequence → appended to, and written as a block
 * sequence; the legacy comma-string → one unsplit entry, as the Properties
 * panel converts it (F2a). A tag the file already carries under any casing
 * is not added again, so the writer never introduces a variant of a tag the
 * user already has (ADR 0008, considered options).
 */
function addTags(
  document: Document,
  present: Set<string>,
  tags: string[]
): void {
  const existing = document.get("tags", true);
  let seq: YAMLSeq;
  if (isSeq(existing)) {
    seq = existing;
  } else {
    seq = new YAMLSeq();
    if (isScalar(existing) && existing.value !== null) {
      seq.items.push(document.createNode(existing.value));
    }
    document.set("tags", seq);
  }
  seq.flow = false;
  for (const tag of tags) {
    if (present.has(canonicalTag(tag))) continue;
    present.add(canonicalTag(tag));
    seq.items.push(document.createNode(tag));
  }
}

/**
 * Turn the frontmatter operations into one splice against `text` (BOM-less),
 * located afresh — which is what makes re-applying to a changed file
 * possible. Every setFrontmatter in one write edits the same Document, so
 * the frontmatter is one splice.
 */
function applyFrontmatter(
  text: string,
  operations: Operation[],
  eol: FileChoices["eol"]
): Applied {
  const splices: Splice[] = [];
  const frontmatterOps = operations.filter((o) => o.op === "setFrontmatter");
  if (frontmatterOps.length > 0) {
    const parsed = outline(text);
    if (parsed.frontmatter === null) {
      return {
        ok: false,
        reason: "noFrontmatter",
        detail: "the file has no frontmatter; only createFile makes it",
      };
    }
    if (!parsed.frontmatter.parsed) {
      return {
        ok: false,
        reason: "unreadable",
        detail: `frontmatter does not parse: ${parsed.frontmatter.reason}`,
      };
    }
    const { document } = parsed.frontmatter;
    if (document.contents !== null && !isMap(document.contents)) {
      return {
        ok: false,
        reason: "unreadable",
        detail: "frontmatter is not a map of keys",
      };
    }
    // The tags the file carries, by canonical form, kept across every
    // operation in the write so two of them adding one tag add it once.
    const present = new Set<string>();
    for (const t of parsed.tags) {
      if (t.source === "frontmatter" && t.valid) present.add(t.canonical);
    }
    for (const op of frontmatterOps) {
      for (const [key, value] of Object.entries(op.keys ?? {})) {
        document.set(key, value);
      }
      if (op.addTags) addTags(document, present, op.addTags);
    }
    if (document.contents !== null) {
      // lineWidth 0: an untouched long scalar is never folded across lines.
      splices.push({
        range: parsed.frontmatter.content,
        text: withEol(document.toString({ lineWidth: 0 }), eol),
      });
    }
  }
  return { ok: true, splices };
}

/** Splice from the highest offset down, so no earlier splice moves a later target. */
function splice(text: string, splices: Splice[]): string {
  let out = text;
  for (const s of [...splices].sort((a, b) => b.range.start - a.range.start)) {
    out = out.slice(0, s.range.start) + s.text + out.slice(s.range.end);
  }
  return out;
}

const EOL_OF: Record<FileChoices["eol"], string> = { lf: "\n", crlf: "\r\n" };

/** The first `##` heading with this exact text — the owned one when there are two (ADR 0008 decision 10). */
function ownedSection(parsed: Outline, name: string): Heading | undefined {
  return parsed.headings.find((h) => h.level === 2 && h.text === name);
}

/**
 * One section operation as a splice against `text`, located afresh. Section
 * operations are applied one at a time, each against a fresh outline, so
 * that two of them aimed at the same spot — two entries prepended in one
 * write — land in operation order instead of at one shared offset.
 */
function locateSectionOp(
  text: string,
  op: Exclude<Operation, SetFrontmatter>,
  eol: string
): Splice | { reason: WriteRefusal; detail: string } {
  const parsed = outline(text);
  switch (op.op) {
    case "replaceSection": {
      const heading = ownedSection(parsed, op.name);
      if (!heading) return appendSection(text, op.name, op.body, eol);
      const next = parsed.headings.find(
        (h) => h.range.start === heading.body.end
      );
      const body = composedBody(op.body, eol);
      // A blank line after the heading, the body, a blank line before the
      // next heading; at the end of the file the trailing-newline choice
      // is restored afterwards (`restoreTrailingNewline`).
      const replacement =
        body === "" ? (next ? eol : "") : eol + body + (next ? eol : "");
      return { range: heading.body, text: replacement };
    }
    case "prependEntry": {
      const heading = ownedSection(parsed, op.section);
      if (!heading) return appendSection(text, op.section, op.entry, eol);
      const { body } = heading;
      if (!/\S/.test(text.slice(body.start, body.end))) {
        return intoEmptySection(
          text,
          heading,
          composedLines(op.entry, eol),
          eol
        );
      }
      const at = text.startsWith(eol, body.start)
        ? body.start + eol.length
        : body.start;
      // The entry joins the list it lands on; ahead of prose it closes
      // with a blank line, or the prose would be a lazy continuation of
      // the entry's last paragraph and read as part of it.
      const lineEnd = text.indexOf(eol, at);
      const nextLine = text.slice(at, lineEnd === -1 ? text.length : lineEnd);
      const beforeProse = /\S/.test(nextLine) && !LIST_LINE.test(nextLine);
      return {
        range: { start: at, end: at },
        text: composedBody(op.entry, eol) + (beforeProse ? eol : ""),
      };
    }
    case "appendToSection": {
      const line = composedLines(op.line, eol);
      const { target } = op;
      if (target === "lead") {
        const first = parsed.headings.find((h) => h.level === 2);
        const start = parsed.frontmatter
          ? afterLineEnding(text, parsed.frontmatter.range.end)
          : 0;
        const end = first ? first.range.start : text.length;
        const last = endOfLastNonBlankLine(text, start, end);
        if (last !== null) return appendLine(text, parsed, last, line, eol);
        if (first) {
          return {
            range: { start: first.range.start, end: first.range.start },
            text: line + eol + eol,
          };
        }
        const atLineStart = start === 0 || text.endsWith(eol, start);
        return {
          range: { start, end: start },
          text: (atLineStart ? "" : eol) + line + eol,
        };
      }
      let heading: Heading | undefined;
      if ("section" in target) {
        heading = ownedSection(parsed, target.section);
        if (!heading) return appendSection(text, target.section, line, eol);
      } else {
        heading = parsed.headings.find(
          (h) => h.level === 3 && h.blockId === target.block
        );
        if (!heading) {
          return {
            reason: "blockNotFound",
            detail: `no ### block carries ^${target.block}`,
          };
        }
      }
      const last = endOfLastNonBlankLine(
        text,
        heading.body.start,
        heading.body.end
      );
      if (last === null) return intoEmptySection(text, heading, line, eol);
      return appendLine(text, parsed, last, line, eol);
    }
    case "setInlineField": {
      const heading = criterionHeading(parsed, op.blockId);
      if (!heading) {
        return {
          reason: "notACriterion",
          detail: `^${op.blockId} is not a ### … ^c<n> inside ## Criteria`,
        };
      }
      const fields = parsed.inlineFields.filter(
        (f) =>
          f.under === op.blockId &&
          f.range.start >= heading.body.start &&
          f.range.end <= heading.body.end
      );
      const field = fields.find((f) => f.key === op.field);
      if (field) return { range: field.valueRange, text: op.value };
      const line = `${op.field}:: ${op.value}`;
      const at =
        fields.length > 0
          ? Math.max(...fields.map((f) => f.range.end))
          : heading.range.end;
      return { range: { start: at, end: at }, text: eol + line };
    }
  }
}

/** The `### … ^c<n>` inside `## Criteria` carrying this id — a criterion by ADR 0006 decision 2 — or undefined. */
function criterionHeading(parsed: Outline, id: string): Heading | undefined {
  if (!CRITERION_ID.test(id)) return undefined;
  const criteria = ownedSection(parsed, "Criteria");
  if (!criteria) return undefined;
  return parsed.headings.find(
    (h) =>
      h.level === 3 &&
      h.blockId === id &&
      h.range.start >= criteria.body.start &&
      h.range.end <= criteria.body.end
  );
}

/** The end of the last line in [from, to) holding a non-whitespace character, or null when there is none. */
function endOfLastNonBlankLine(
  text: string,
  from: number,
  to: number
): number | null {
  let at = to - 1;
  while (at >= from && /\s/.test(text[at]!)) at -= 1;
  if (at < from) return null;
  const lineEnd = text.indexOf("\n", at);
  if (lineEnd === -1 || lineEnd >= to) return to;
  return text[lineEnd - 1] === "\r" ? lineEnd - 1 : lineEnd;
}

/**
 * Content into a section with nothing in it: the app's blank line after the
 * heading, the content, and — when the section runs straight into the next
 * heading — the blank line before that too. Blank lines the section
 * already had stay where they are.
 */
function intoEmptySection(
  text: string,
  heading: Heading,
  content: string,
  eol: string
): Splice {
  const { body } = heading;
  const next = body.end < text.length;
  // The heading's own line ending plus the body's blank lines: one more is
  // needed before the next heading only when the body had none.
  const breaks = text.slice(body.start, body.end).split(eol).length - 1;
  const after = next && breaks === 0 ? eol : "";
  return {
    range: { start: heading.range.end, end: heading.range.end },
    text: eol + eol + content + after,
  };
}

const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s/;

/**
 * A line after the line ending at `at`: directly below it when both are list
 * items, so Evidence and source lines read as one list beside the user's;
 * otherwise after a blank line, so the line neither continues the user's
 * paragraph nor unseats a `^id` at the end of it.
 */
function appendLine(
  text: string,
  parsed: Outline,
  at: number,
  line: string,
  eol: string
): Splice {
  const inList = parsed.listItems.some(
    (item) => item.range.start < at && at <= item.range.end
  );
  const joins = inList && LIST_LINE.test(line);
  return {
    range: { start: at, end: at },
    text: (joins ? eol : eol + eol) + line,
  };
}

function afterLineEnding(text: string, offset: number): number {
  if (text.startsWith("\r\n", offset)) return offset + 2;
  if (text[offset] === "\n" || text[offset] === "\r") return offset + 1;
  return offset;
}

/**
 * A section the app needs but the file lacks — or has under a heading the
 * user renamed, which is the same thing — goes at the end of the file after
 * one blank line, never at a canonical position, because appending is the
 * one placement that cannot be wrong about an order the user chose
 * (ADR 0008 decision 10).
 */
function appendSection(
  text: string,
  name: string,
  body: string,
  eol: string
): Splice {
  let end = text.length;
  let trailing = 0;
  while (text.endsWith(eol, end)) {
    end -= eol.length;
    trailing += 1;
  }
  const separator = text === "" ? "" : eol.repeat(Math.max(0, 2 - trailing));
  return {
    range: { start: text.length, end: text.length },
    text: separator + `## ${name}` + eol + eol + composedBody(body, eol),
  };
}

/** Text as the app composes it (LF, however it ends) in the file's line endings, without a trailing one. */
function composedLines(text: string, eol: string): string {
  return asLf(text).replace(/\n+$/, "").replace(/\n/g, eol);
}

/** `composedLines`, ending in exactly one line ending — or empty when blank. */
function composedBody(body: string, eol: string): string {
  const text = composedLines(body, eol);
  return text === "" ? "" : text + eol;
}

/** The file's trailing-newline choice, whatever the last splice did at the end of the file. */
function restoreTrailingNewline(text: string, file: FileChoices): string {
  const eol = EOL_OF[file.eol];
  if (file.trailingNewline) {
    return text === "" || text.endsWith(eol) ? text : text + eol;
  }
  return text.endsWith(eol) ? text.slice(0, -eol.length) : text;
}

/** All operations applied to `text`, or the first refusal. */
function apply(
  text: string,
  operations: Operation[],
  file: FileChoices
):
  | { ok: true; content: string }
  | { ok: false; reason: WriteRefusal; detail: string } {
  const frontmatter = applyFrontmatter(text, operations, file.eol);
  if (!frontmatter.ok) return frontmatter;
  let out = splice(text, frontmatter.splices);
  const eol = EOL_OF[file.eol];
  for (const op of operations) {
    if (op.op === "setFrontmatter") continue;
    const located = locateSectionOp(out, op, eol);
    if ("reason" in located) return { ok: false, ...located };
    out = splice(out, [located]);
  }
  return { ok: true, content: restoreTrailingNewline(out, file) };
}

/**
 * What a splice must not have done, checked by re-parsing the result before
 * it reaches disk (ADR 0008 decision 3): the frontmatter still parses,
 * `kind` is unchanged, every `##` section an operation targeted is there
 * exactly once (or as many times as before, when the file already had a
 * duplicate — that is reported on the read, not refused here, ADR 0008
 * decision 10), every block id an operation depends on is still there, and
 * the file has no shape problem it did not have before. This is the guard
 * against a fence or heading eaten by an off-by-one, silently.
 */
function verify(
  before: OutlineResponse,
  after: OutlineResponse,
  operations: Operation[]
): string | null {
  if (!before.readable) return `the file is unreadable: ${before.reason}`;
  if (!after.readable) return `the result is unreadable: ${after.reason}`;
  if (after.kind !== before.kind) {
    return `kind would change from ${JSON.stringify(before.kind)} to ${JSON.stringify(after.kind)}`;
  }
  const sectionCount = (r: typeof after, name: string) =>
    r.outline.headings.filter((h) => h.level === 2 && h.text === name).length;
  const targets = operations.map(targetOf);
  const sections = targets.flatMap((t) => (t.section ? [t.section] : []));
  const blockIds = targets.flatMap((t) => (t.block ? [t.block] : []));
  for (const name of new Set(sections)) {
    const expected = Math.max(1, sectionCount(before, name));
    const found = sectionCount(after, name);
    if (found !== expected) {
      return `## ${name}: expected ${expected} heading(s) after the write, found ${found}`;
    }
  }
  for (const id of new Set(blockIds)) {
    if (!after.outline.blockIds.some((b) => b.id === id)) {
      return `block id ^${id} would be lost`;
    }
  }
  const key = (p: ShapeProblem) => `${p.problem}:${p.block ?? ""}`;
  const already = new Set(before.shape.map(key));
  const fresh = after.shape.find((p) => !already.has(key(p)));
  if (fresh !== undefined) {
    return `shape problem introduced: ${fresh.problem}${fresh.block === undefined ? "" : ` (${fresh.block})`}`;
  }
  return null;
}

/** The `##` section and the block id an operation's outcome depends on, for verification. */
function targetOf(op: Operation): { section?: string; block?: string } {
  switch (op.op) {
    case "setFrontmatter":
      return {};
    case "replaceSection":
      return { section: op.name };
    case "prependEntry":
      return { section: op.section };
    case "appendToSection":
      return op.target === "lead" ? {} : op.target;
    case "setInlineField":
      return { section: "Criteria", block: op.blockId };
  }
}

async function commit(
  absolute: string,
  relativePath: string,
  content: string
): Promise<WriteResult> {
  // What the write did to the file's shape is reported whichever path
  // wrote it — `replaceFile` included, which is never refused on shape
  // (ADR 0015 decision 4) but still says what the save left behind.
  const after = analyseFile(relativePath, content, "");
  const shape = after.readable ? after.shape : [];
  try {
    await writeAtomically(absolute, content);
  } catch (cause) {
    throw new VaultError(
      "writeFailed",
      `Couldn't write ${relativePath}: ${errorMessage(cause)}`
    );
  }
  return {
    written: true,
    hash: sha256(Buffer.from(content, "utf8")),
    content,
    shape,
  };
}

/** The current bytes of a file the caller has read before, or null when it is gone. */
async function current(absolute: string): Promise<Buffer | null> {
  try {
    return await readFile(absolute);
  } catch {
    return null;
  }
}

/**
 * The write protocol for the splicing operations: re-hash; if the file
 * changed since the read, re-apply the operations to what is there now —
 * they locate their targets afresh, which a string patch could not; splice
 * (the frontmatter as one splice, then each section operation against a
 * fresh outline); re-parse and verify; then temp file + rename. A write
 * that cannot be re-applied or fails verification is refused with the
 * reason and nothing touches the disk. Line endings, a BOM, and the
 * trailing-newline choice are restored from the file as read.
 */
export async function write(
  vaultPath: string,
  path: string,
  { operations, basedOn }: Write
): Promise<WriteResult> {
  const { absolute, relativePath } = await locate(vaultPath, path);
  const bytes = await current(absolute);
  if (bytes === null) {
    return refusal("changedAndUnreapplyable", "the file is no longer there");
  }
  const hash = sha256(bytes);
  const changed = hash !== basedOn;
  const raw = bytes.toString("utf8");
  const { text, file } = fileChoices(raw);

  const applied = apply(text, operations, file);
  if (!applied.ok) {
    // A file that moved underneath and can no longer take the operation is
    // one refusal, whatever the operation's own reason was.
    return refusal(
      changed ? "changedAndUnreapplyable" : applied.reason,
      applied.detail
    );
  }
  const content = (file.bom ? BOM : "") + applied.content;
  // The result's hash is computed at commit; verify never reads it.
  const problem = verify(
    analyseFile(relativePath, raw, hash),
    analyseFile(relativePath, content, ""),
    operations
  );
  if (problem !== null) return refusal("verificationFailed", problem);
  return commit(absolute, relativePath, content);
}

/**
 * The Vault editor's save, and nothing else (ADR 0008 decision 2): the
 * user's own typing, whole. Any other caller is a bug — the app's own
 * writes are splices that leave every other byte alone. It skips re-apply
 * (there is nothing to re-apply) and skips verification (the user's typing
 * is never refused on shape, ADR 0015 decision 4; a file that lost its shape
 * is a shape problem on the next read). Its one refusal is a hash mismatch,
 * which the editor shows as *changed on disk*. The file's BOM and line
 * endings are restored around the editor's text.
 */
export async function replaceFile(
  vaultPath: string,
  path: string,
  content: string,
  basedOn: string
): Promise<WriteResult> {
  const { absolute, relativePath } = await locate(vaultPath, path);
  const bytes = await current(absolute);
  if (bytes === null || sha256(bytes) !== basedOn) {
    return refusal(
      "changedOnDisk",
      `${relativePath} changed since it was read`
    );
  }
  const { file } = fileChoices(bytes.toString("utf8"));
  const text = withEol(asLf(content), file.eol);
  return commit(absolute, relativePath, (file.bom ? BOM : "") + text);
}

/**
 * A new object or an app-created Note, written whole: UTF-8, LF, one
 * trailing newline, no BOM. The only operation that makes frontmatter
 * (ADR 0006 decision 11). Refuses to replace a file that exists.
 */
export async function createFile(
  vaultPath: string,
  path: string,
  content: string
): Promise<WriteResult> {
  const { absolute, relativePath } = await locate(vaultPath, path);
  if ((await current(absolute)) !== null) {
    return refusal("alreadyExists", `${relativePath} already exists`);
  }
  const text = asLf(content).replace(/\n+$/, "") + "\n";
  await mkdir(dirname(absolute), { recursive: true });
  return commit(absolute, relativePath, text);
}
