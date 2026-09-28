import { mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import type { Heading } from "markdown";
import { errorMessageWithoutPath, VaultError } from "./errors.js";
import { fileName } from "./file-name.js";
import { landing } from "./link-text.js";
import { bodyText, readPageFile, revisionsOf, section } from "./page-file.js";
import {
  saveEditedSection,
  unchanged,
  writeOwn,
  type PageContext,
  type PageKind,
} from "./page-write.js";
import type { Revision } from "./position-history.js";
import { asString } from "./question-kind.js";
import { quoted } from "./research-question.js";
import { serialised } from "./serialise.js";
import {
  createFile,
  locate,
  type ShapeProblem,
  type WriteResult,
} from "./vault-files.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * The Experiment Kind (`docs/architecture.md` § Vault layout (Experiment),
 * § Experiment view; ADR 0035; `CONTEXT.md` § Testing): a run designed and
 * recorded here and executed elsewhere. Made by typing a short name, never
 * promoted from a Question — an Experiment exists independently of any
 * claim (brief § Experiment), so making one touches nothing else.
 */

export const KIND = "experiment";

/** What this Kind's writes expect the file to be (`page-write.ts`). */
export const PAGE: PageKind = { kind: KIND, noun: "an Experiment" };

const FOLDER = "experiments";

/** The six headings, in the order creation writes them. */
export const SECTIONS = [
  "Purpose",
  "Design",
  "Where it ran",
  "Artifacts",
  "Observations",
  "Position history",
] as const;

/**
 * The two sections edited in place with no Revision: a purpose is looser
 * than a claim, and *where it ran* is facts about elsewhere — correcting a
 * path is not a change of mind (spec #362 story 18). Design and
 * Observations are Positions, and are saved as such.
 */
export const EDITED_SECTIONS = ["Purpose", "Where it ran"] as const;
export type EditedSection = (typeof EDITED_SECTIONS)[number];

/** Hand-maintained; the app never moves it (TEST-10). */
export const STATUSES = [
  "planned",
  "running",
  "complete",
  "abandoned",
] as const;
export type ExperimentStatus = (typeof STATUSES)[number];

export type ExperimentFrontmatter = {
  id?: string;
  /** As typed: the Display name. The folder is this, stripped. */
  name: string;
  /** Null when the file records none, or one outside the four. */
  status: ExperimentStatus | null;
  /**
   * A `status:` the vocabulary cannot read, verbatim — `done`. It is not
   * *no status*: someone set something, and the chips must not look as
   * though nothing was (the Hypothesis's unreadable Outcome, likewise).
   */
  statusUnreadable: string | null;
  created?: string;
  from?: string;
  tags: string[];
};

/**
 * One line under `## Where it ran`: `label: value`, the label the user's
 * own. A line with no label is kept with a null one — what the user wrote
 * there is shown, never dropped.
 */
export type WhereItRanLine = { label: string | null; value: string };

/** What `from:` names, as *came from* draws it: the link as written, and where the index says it lands. */
export type CameFrom = {
  text: string;
  path: string | null;
  kind: string | null;
  display: string | null;
};

export type ExperimentSections = {
  purpose: { present: boolean; text: string };
  design: { present: boolean; text: string };
  whereItRan: { present: boolean; text: string; lines: WhereItRanLine[] };
  artifacts: { present: boolean; text: string };
  observations: { present: boolean; text: string };
  positionHistory: { present: boolean; text: string; entries: Revision[] };
};

export type ExperimentPage =
  | {
      readable: true;
      /** Vault-relative, as the index keys it. */
      path: string;
      /** SHA-256 of the bytes read: what the page's later writes are `basedOn`. */
      hash: string;
      frontmatter: ExperimentFrontmatter;
      sections: ExperimentSections;
      cameFrom: CameFrom | null;
      problems: ShapeProblem[];
    }
  | { readable: false; path: string; reason: string };

const isStatus = (value: string): value is ExperimentStatus =>
  (STATUSES as readonly string[]).includes(value);

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

/** The page's frontmatter; lenient throughout, as every Kind's reader is (ADR 0009). */
export function readExperiment(
  fm: Record<string, unknown>,
  stem: string
): ExperimentFrontmatter {
  const raw = asString(fm["status"]);
  const out: ExperimentFrontmatter = {
    // One written by hand without a `name:` is still named: by its file.
    name: asString(fm["name"])?.trim() || stem,
    status: raw !== undefined && isStatus(raw) ? raw : null,
    statusUnreadable: raw !== undefined && !isStatus(raw) ? raw : null,
    tags: stringList(fm["tags"]),
  };
  const id = asString(fm["id"]);
  if (id !== undefined) out.id = id;
  const created = asString(fm["created"]);
  if (created !== undefined) out.created = created;
  const from = asString(fm["from"]);
  if (from !== undefined) out.from = from;
  return out;
}

// `label: value`, where the colon is followed by a space or ends the line —
// so `https://…` on a line of its own is a value, not a label called
// `https`. A list marker in front is the user's formatting, not the label.
const LABELLED = /^([^:\s][^:]*?):(?:\s+(.*))?$/;

/** The section's lines as the rail draws them (spec #362 story 17). */
export function whereItRanLines(text: string): WhereItRanLine[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*[-*+]\s+/, "").trim())
    .filter((line) => line !== "")
    .map((line) => {
      const match = LABELLED.exec(line);
      return match === null
        ? { label: null, value: line }
        : { label: match[1]!.trim(), value: (match[2] ?? "").trim() };
    });
}

/** `from:` resolved by the index, as every link on a page is; a value that is not a wikilink is shown as written. */
function cameFromOf(
  index: VaultIndex,
  path: string,
  from: string | undefined
): CameFrom | null {
  if (from === undefined || from.trim() === "") return null;
  return { text: from, ...landing(index, path, from.trim()) };
}

/** The page as the file holds it: the body read from disk, links resolved by the index. */
export async function readExperimentPage(
  index: VaultIndex,
  vaultPath: string,
  path: string
): Promise<ExperimentPage> {
  const read = await readPageFile(vaultPath, path, [PAGE.kind], PAGE.noun);
  if (!read.readable) return read;
  const { relativePath, content, outline } = read;
  const stem = relativePath.replace(/^.*\//, "").replace(/\.md$/, "");
  const frontmatter = readExperiment(
    (outline.frontmatter?.value ?? {}) as Record<string, unknown>,
    stem
  );

  const problems: ShapeProblem[] = [...read.shape];
  const found = {} as Record<(typeof SECTIONS)[number], Heading | undefined>;
  for (const name of SECTIONS) {
    const { heading, count } = section(outline, name);
    found[name] = heading;
    // A duplicated owned section is already the file's shape problem.
    if (count === 0 || (count > 1 && name !== "Position history")) {
      problems.push({
        path: relativePath,
        kind: KIND,
        problem: count === 0 ? "sectionMissing" : "sectionDuplicated",
        block: name,
      });
    }
  }
  const history = revisionsOf(
    relativePath,
    KIND,
    content,
    outline,
    found["Position history"]
  );
  problems.push(...history.problems);
  const text = (name: (typeof SECTIONS)[number]) => ({
    present: found[name] !== undefined,
    text: bodyText(content, found[name]),
  });
  const whereItRan = text("Where it ran");

  return {
    readable: true,
    path: relativePath,
    hash: read.hash,
    frontmatter,
    sections: {
      purpose: text("Purpose"),
      design: text("Design"),
      whereItRan: { ...whereItRan, lines: whereItRanLines(whereItRan.text) },
      artifacts: text("Artifacts"),
      observations: text("Observations"),
      positionHistory: {
        ...text("Position history"),
        entries: history.entries,
      },
    },
    cameFrom: cameFromOf(index, relativePath, frontmatter.from),
    problems,
  };
}

/** The file creation writes, whole. Pure, so its bytes can be read off a test. */
export function composeExperiment(page: {
  id: string;
  name: string;
  created: string;
}): string {
  return [
    "---",
    `id: ${page.id}`,
    `kind: ${KIND}`,
    `name: ${quoted(page.name)}`,
    "status: planned",
    `created: ${page.created}`,
    "tags: []",
    "---",
    "",
    ...SECTIONS.flatMap((name) => [`## ${name}`, ""]),
  ].join("\n");
}

// Two makes of one name arriving together would otherwise both find the
// folder free; the second would then refuse on the file, but only after
// its folder check had passed — the queue makes the check and the claim
// one step. Module scope, per `serialise.ts`: the hazard is this
// procedure's.
const serially = serialised();

/**
 * Make an Experiment from the short name typed (spec #362 stories 1–6):
 * `experiments/<name>/<name>.md`, the name stripped by the Question's rule
 * for the folder and kept as typed for `name:`. A name already taken is
 * refused, never suffixed: the name is the run's handle in the user's code
 * and W&B too, and `sweep-7 (2)` would be a handle nothing else knows. Taken
 * means the *folder* exists, page or not — a folder is where stored
 * Artifacts live, and adopting one that already holds files would put
 * someone else's plots on this run's page.
 *
 * The folder is claimed first, with a `mkdir` that fails on one already
 * there — on macOS's case-insensitive disk that also catches `Sweep-7`
 * beside `sweep-7`, which a name comparison here would have to re-derive.
 * The index is told before this returns, so ⌘K finds the run at once.
 */
export function createExperiment(
  vaultPath: string,
  index: VaultIndex,
  typed: string,
  { created, newId }: { created: string; newId: () => string }
): Promise<{ path: string }> {
  return serially(async () => {
    const name = typed.trim();
    if (name === "") {
      throw new VaultError(
        "refused",
        "An Experiment needs a name: type the short handle the run goes by."
      );
    }
    // No id fallback, unlike a Question: an id is not a handle anyone's
    // code or W&B knows the run by, so a name with nothing left to file
    // under is asked for again.
    const stem = fileName(name, "");
    if (stem === "") {
      throw new VaultError(
        "refused",
        `Nothing in "${name}" can name a folder; use letters or digits.`
      );
    }
    const path = `${FOLDER}/${stem}/${stem}.md`;
    // Refuses a folder reached through a symlink out of the vault before
    // anything is made on the way to it.
    const { absolute } = await locate(vaultPath, path);
    const folder = join(absolute, "..");
    await mkdir(join(vaultPath, FOLDER), { recursive: true });
    try {
      await mkdir(folder);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "EEXIST") {
        throw new VaultError(
          "refused",
          `An Experiment named ${stem} is already in the vault; the name is its folder, so pick another.`
        );
      }
      throw new VaultError(
        "writeFailed",
        `Couldn't make the folder for ${stem}: ${errorMessageWithoutPath(cause)}`
      );
    }
    const content = composeExperiment({ id: newId(), name, created });
    const written = await createFile(vaultPath, path, content).catch(
      (cause: unknown) => ({
        written: false as const,
        detail: (cause as Error).message,
      })
    );
    if (!written.written) {
      // The folder was this call's; an empty one left behind would make
      // the name read as taken with nothing in it to show why.
      await rmdir(folder).catch(() => undefined);
      throw new VaultError(
        "writeFailed",
        `Couldn't write ${path}: ${written.detail}`
      );
    }
    await index.own(path, written.content);
    return { path };
  });
}

/** Purpose or *where it ran*, saved as typed with no Revision. */
export async function saveExperimentSection(
  ctx: PageContext,
  path: string,
  input: { section: EditedSection; body: string; basedOn: string; was: string }
): Promise<WriteResult> {
  return saveEditedSection(ctx, path, PAGE, input);
}

/**
 * The hand-set status (TEST-10): `setFrontmatter`, and never a Revision —
 * the history is a record of what the user thought, not of bookkeeping
 * (spec #362 story 20). A status the file already holds writes nothing.
 */
export async function setExperimentStatus(
  ctx: PageContext,
  path: string,
  { status, basedOn }: { status: ExperimentStatus; basedOn: string }
): Promise<WriteResult> {
  return writeOwn(ctx, path, PAGE, (read) => {
    const fm = (read.outline.frontmatter?.value ?? {}) as Record<
      string,
      unknown
    >;
    if (asString(fm["status"]) === status) return unchanged(read);
    return {
      operations: [{ op: "setFrontmatter", keys: { status } }],
      basedOn,
    };
  });
}
