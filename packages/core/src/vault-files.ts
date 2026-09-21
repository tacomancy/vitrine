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
import { VaultError } from "./vault.js";

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
export type OutlineResponse =
  | {
      readable: true;
      /** Vault-relative, as the index keys it. */
      path: string;
      /** `kind:` verbatim; null when there is no frontmatter or no key. */
      kind: string | null;
      /** SHA-256 of the bytes on disk, hex: what a write is `basedOn`. */
      hash: string;
      file: FileChoices;
      outline: FileOutline;
      /** The Kind's criteria; empty for every other Kind. */
      criteria: Criterion[];
      shape: ShapeProblem[];
    }
  | { readable: false; path: string; reason: string };

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

const sha256 = (bytes: Buffer | string) =>
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
  return analyse(relativePath, bytes.toString("utf8"), sha256(bytes));
}

/** The core's reading of one file's text; what `readOutline` and the write's verify step share. */
function analyse(
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
    hash,
    file,
    outline: { ...parsed, frontmatter },
    criteria,
    shape,
  };
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

/** The splicing operations. #122 adds the four section operations; the set is closed by ADR 0008. */
export type Operation = SetFrontmatter;

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
  | "unreadable"
  | "alreadyExists";

/**
 * `content` and `hash` are what beat 1b's index consumes to record an own
 * write synchronously (ADR 0014, update 2026-09-20). On a refusal nothing
 * touched the disk.
 */
export type WriteResult =
  | { written: true; hash: string; content: string }
  | { written: false; reason: WriteRefusal; detail: string };

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
function addTags(document: Document, parsed: Outline, tags: string[]): void {
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
  const present = new Set<string>();
  for (const t of parsed.tags) {
    if (t.source === "frontmatter" && t.valid) present.add(t.canonical);
  }
  for (const tag of tags) {
    const canonical = canonicalTag(tag);
    if (present.has(canonical)) continue;
    present.add(canonical);
    seq.items.push(document.createNode(tag));
  }
}

/**
 * Turn the operations into splices against `text` (BOM-less), each located
 * afresh — which is what makes re-applying to a changed file possible. Every
 * setFrontmatter in one write edits the same Document, so the frontmatter
 * is one splice and targets never overlap.
 */
function apply(
  text: string,
  operations: Operation[],
  eol: FileChoices["eol"]
): Applied {
  const parsed = outline(text);
  const splices: Splice[] = [];
  const frontmatterOps = operations.filter((o) => o.op === "setFrontmatter");
  if (frontmatterOps.length > 0) {
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
    for (const op of frontmatterOps) {
      for (const [key, value] of Object.entries(op.keys ?? {})) {
        document.set(key, value);
      }
      if (op.addTags) addTags(document, parsed, op.addTags);
    }
    if (document.contents !== null) {
      // lineWidth 0: an untouched long scalar is never folded across lines.
      const yaml = document.toString({ lineWidth: 0 });
      splices.push({
        range: parsed.frontmatter.content,
        text: eol === "crlf" ? yaml.replace(/\n/g, "\r\n") : yaml,
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

/**
 * What a splice must not have done, checked by re-parsing the result before
 * it reaches disk (ADR 0008 decision 3): the frontmatter still parses, `kind`
 * is unchanged, and no owned section is newly duplicated. The block ids an
 * operation depends on join this check with #122's section operations. A
 * duplicate the file already had is not the splice's doing and is reported
 * on the read, not refused here (ADR 0008 decision 10).
 */
function verify(
  before: OutlineResponse,
  after: OutlineResponse
): string | null {
  if (!before.readable) return `the file is unreadable: ${before.reason}`;
  if (!after.readable) return `the result is unreadable: ${after.reason}`;
  if (after.kind !== before.kind) {
    return `kind would change from ${JSON.stringify(before.kind)} to ${JSON.stringify(after.kind)}`;
  }
  const duplicated = (r: typeof after) =>
    r.shape
      .filter((p) => p.problem === "ownedSectionDuplicated")
      .map((p) => p.block);
  const already = new Set(duplicated(before));
  const fresh = duplicated(after).find((name) => !already.has(name));
  if (fresh !== undefined) return `owned section duplicated: ${fresh}`;
  return null;
}

async function commit(
  absolute: string,
  relativePath: string,
  content: string
): Promise<WriteResult> {
  try {
    await writeAtomically(absolute, content);
  } catch (cause) {
    throw new VaultError(
      "writeFailed",
      `Couldn't write ${relativePath}: ${errorMessage(cause)}`
    );
  }
  return { written: true, hash: sha256(Buffer.from(content, "utf8")), content };
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
 * they locate their targets afresh, which a string patch could not; splice;
 * re-parse and verify; then temp file + rename. A write that cannot be
 * re-applied or fails verification is refused with the reason and nothing
 * touches the disk. Line endings and a BOM are restored from the file as
 * read; the trailing-newline choice survives because the splice never
 * reaches the end of the file unless the frontmatter is the whole file, and
 * then the closing fence is kept as it was.
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

  const applied = apply(text, operations, file.eol);
  if (!applied.ok) {
    // A file that moved underneath and can no longer take the operation is
    // one refusal, whatever the operation's own reason was.
    return refusal(
      changed ? "changedAndUnreapplyable" : applied.reason,
      applied.detail
    );
  }
  const content = (file.bom ? BOM : "") + splice(text, applied.splices);
  const problem = verify(
    analyse(relativePath, raw, hash),
    analyse(relativePath, content, "")
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
  const lf = content.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const text = file.eol === "crlf" ? lf.replace(/\n/g, "\r\n") : lf;
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
  const text =
    content.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\n+$/, "") + "\n";
  await mkdir(dirname(absolute), { recursive: true });
  return commit(absolute, relativePath, text);
}
