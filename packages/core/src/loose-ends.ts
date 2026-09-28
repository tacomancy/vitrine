import { basename } from "node:path";
import { dismissed, readDismissals } from "./dismissals.js";
import { errorMessage } from "./errors.js";
import { KIND as HYPOTHESIS, readHypothesisPage } from "./hypothesis.js";
import { resolvesTo } from "./link-text.js";
import { writtenDay, type OpenDays } from "./open-days.js";
import { KIND, readResearchQuestion } from "./research-question.js";
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

export type LooseEndRow =
  StalledResearchQuestion | StalledHypothesis | AmbiguousLinks;

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
};

export async function looseEnds(
  index: VaultIndex,
  vaultPath: string,
  { days, stalledOpenDays }: LooseEndsOptions
): Promise<LooseEnds> {
  const { dismissals, problem } = await readDismissals(vaultPath);
  const stalled = stalledResearchQuestions(index, days, stalledOpenDays);
  const quiet = await stalledHypotheses(
    index,
    vaultPath,
    days,
    stalledOpenDays
  );
  const byGroup: Record<LooseEndGroupName, LooseEndRow[]> = {
    "Broken plumbing": [],
    "Unfinished reading": [],
    "Disconnected material": ambiguousLinks(index),
    "Stalled questions": [...stalled.rows, ...quiet.rows],
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
      ...stalled.problems,
      ...quiet.problems,
    ],
  };
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
    // Research Question; an entry or key with no date to read is no
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
