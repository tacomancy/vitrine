import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { linkedHere, linksToUrl, type LinkedArtifact } from "./artifact.js";
import { dismissed, readDismissals } from "./dismissals.js";
import { errorMessage } from "./errors.js";
import {
  KIND as EXPERIMENT,
  readExperimentPage,
  type ExperimentPage,
} from "./experiment.js";
import { KIND as HYPOTHESIS, readHypothesisPage } from "./hypothesis.js";
import { resolvesTo } from "./link-text.js";
import { PDF_FOLDER } from "./pdf-folder.js";
import { localDay, writtenDay, type OpenDays } from "./open-days.js";
import { KIND, readResearchQuestion } from "./research-question.js";
import {
  pdfPlumbingRows,
  type ConflictCopy,
  type PdfMissing,
  type PdfPlumbingRow,
  type UnlinkedAnnotations,
} from "./pdf-plumbing.js";
import { unnamedPdfs, type PdfReads, type UnreadablePdfs } from "./sources.js";
import { unmatchedRows, type UnmatchedRow } from "./unmatched.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * The Loose Ends dashboard (`docs/architecture.md` § Loose Ends; brief
 * § Loose Ends): what in the vault is incomplete or broken, as queries over
 * the index plus `dismissals.json`. Nothing here is stored, and nothing here
 * counts a total — counts are per group, because one figure for everything
 * turns maintenance into debt.
 *
 * Every later beat adds row kinds to these four groups; a group with no rows
 * is not returned at all, so an empty group cannot be drawn by mistake.
 */

/** The four groups, in the brief's order. That order is the reply's. */
export const GROUPS = [
  "Broken plumbing",
  "Unfinished reading",
  "Disconnected material",
  "Stalled questions",
] as const;

export type LooseEndGroupName = (typeof GROUPS)[number];

/**
 * A Research Question promoted and never given a source on either side.
 * `subject` is what a dismissal is keyed by and `kind` what it is judged
 * by, so silencing this row never silences another about the same page.
 */
export type StalledResearchQuestion = {
  kind: "stalled-research-question";
  subject: string;
  /** Vault-relative: where the row's link goes. */
  path: string;
  /** The question itself — the row reads as what it is about. */
  title: string;
  /** `promoted:` as the file holds it; the row's age is the reader's to word. */
  since: string;
};

/**
 * A Hypothesis committed to and gone quiet with criteria untested (#341;
 * spec #327 stories 81–85; REP-9): it resurfaces as a commitment, so the
 * row says how much of the test is still unrun, never that anything is
 * overdue.
 */
export type StalledHypothesis = {
  kind: "stalled-hypothesis";
  subject: string;
  /** Vault-relative: where the row's link goes. */
  path: string;
  /** The current claim (the Display name), not the claim it was promoted with. */
  title: string;
  /** Open days since it last changed — the unit the row is judged in, so the unit it is worded in. */
  quietOpenDays: number;
  /** How many criteria are written; none is its own reason to be here. */
  criteria: number;
  /** How many of them carry no Outcome. */
  awaiting: number;
};

/**
 * A file holding a bare `[[name]]` that matches several files (CONTEXT.md
 * *Ambiguous link*): the link resolves to nothing, because picking the first
 * indexed would make the app quietly wrong about where a reader was pointing.
 *
 * One row per *linking file*, never per link. A dismissal is keyed by an
 * object and a row kind and by nothing finer (§ Vault layout,
 * `dismissals.json`), so two rows about one file under one kind could not be
 * silenced apart: *mark deliberate* on either would take the other with it,
 * which is exactly the silent loss the per-row-kind rule exists to prevent.
 */
export type AmbiguousLinks = {
  kind: "ambiguous-link";
  subject: string;
  /** Vault-relative: the linking file, which is what *open* opens. */
  path: string;
  /** The linking file's name — the row reads as the file it is about. */
  title: string;
  /** The linking file's `kind:`, null for a Note: what says whether it has a surface yet. */
  linkingKind: string | null;
  /** Each name in the file that reached more than one file, in document order. */
  links: Array<{ target: string; candidates: string[] }>;
};

/**
 * A run complete with Artifacts and nothing written about what they show,
 * gone quiet (#374; spec #362 stories 73–74; REP-9): a result never read
 * coming back. Whether it is Evidence plays no part — a run that never
 * bears on a claim is not unfinished (HOLD-6), and one that does is still
 * unread.
 */
export type StalledExperiment = {
  kind: "stalled-experiment";
  subject: string;
  /** Vault-relative: where the row's link goes. */
  path: string;
  /** The run's name, as typed. */
  title: string;
  /** Open days since the file last changed — the unit it is judged in, so the unit it is worded in. */
  quietOpenDays: number;
  /** How many Artifact lines — stored or linked — are under `## Artifacts`. */
  artifacts: number;
};

/**
 * Linked Artifacts recorded on this machine whose paths no longer stat
 * (#374; spec #362 stories 75–77; REP-6; ADR 0035 decision 7).
 *
 * One row per Experiment, never per Artifact, for the ambiguous link's
 * reason: *mark deliberate* is keyed by object and row kind and nothing
 * finer, so two rows about one run under this kind could not be silenced
 * apart. The files are listed inside the one row instead.
 */
export type MissingArtifacts = {
  kind: "missing-artifact";
  subject: string;
  /** Vault-relative: where the row's link goes. */
  path: string;
  /** The run's name, as typed. */
  title: string;
  /** Each missing file, in the section's order, with the path it was linked at. */
  missing: Array<{ file: string; target: string }>;
  /**
   * The falsifying Criteria with an Outcome recorded that this run is
   * Evidence for. Any at all puts the row under Broken plumbing, drawn
   * loud: the record behind a falsification is quietly gone (story 76).
   */
  falsifying: Array<{ path: string; claim: string; criterion: string | null }>;
};

/**
 * A PDF in the PDF folder that no Source's `pdf:` names (#417; spec #416
 * stories 4–6): neither ingested nor indexed until it is resolved. Keyed by
 * its path — a file with no `id:` — which a rename carries across
 * (`renameDismissals`).
 */
export type NoSource = {
  kind: "no-source";
  subject: string;
  /** Vault-relative: the PDF itself. */
  path: string;
  /** The file's name inside the PDF folder — the row reads as the file it is. */
  title: string;
};

/**
 * A PDF the engine could not read (#418; spec #416 stories 65–67): encrypted,
 * damaged, or one it stopped on. It replaces the file's no-Source row, since
 * it cannot be resolved until it reads. `reason` finishes "could not be read
 * because …" and never carries a path (ADR 0028).
 */
export type UnreadablePdf = {
  kind: "unreadable-pdf";
  subject: string;
  /** Vault-relative: the PDF itself. */
  path: string;
  title: string;
  reason: string;
};

export type LooseEndRow =
  | UnmatchedRow
  | ConflictCopy
  | PdfMissing
  | UnlinkedAnnotations
  | UnreadablePdf
  | NoSource
  | StalledResearchQuestion
  | StalledHypothesis
  | AmbiguousLinks
  | StalledExperiment
  | MissingArtifacts;

export type LooseEndGroup = {
  group: LooseEndGroupName;
  rows: LooseEndRow[];
};

export type LooseEnds = {
  /** Only the groups with rows, in `GROUPS` order. */
  groups: LooseEndGroup[];
  /**
   * What the dashboard could not judge: a `dismissals.json` that does not
   * parse (so rows it was told to silence may be here), or a file whose
   * frontmatter it could not read (so a row that belongs here may be
   * missing). Either way it says so rather than looking tidy.
   */
  problems: string[];
};

/**
 * How many **open days** a Research Question may sit unsourced before it is
 * stalled (#243; § Loose Ends). Open days, never calendar days: a fortnight
 * away would otherwise create rows that did not exist when the user left,
 * purely because of the calendar (stories REP-11, RES-3). A number in code,
 * as the spec has it — a setting would make the user responsible for a
 * judgement the app is making.
 */
export const STALLED_OPEN_DAYS = 14;

export type LooseEndsOptions = {
  /** The record of days this vault was open; the unit every quiet period is counted in. */
  days: OpenDays;
  /** Tests shorten it; the app uses `STALLED_OPEN_DAYS`. */
  stalledOpenDays: number;
  /** This machine's name, as a linked Artifact records it: only its own links are checked. */
  machine: string;
  /** What the engine has failed to read, and read: the PDF rows are judged by it. */
  reads: PdfReads;
};

export async function looseEnds(
  index: VaultIndex,
  vaultPath: string,
  { days, stalledOpenDays, machine, reads }: LooseEndsOptions
): Promise<LooseEnds> {
  const { dismissals, problem } = await readDismissals(vaultPath);
  const questions = stalledResearchQuestions(index, days, stalledOpenDays);
  const hypotheses = await stalledHypotheses(
    index,
    vaultPath,
    days,
    stalledOpenDays
  );
  const experiments = await experimentRows(
    index,
    vaultPath,
    days,
    stalledOpenDays,
    machine
  );
  const broken = unreadableRows(index, reads.unreadable);
  const plumbing = await pdfPlumbingRows(index, vaultPath, reads);
  const plumbingOfKind = <K extends PdfPlumbingRow["kind"]>(kind: K) =>
    plumbing.rows.filter(
      (row): row is Extract<PdfPlumbingRow, { kind: K }> => row.kind === kind
    );
  // A conflict copy is the row for its file: the no-Source row the same
  // PDF would be is not drawn beside it.
  const copies = plumbingOfKind("conflict-copy");
  const unmatched = await unmatchedRows(index, vaultPath);
  const byGroup: Record<LooseEndGroupName, LooseEndRow[]> = {
    "Broken plumbing": [
      ...unmatched.rows,
      ...broken,
      ...copies,
      ...plumbingOfKind("pdf-missing"),
      ...experiments.missingUnderFalsification,
    ],
    "Unfinished reading": noSourceRows(index).filter(
      (row) =>
        !broken.some((b) => b.path === row.path) &&
        !copies.some((c) => c.path === row.path)
    ),
    "Disconnected material": [
      ...plumbingOfKind("unlinked-annotations"),
      ...ambiguousLinks(index),
    ],
    "Stalled questions": [
      ...questions.rows,
      ...hypotheses.rows,
      ...experiments.stalled,
      ...experiments.missing,
    ],
  };
  return {
    // The dismissal is applied here rather than inside each row query, so a
    // row kind a later beat adds is silenced by *mark deliberate* without
    // its author having to remember to ask.
    groups: GROUPS.flatMap((group) => {
      const rows = byGroup[group].filter(
        (row) => !dismissed(dismissals, row.subject, row.kind)
      );
      return rows.length === 0 ? [] : [{ group, rows }];
    }),
    problems: [
      ...(problem === null ? [] : [problem]),
      ...questions.problems,
      ...hypotheses.problems,
      ...experiments.problems,
      ...unmatched.problems,
      ...plumbing.problems,
    ],
  };
}

function unreadableRows(
  index: VaultIndex,
  unreadable: UnreadablePdfs
): UnreadablePdf[] {
  const rows: UnreadablePdf[] = [];
  for (const path of unnamedPdfs(index)) {
    const failed = unreadable.get(path);
    const now = index.select<{ hash: string | null }>(
      "SELECT hash FROM files WHERE path = ?",
      path
    )[0];
    if (failed === undefined || failed.hash !== now?.hash) continue;
    rows.push({
      kind: "unreadable-pdf",
      subject: path,
      path,
      title: path.slice(PDF_FOLDER.length + 1),
      reason: failed.reason,
    });
  }
  return rows;
}

function noSourceRows(index: VaultIndex): NoSource[] {
  return unnamedPdfs(index).map((path) => ({
    kind: "no-source",
    subject: path,
    path,
    title: path.slice(PDF_FOLDER.length + 1),
  }));
}

function ambiguousLinks(index: VaultIndex): AmbiguousLinks[] {
  const byPath = new Map<string, AmbiguousLinks>();
  for (const row of index.select<{
    path: string;
    id: string | null;
    kind: string | null;
    target: string;
    heading: string;
    block: string | null;
  }>(
    `SELECT l.path, f.id, f.kind, l.target, l.heading, l.block
       FROM links l JOIN files f ON f.path = l.path
      WHERE l.resolution = 'ambiguous'
      ORDER BY l.path, l.start`
  )) {
    // The index's own resolver, never a second reading of the same rules:
    // the `links` column says *ambiguous* but not which files the name
    // reached, and a surface that worked those out for itself could name a
    // pair the column was not talking about.
    const { resolution, candidates } = index.resolve(row.path, {
      target: row.target,
      heading: JSON.parse(row.heading) as string[],
      blockId: row.block,
    });
    if (resolution !== "ambiguous") continue;
    let file = byPath.get(row.path);
    if (file === undefined) {
      file = {
        kind: "ambiguous-link",
        subject: row.id ?? row.path,
        path: row.path,
        // The name a wikilink would write, so the row reads as the file it
        // is about; `path` beneath it says which file that is.
        title: basename(row.path, ".md"),
        linkingKind: row.kind,
        links: [],
      };
      byPath.set(row.path, file);
    }
    // One name written twice in a file is one choice to make, and the
    // match is case-insensitive, so `[[Klinzing]]` and `[[klinzing]]` are
    // the same choice too.
    const written = row.target.toLowerCase();
    if (file.links.some((l) => l.target.toLowerCase() === written)) continue;
    file.links.push({ target: row.target, candidates });
  }
  return [...byPath.values()];
}

/**
 * The pages some Hypothesis names as `promoted_from` (#332; spec #327
 * story 9). A Research Question sharpened into a test has moved on to the
 * testing half, not gone quiet: the row asks "did you drop this?", and the
 * Hypothesis is the answer. Where the link lands is the index's to say, as
 * it is for every `promoted_from` — one that lands nowhere excuses nothing.
 */
function sharpenedIntoHypotheses(index: VaultIndex): Set<string> {
  const named = new Set<string>();
  for (const row of index.select<{ path: string; value: string }>(
    `SELECT f.path, fm.value FROM files f JOIN frontmatter fm USING (path)
     WHERE f.kind = 'hypothesis'`
  )) {
    // The index wrote this JSON; a frontmatter that is not a map is null.
    const from = (JSON.parse(row.value) as Record<string, unknown> | null)?.[
      "promoted_from"
    ];
    const resolvedPath =
      typeof from === "string"
        ? resolvesTo(index, row.path, from.trim())
        : null;
    if (resolvedPath !== null) named.add(resolvedPath);
  }
  return named;
}

/** The two headings a source line can sit under; a link under either is a source. */
const SIDE_HEADINGS = ["Supporting sources", "Opposing sources"];

function stalledResearchQuestions(
  index: VaultIndex,
  days: OpenDays,
  stalledOpenDays: number
): { rows: StalledResearchQuestion[]; problems: string[] } {
  // A source is a link inside one of the two sides' bodies. Unresolved
  // counts: a mistyped citekey is a source that was attached and is worth
  // fixing, which is a different row from never having attached one.
  const fed = new Set(
    index
      .select<{ path: string }>(
        `SELECT DISTINCT l.path FROM links l JOIN headings h ON h.path = l.path
         WHERE h.level = 2 AND h.text IN (?, ?)
           AND l.start >= h.body_start AND l.end <= h.body_end`,
        ...SIDE_HEADINGS
      )
      .map((row) => row.path)
  );
  const sharpened = sharpenedIntoHypotheses(index);
  const rows: StalledResearchQuestion[] = [];
  const problems: string[] = [];
  for (const row of index.select<{
    path: string;
    id: string | null;
    value: string;
  }>(
    `SELECT f.path, f.id, fm.value FROM files f JOIN frontmatter fm USING (path)
     WHERE f.kind = ? ORDER BY f.path`,
    KIND
  )) {
    if (fed.has(row.path) || sharpened.has(row.path)) continue;
    // The page's own reader, not a second reading of the same keys: a
    // status this dashboard accepted and the page refused would be two
    // answers about one file. A file it refuses cannot be judged stalled
    // or not, so it is named rather than dropped.
    let page;
    try {
      page = readResearchQuestion(
        JSON.parse(row.value) as Record<string, unknown>
      );
    } catch (cause) {
      problems.push(`${row.path} could not be read: ${errorMessage(cause)}`);
      continue;
    }
    // A resolved or abandoned pursuit is finished, not stalled. A page with
    // no `promoted:` was never promoted — there is no date to be stalled
    // since, which is an absence rather than a failure.
    if (page.status !== "open" || page.promoted === undefined) continue;
    const from = writtenDay(page.promoted);
    if (from === null) continue;
    // Days the vault was open *since* it was promoted, never days on the
    // calendar. Days before the table existed are not recorded, so a page
    // promoted before then counts from the first day that is — it surfaces
    // late rather than early, which is the safe direction for a row that
    // accuses the user of leaving something alone.
    if (days.since(from) < stalledOpenDays) continue;
    rows.push({
      kind: "stalled-research-question",
      subject: row.id ?? row.path,
      path: row.path,
      title: page.question,
      since: page.promoted,
    });
  }
  return { rows, problems };
}

/**
 * Hypotheses left inconclusive with part of the test unrun (#341; spec
 * #327 stories 81–85). Each is judged by the page's own read — the
 * derivation, the Override, and whether the loop is closed are all the
 * page's, and a second reading of any of them here could list a Hypothesis
 * the page shows as finished.
 *
 * What is selected, and why:
 * - **effective state inconclusive** — supported or falsified is a result,
 *   and a live Override is a considered call, not neglect;
 * - **loop not closed** — a result already written back has been acted on;
 * - **a criterion awaiting evidence, or none written** — *tested and
 *   undecided* is an answer (ADR 0031 decision 8), so a page whose every
 *   criterion carries an Outcome has nothing left to run.
 *
 * Quiet is counted from the newest Position history entry — every change
 * to the claim or a criterion writes one — or `promoted` when there is
 * none, in open days, with the stalled Research Question's threshold.
 */
async function stalledHypotheses(
  index: VaultIndex,
  vaultPath: string,
  days: OpenDays,
  stalledOpenDays: number
): Promise<{ rows: StalledHypothesis[]; problems: string[] }> {
  const rows: StalledHypothesis[] = [];
  const problems: string[] = [];
  for (const file of index.select<{
    path: string;
    id: string | null;
    display: string;
  }>(
    "SELECT path, id, display FROM files WHERE kind = ? ORDER BY path",
    HYPOTHESIS
  )) {
    const page = await readHypothesisPage(index, vaultPath, file.path);
    if (!page.readable) {
      problems.push(`${file.path} could not be read: ${page.reason}`);
      continue;
    }
    const { derivation, loop, sections, frontmatter } = page;
    const { awaiting } = derivation.census;
    const criteria = sections.criteria.criteria.length;
    if (derivation.effective !== "inconclusive") continue;
    if (loop.status === "closed") continue;
    if (criteria > 0 && awaiting === 0) continue;
    // Days compare as written (`writtenDay`), as `promoted` does for the
    // Research Question — and since each is `YYYY-MM-DD`, the string sort
    // is the calendar's. An entry or key with no date to read is no
    // evidence of when it last moved.
    const last = [
      ...sections.positionHistory.entries.map((e) => e.at),
      ...(frontmatter.promoted === undefined ? [] : [frontmatter.promoted]),
    ]
      .map(writtenDay)
      .filter((day): day is string => day !== null)
      .sort()
      .at(-1);
    if (last === undefined) continue;
    const quietOpenDays = days.since(last);
    if (quietOpenDays < stalledOpenDays) continue;
    rows.push({
      kind: "stalled-hypothesis",
      subject: file.id ?? file.path,
      path: file.path,
      title: file.display,
      quietOpenDays,
      criteria,
      awaiting,
    });
  }
  return { rows, problems };
}

/**
 * Both Experiment rows (#374), from one read of each run's page — the
 * page's own reader, so the status, the Artifact lines and the Evidence a
 * row is judged by are the ones the page shows.
 */
async function experimentRows(
  index: VaultIndex,
  vaultPath: string,
  days: OpenDays,
  stalledOpenDays: number,
  machine: string
): Promise<{
  stalled: StalledExperiment[];
  /** Missing, with no recorded falsification resting on the run. */
  missing: MissingArtifacts[];
  /** Missing, under a recorded falsification: Broken plumbing, drawn loud (story 76). */
  missingUnderFalsification: MissingArtifacts[];
  problems: string[];
}> {
  const stalled: StalledExperiment[] = [];
  const missing: MissingArtifacts[] = [];
  const missingUnderFalsification: MissingArtifacts[] = [];
  const problems: string[] = [];
  for (const file of index.select<{
    path: string;
    id: string | null;
    mtime: number | null;
  }>(
    "SELECT path, id, mtime FROM files WHERE kind = ? ORDER BY path",
    EXPERIMENT
  )) {
    const page = await readExperimentPage(index, vaultPath, file.path);
    if (!page.readable) {
      problems.push(`${file.path} could not be read: ${page.reason}`);
      continue;
    }
    const subject = file.id ?? file.path;
    const title = page.frontmatter.name;
    const quiet = quietOpenDays(page, file.mtime, days);
    if (quiet !== null && quiet >= stalledOpenDays) {
      stalled.push({
        kind: "stalled-experiment",
        subject,
        path: file.path,
        title,
        quietOpenDays: quiet,
        artifacts: artifactCount(page),
      });
    }
    const { gone, unchecked } = await missingHere(page, machine);
    for (const { file, reason } of unchecked) {
      problems.push(`${page.path}: ${file} could not be checked: ${reason}`);
    }
    if (gone.length > 0) {
      const falsifying = page.evidence
        .filter(
          ({ criterion }) =>
            criterion.relationship === "falsifying" &&
            criterion.outcome !== null
        )
        .map(({ hypothesis, criterion }) => ({
          path: hypothesis.path,
          claim: hypothesis.claim,
          criterion: criterion.label,
        }));
      (falsifying.length > 0 ? missingUnderFalsification : missing).push({
        kind: "missing-artifact",
        subject,
        path: file.path,
        title,
        missing: gone.map(({ file, target }) => ({ file, target })),
        falsifying,
      });
    }
  }
  return { stalled, missing, missingUnderFalsification, problems };
}

/**
 * How many open days a complete run with Artifacts and empty observations
 * has sat since its file last changed, or null when it is not such a run.
 *
 * The file's modification time, not a Position history entry as the
 * Hypothesis uses: an Artifact added, a *where it ran* line corrected or a
 * status set writes no Revision, and each is the user at the run. Counted
 * in open days from the local date it changed, strictly after, as every
 * quiet period is.
 */
function quietOpenDays(
  page: Extract<ExperimentPage, { readable: true }>,
  mtime: number | null,
  days: OpenDays
): number | null {
  const { status } = page.frontmatter;
  const { observations } = page.sections;
  if (status !== "complete") return null;
  if (artifactCount(page) === 0) return null;
  if (observations.text.trim() !== "") return null;
  if (mtime === null) return null;
  return days.since(localDay(new Date(mtime)));
}

/**
 * Stored and linked lines only: a bullet of neither shape is the user's
 * note — *plots to follow* — and a run holding only that has no result to
 * have left unread.
 */
const artifactCount = (page: Extract<ExperimentPage, { readable: true }>) =>
  page.sections.artifacts.items.filter((item) => item.kind !== "asWritten")
    .length;

/**
 * The run's linked Artifacts recorded on this machine whose paths no
 * longer stat. Only this machine's: a link made on the other Mac is very
 * likely fine there, and a row for it would teach the user to ignore the
 * dashboard (story 77). A URL is never checked — nothing here goes to the
 * network (spec #362 § Out of Scope). Checked when Loose Ends is read and
 * never watched, so a disk unplugged since is noticed on the next visit.
 *
 * Gone is a path that is not there — `ENOENT`, or a folder on the way
 * that is now a file. Any other failure (a folder it may not read) says
 * nothing about whether the file is there, so it is named as unchecked
 * rather than called gone or passed over (no silent failures).
 */
async function missingHere(
  page: Extract<ExperimentPage, { readable: true }>,
  machine: string
): Promise<{
  gone: LinkedArtifact[];
  unchecked: Array<{ file: string; reason: string }>;
}> {
  const linked = page.sections.artifacts.items.filter(
    (item): item is LinkedArtifact =>
      item.kind === "linked" && !linksToUrl(item) && linkedHere(item, machine)
  );
  const gone: LinkedArtifact[] = [];
  const unchecked: Array<{ file: string; reason: string }> = [];
  for (const item of linked) {
    try {
      await stat(item.target);
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") gone.push(item);
      else unchecked.push({ file: item.file, reason: errorMessage(cause) });
    }
  }
  return { gone, unchecked };
}
