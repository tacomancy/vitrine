import { dismissed, readDismissals } from "./dismissals.js";
import { errorMessage } from "./errors.js";
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

export type LooseEndRow = StalledResearchQuestion;

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
  const rows = stalled.rows.filter(
    (row) => !dismissed(dismissals, row.subject, row.kind)
  );
  const byGroup: Record<LooseEndGroupName, LooseEndRow[]> = {
    "Broken plumbing": [],
    "Unfinished reading": [],
    "Disconnected material": [],
    "Stalled questions": rows,
  };
  return {
    groups: GROUPS.filter((group) => byGroup[group].length > 0).map(
      (group) => ({ group, rows: byGroup[group] })
    ),
    problems: [...(problem === null ? [] : [problem]), ...stalled.problems],
  };
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
    if (fed.has(row.path)) continue;
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
