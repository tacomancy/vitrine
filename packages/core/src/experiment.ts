import { mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import type { Heading } from "markdown";
import {
  artifactLines,
  inFolderArtifacts,
  type ArtifactLine,
  type InFolderArtifact,
} from "./artifact.js";
import { errorMessageWithoutPath, VaultError } from "./errors.js";
import { fileName } from "./file-name.js";
import {
  KIND as HYPOTHESIS,
  readHypothesisPage,
  type CriterionRead,
  type HypothesisPage,
} from "./hypothesis.js";
import { landing, wikilinkTo } from "./link-text.js";
import { bodyText, readPageFile, revisionsOf, section } from "./page-file.js";
import {
  saveEditedSection,
  savePosition,
  unchanged,
  writeOwn,
  type PageContext,
  type PageKind,
  type SavedAnswer,
} from "./page-write.js";
import type { Revision } from "./position-history.js";
import { questionsNaming, type RelatedQuestion } from "./questions-naming.js";
import { asString, quoted } from "./question-kind.js";
import { serialised } from "./serialise.js";
import {
  createFile,
  locate,
  type ShapeProblem,
  type WriteResult,
} from "./vault-files.js";
import type { Position, ReadableOutline, VaultIndex } from "./vault-index.js";

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

/**
 * The two Positions, by the field their Revisions carry, and the `##`
 * heading each is the body of: a design changed after the run and a
 * reading of it changed later both show (TEST-8, TEST-11).
 */
export const POSITIONS = {
  design: "Design",
  observations: "Observations",
} as const;
export type ExperimentPosition = keyof typeof POSITIONS;

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
  /** The lines in the user's order, stored and (from #369) linked alike (story 38). */
  artifacts: {
    present: boolean;
    text: string;
    items: ArtifactLine[];
    /** Files in the run's folder that no line names, drawn after the lines (#368). */
    inFolder: InFolderArtifact[];
  };
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
      /** Every Criterion this run is Evidence for; empty is a run that bears on no claim, which is not a fault (HOLD-6). */
      evidence: EvidenceFor[];
      /**
       * The Questions whose `from:` names this run, newest first — the ones
       * captured from it (#373). Read by backlink: a capture writes
       * nothing onto the run (spec #362 story 71).
       */
      questions: RelatedQuestion[];
      problems: ShapeProblem[];
    }
  | { readable: false; path: string; reason: string };

/** A Criterion as the attach list and the page's rail name it. */
export type CriterionToAttach = Pick<
  CriterionRead,
  "id" | "label" | "text" | "relationship" | "outcome"
>;

/**
 * One attachment as the Experiment page shows it (spec #362 story 22):
 * the Criterion, the claim it bears on, and the note written for it —
 * each opening its Hypothesis.
 */
export type EvidenceFor = {
  hypothesis: { path: string; claim: string };
  criterion: CriterionToAttach;
  note: string;
};

/**
 * What *attach as evidence* offers (spec #362 story 45): every Hypothesis,
 * each with its Criteria falsifying first, and the hash each write is
 * `basedOn`. A Hypothesis the core could not read is a problem named,
 * never a group quietly missing from the list.
 */
export type CriteriaToAttach = {
  groups: {
    path: string;
    claim: string;
    hash: string;
    criteria: CriterionToAttach[];
  }[];
  problems: { path: string; reason: string }[];
};

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
  const artifacts = text("Artifacts");

  return {
    readable: true,
    path: relativePath,
    hash: read.hash,
    frontmatter,
    sections: {
      purpose: text("Purpose"),
      design: text("Design"),
      whereItRan: { ...whereItRan, lines: whereItRanLines(whereItRan.text) },
      artifacts: {
        ...artifacts,
        items: await artifactLines(vaultPath, relativePath, artifacts.text),
        inFolder: inFolderArtifacts(index, relativePath, artifacts.text),
      },
      observations: text("Observations"),
      positionHistory: {
        ...text("Position history"),
        entries: history.entries,
      },
    },
    cameFrom: cameFromOf(index, relativePath, frontmatter.from),
    evidence: await evidenceFor(index, vaultPath, relativePath),
    questions: questionsNaming(index, relativePath),
    problems,
  };
}

// Falsifying first, as the Hypothesis page draws its band (brief § What a
// Hypothesis holds: falsifying criteria carry more weight); the rest keep
// the file's order, which a stable sort leaves alone.
const falsifyingFirst = (criteria: CriterionRead[]) =>
  [...criteria].sort(
    (a, b) =>
      Number(b.relationship === "falsifying") -
      Number(a.relationship === "falsifying")
  );

const toAttach = ({
  id,
  label,
  text,
  relationship,
  outcome,
}: CriterionRead): CriterionToAttach => ({
  id,
  label,
  text,
  relationship,
  outcome,
});

type ReadHypothesis = Extract<HypothesisPage, { readable: true }>;

/** Hypotheses in the order both lists show them: by claim, as a reader would look one up. */
const byClaim = (a: ReadHypothesis, b: ReadHypothesis) =>
  a.sections.claim.text.localeCompare(b.sections.claim.text);

/**
 * The Evidence lines naming a run, read back from the Hypotheses — the
 * only place an attachment is written (§ Vault layout (Experiment)). The
 * Index says which Hypotheses link to the runs asked about, so only those
 * are read; the page read then keeps the links that are Evidence lines
 * under a criterion, so a mention in the claim or design notes is not an
 * attachment. A line written in Obsidian is found the same way, once the
 * watcher has told the Index. One reader for the page's rail and the
 * Inbox's *attached*, so the two can never disagree about a run.
 */
async function evidenceLines(
  index: VaultIndex,
  vaultPath: string,
  runs: string[]
): Promise<(EvidenceFor & { run: string })[]> {
  if (runs.length === 0) return [];
  const wanted = new Set(runs);
  const linking = index.select<{ path: string }>(
    `SELECT DISTINCT path FROM links
     WHERE resolved_path IN (${runs.map(() => "?").join(", ")})
     AND path IN (SELECT path FROM files WHERE kind = ?)`,
    ...runs,
    HYPOTHESIS
  );
  const pages = (
    await Promise.all(
      linking.map((row) => readHypothesisPage(index, vaultPath, row.path))
    )
  ).filter((page): page is ReadHypothesis => page.readable);
  return pages.sort(byClaim).flatMap((page) =>
    falsifyingFirst(page.sections.criteria.criteria).flatMap((criterion) =>
      criterion.evidence.flatMap((line) => {
        const run = line.link?.resolvedPath;
        return run == null || !wanted.has(run)
          ? []
          : [
              {
                run,
                hypothesis: {
                  path: page.path,
                  claim: page.sections.claim.text,
                },
                criterion: toAttach(criterion),
                note: line.note,
              },
            ];
      })
    )
  );
}

/** The Criteria this run is Evidence for, in the order the attach list shows them. */
async function evidenceFor(
  index: VaultIndex,
  vaultPath: string,
  path: string
): Promise<EvidenceFor[]> {
  return (await evidenceLines(index, vaultPath, [path])).map(
    ({ hypothesis, criterion, note }) => ({ hypothesis, criterion, note })
  );
}

/** Every Hypothesis's Criteria, for *attach as evidence* (spec #362 story 45). */
export async function criteriaToAttach(
  index: VaultIndex,
  vaultPath: string
): Promise<CriteriaToAttach> {
  const paths = index.select<{ path: string }>(
    "SELECT path FROM files WHERE kind = ?",
    HYPOTHESIS
  );
  const read = await Promise.all(
    paths.map((row) => readHypothesisPage(index, vaultPath, row.path))
  );
  return {
    groups: read
      .filter((page): page is ReadHypothesis => page.readable)
      .sort(byClaim)
      .map((page) => ({
        path: page.path,
        claim: page.sections.claim.text,
        hash: page.hash,
        criteria: falsifyingFirst(page.sections.criteria.criteria).map(
          toAttach
        ),
      })),
    problems: read.flatMap((page) =>
      page.readable ? [] : [{ path: page.path, reason: page.reason }]
    ),
  };
}

/** The file creation writes, whole. Pure, so its bytes can be read off a test. */
export function composeExperiment(page: {
  id: string;
  name: string;
  created: string;
  /** The wikilink to what prompted it, when it was made from somewhere. */
  from?: string;
}): string {
  return [
    "---",
    `id: ${page.id}`,
    `kind: ${KIND}`,
    `name: ${quoted(page.name)}`,
    "status: planned",
    `created: ${page.created}`,
    ...(page.from === undefined ? [] : [`from: ${quoted(page.from)}`]),
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
 *
 * `from` is the vault path of what prompted the run — a Hypothesis, when
 * it is made from a Criterion's *attach evidence* (#371) — written as
 * `from:`, which the page draws as *came from*. Nothing is written to that
 * file: an Experiment is not a Promotion (spec #362 story 9).
 */
export function createExperiment(
  vaultPath: string,
  index: VaultIndex,
  typed: string,
  {
    created,
    newId,
    from,
  }: { created: string; newId: () => string; from?: string }
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
    // Before the folder is claimed, so a came-from the vault does not hold
    // is refused with nothing made.
    const link = from === undefined ? undefined : wikilinkTo(index, path, from);
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
    const content = composeExperiment({
      id: newId(),
      name,
      created,
      ...(link === undefined ? {} : { from: link }),
    });
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

/**
 * The Kind's Positions for the index (§ Index): `design` and
 * `observations`, each the body of its heading, and no row for one whose
 * heading is not in the file — a heading retyped mid-edit in Obsidian must
 * not read as the section having been cleared. The index diffs these
 * between reads of the file, which is what parks an Obsidian edit to
 * either as a pending Revision (#217); Purpose and *where it ran* are
 * absent, so an edit to them parks nothing (spec #362 story 18).
 */
export function experimentPositions(
  { outline }: ReadableOutline,
  content: string
): Position[] {
  const positions: Position[] = [];
  const design = section(outline, POSITIONS.design).heading;
  if (design !== undefined) {
    positions.push({ field: "design", text: bodyText(content, design) });
  }
  const observations = section(outline, POSITIONS.observations).heading;
  if (observations !== undefined) {
    positions.push({
      field: "observations",
      text: bodyText(content, observations),
    });
  }
  return positions;
}

/**
 * The design or the observations saved, with the Revision it records
 * (`savePosition`). Either may be saved empty — a planned run has no
 * observations, and clearing a design is itself a revision worth keeping.
 * Neither is `judged`: an Experiment has no Override for a Revision to
 * void, and what a Criterion's Override judged is the Hypothesis's own
 * text, never the run's.
 */
export async function saveExperimentPosition(
  ctx: PageContext,
  path: string,
  input: {
    field: ExperimentPosition;
    text: string;
    basedOn: string;
    was: string;
    at: Date;
    coalesceMs: number;
  }
): Promise<SavedAnswer> {
  return savePosition(ctx, path, PAGE, {
    ...input,
    section: POSITIONS[input.field],
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

/**
 * The Experiment surface's views (#372; spec #362 stories 56–61). `inbox`
 * is the Experiment Inbox — complete, and either unread or unattached —
 * and its two halves are the other two; `status` covers every run, or the
 * runs of one status.
 */
export const FACETS = [
  "inbox",
  "not-yet-interpreted",
  "read-unattached",
  "status",
] as const;
export type ExperimentFacet = (typeof FACETS)[number];

export const SORTS = ["newest", "oldest", "most-artifacts", "shuffle"] as const;
export type ExperimentSort = (typeof SORTS)[number];

/**
 * What a row says of a run's reading: *attached* once it is Evidence for
 * a Criterion and written up, *read* once written up, *not yet read*
 * before that — attached or not, since an attachment is no reading of the
 * run's own.
 */
export type RunReading = "attached" | "read" | "not yet read";

/** One run as a row and the detail pane show it. */
export type ListedExperiment = {
  path: string;
  /** SHA-256 of the bytes read: what `D`'s status write is `basedOn`. */
  hash: string;
  name: string;
  status: ExperimentStatus | null;
  statusUnreadable: string | null;
  purpose: string;
  /** `created:`, or the file's modification time for a run written without one. */
  when: string;
  artifacts: number;
  /** What the detail pane draws; null for a run with none. */
  firstArtifact: ArtifactLine | null;
  whereItRan: WhereItRanLine[];
  /** The `repo:` line's value, which the project facet narrows by. */
  project: string | null;
  reading: RunReading;
};

export type ExperimentListing = {
  /** How many runs the vault holds, whatever the view shows: the one number in the chrome. */
  runs: number;
  /** Every project a run names, sorted; empty drops the facet. */
  projects: string[];
  experiments: ListedExperiment[];
  /** A run that could not be read is named, never quietly missing from a view. */
  unreadable: { path: string; reason: string }[];
};

const inView = (
  run: ListedExperiment,
  attached: boolean,
  facet: ExperimentFacet,
  status: ExperimentStatus | undefined
): boolean => {
  const complete = run.status === "complete";
  const observed = run.reading !== "not yet read";
  switch (facet) {
    case "inbox":
      return complete && (!observed || !attached);
    case "not-yet-interpreted":
      return complete && !observed;
    case "read-unattached":
      return complete && observed && !attached;
    case "status":
      return status === undefined || run.status === status;
  }
};

// FNV-1a over the seed and the path: an order that looks arbitrary and is
// the same on every read with the same seed, so a re-read after a write
// does not reshuffle the list out from under the selection.
function shuffleKey(seed: number, path: string): number {
  let hash = 0x811c9dc5 ^ seed;
  for (let i = 0; i < path.length; i += 1) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The Experiment Inbox and the surface's other views (#372). Derived on
 * every read and never stored: a run is in the Inbox because of what its
 * file and the Hypotheses say about it, so nothing can clear it but
 * writing it up and attaching it, or abandoning it (spec #362 story 66).
 * Which runs exist, and which Hypotheses name one, are the Index's; each
 * run's page is read for what its row shows.
 */
export async function listExperiments(
  index: VaultIndex,
  vaultPath: string,
  {
    facet,
    status,
    project,
    sort,
    seed = 0,
  }: {
    facet: ExperimentFacet;
    status?: ExperimentStatus | undefined;
    project?: string | undefined;
    sort: ExperimentSort;
    seed?: number | undefined;
  }
): Promise<ExperimentListing> {
  const files = index.select<{ path: string; mtime: number | null }>(
    "SELECT path, mtime FROM files WHERE kind = ? ORDER BY path",
    KIND
  );
  const attached = new Set(
    (
      await evidenceLines(
        index,
        vaultPath,
        files.map((f) => f.path)
      )
    ).map((line) => line.run)
  );
  const unreadable: ExperimentListing["unreadable"] = [];
  const runs = (
    await Promise.all(
      files.map(async ({ path, mtime }): Promise<ListedExperiment | null> => {
        const read = await readPageFile(vaultPath, path, [KIND], PAGE.noun);
        if (!read.readable) {
          unreadable.push({ path: read.path, reason: read.reason });
          return null;
        }
        const { content, outline } = read;
        const body = (name: (typeof SECTIONS)[number]) =>
          bodyText(content, section(outline, name).heading);
        const stem = path.replace(/^.*\//, "").replace(/\.md$/, "");
        const fm = readExperiment(
          (outline.frontmatter?.value ?? {}) as Record<string, unknown>,
          stem
        );
        const whereItRan = whereItRanLines(body("Where it ran"));
        const artifacts = await artifactLines(
          vaultPath,
          path,
          body("Artifacts")
        );
        const observed = body("Observations").trim() !== "";
        return {
          path,
          hash: read.hash,
          name: fm.name,
          status: fm.status,
          statusUnreadable: fm.statusUnreadable,
          purpose: body("Purpose").trim(),
          when: fm.created ?? new Date(mtime ?? 0).toISOString(),
          artifacts: artifacts.length,
          firstArtifact: artifacts[0] ?? null,
          whereItRan,
          project:
            whereItRan.find(
              (line) =>
                line.label?.toLowerCase() === "repo" && line.value !== ""
            )?.value ?? null,
          reading: !observed
            ? "not yet read"
            : attached.has(path)
              ? "attached"
              : "read",
        };
      })
    )
  ).filter((run): run is ListedExperiment => run !== null);

  const time = (run: ListedExperiment) => Date.parse(run.when) || 0;
  // Ties fall back to the path, so no two reads order the same runs differently.
  const byPath = (a: ListedExperiment, b: ListedExperiment) =>
    a.path.localeCompare(b.path);
  const order: Record<
    ExperimentSort,
    (a: ListedExperiment, b: ListedExperiment) => number
  > = {
    newest: (a, b) => time(b) - time(a) || byPath(a, b),
    oldest: (a, b) => time(a) - time(b) || byPath(a, b),
    "most-artifacts": (a, b) =>
      b.artifacts - a.artifacts || time(b) - time(a) || byPath(a, b),
    shuffle: (a, b) =>
      shuffleKey(seed, a.path) - shuffleKey(seed, b.path) || byPath(a, b),
  };

  return {
    runs: files.length,
    projects: [
      ...new Set(
        runs.flatMap((run) => (run.project === null ? [] : [run.project]))
      ),
    ].sort((a, b) => a.localeCompare(b)),
    experiments: runs
      .filter(
        (run) =>
          inView(run, attached.has(run.path), facet, status) &&
          (project === undefined || run.project === project)
      )
      .sort(order[sort]),
    unreadable: unreadable.sort((a, b) => a.path.localeCompare(b.path)),
  };
}
