import { dismissed, readDismissals } from "./dismissals.js";
import { KIND } from "./research-question.js";
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

export type LooseEndGroup = (typeof GROUPS)[number];

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

export type LooseEndsGroup = { group: LooseEndGroup; rows: LooseEndRow[] };

export type LooseEnds = {
  /** Only the groups with rows, in `GROUPS` order. */
  groups: LooseEndsGroup[];
  /** Why the dashboard may be showing rows it was told to silence; null when it is not. */
  problem: string | null;
};

/**
 * How long a Research Question may sit unsourced before it is stalled
 * (§ Loose Ends). A number in code, as the spec has it — a setting would
 * make the user responsible for a judgement the app is making.
 */
export const STALLED_MS = 14 * 24 * 60 * 60 * 1000;

export type LooseEndsOptions = {
  now: Date;
  /** Tests shorten it; the app uses `STALLED_MS`. */
  stalledMs: number;
};

export async function looseEnds(
  index: VaultIndex,
  vaultPath: string,
  { now, stalledMs }: LooseEndsOptions
): Promise<LooseEnds> {
  const { dismissals, problem } = await readDismissals(vaultPath);
  const rows = stalledResearchQuestions(index, now, stalledMs).filter(
    (row) => !dismissed(dismissals, row.subject, row.kind)
  );
  const byGroup: Record<LooseEndGroup, LooseEndRow[]> = {
    "Broken plumbing": [],
    "Unfinished reading": [],
    "Disconnected material": [],
    "Stalled questions": rows,
  };
  return {
    groups: GROUPS.filter((group) => byGroup[group].length > 0).map(
      (group) => ({ group, rows: byGroup[group] })
    ),
    problem,
  };
}

/** The two headings a source line can sit under; a link under either is a source. */
const SIDE_HEADINGS = ["Supporting sources", "Opposing sources"];

function stalledResearchQuestions(
  index: VaultIndex,
  now: Date,
  stalledMs: number
): StalledResearchQuestion[] {
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
    const fm = JSON.parse(row.value) as Record<string, unknown>;
    // A missing `status:` is open, as the page reader has it; a resolved or
    // abandoned pursuit is finished, not stalled.
    if (fm["status"] !== undefined && fm["status"] !== "open") continue;
    const promoted = fm["promoted"];
    const question = fm["question"];
    if (typeof promoted !== "string" || typeof question !== "string") continue;
    const at = Date.parse(promoted);
    if (Number.isNaN(at) || now.getTime() - at < stalledMs) continue;
    rows.push({
      kind: "stalled-research-question",
      subject: row.id ?? row.path,
      path: row.path,
      title: question,
      since: promoted,
    });
  }
  return rows;
}
