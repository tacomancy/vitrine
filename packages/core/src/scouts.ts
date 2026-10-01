import type { DatabaseSync } from "node:sqlite";
import { isTagCharacter, parseTag } from "markdown";
import { stringify } from "yaml";
import { ArxivError, type ArxivClient, type ArxivItem } from "./arxiv.js";
import { VaultError } from "./errors.js";
import type { Events } from "./events.js";
import { readScouts, type Scout } from "./scout-file.js";
import { serialised } from "./serialise.js";
import { citekeyFor, claimStub } from "./sources.js";
import { wikilinkTo } from "./link-text.js";
import type { VaultIndex } from "./vault-index.js";

/**
 * The Scout tables' behaviour (ADR 0016, ADR 0039; `docs/architecture.md`
 * § Scouts): a run asks arXiv for what a Scout's Query matches since it last
 * looked and records every paper as a Proposal, and *accept* turns a
 * Proposal into a Source stub. Nothing here writes to the vault except an
 * accept the researcher made (`CLAUDE.md` § Invariants).
 */

export type ScoutDeps = {
  vaultPath: string;
  index: VaultIndex;
  queue: DatabaseSync;
  arxiv: ArxivClient;
  events: Events;
  now: () => Date;
};

export type RunSummary = {
  runId: number;
  outcome: "ok" | "failed";
  errorKind: ArxivError["kind"] | null;
  fetched: number;
  new: number;
  held: number;
  /** How many more matched than the ceiling let through; 0 when the run was not cut. */
  truncated: number;
};

const iso = (date: Date) => date.toISOString();

/**
 * Run one Scout now, due or not (*Run now*). The window opens where the last
 * *clean* run's closed — a failed run never advances it, so the next attempt
 * re-covers the same days and identity by `arxiv_id` makes the overlap
 * harmless — and the first run opens at the Scout's creation, or at its
 * *search back to* date, whose finds are Retroactive (ADR 0016 decision 5).
 */
export async function runScout(
  deps: ScoutDeps,
  scoutId: string
): Promise<RunSummary> {
  const { queue, arxiv, events } = deps;
  const { scouts } = await readScouts(deps.vaultPath);
  const scout = scouts.find((s) => s.id === scoutId);
  if (scout === undefined) {
    throw new VaultError("refused", `There is no Scout named ${scoutId}.`);
  }
  const now = deps.now();
  const last = queue
    .prepare(
      "SELECT window_to FROM scout_runs WHERE scout_id = ? AND outcome = 'ok' ORDER BY id DESC LIMIT 1"
    )
    .get(scoutId) as { window_to: string } | undefined;
  const from =
    last !== undefined
      ? new Date(last.window_to)
      : scout.searchBackTo !== null && scout.searchBackTo < scout.created
        ? scout.searchBackTo
        : scout.created;
  const retroactive = last === undefined && from < scout.created;
  const runId = Number(
    queue
      .prepare(
        "INSERT INTO scout_runs (scout_id, started, window_from, window_to, retroactive) VALUES (?, ?, ?, ?, ?)"
      )
      .run(scoutId, iso(now), iso(from), iso(now), retroactive ? 1 : 0)
      .lastInsertRowid
  );

  let summary: RunSummary;
  try {
    const found = await arxiv.search(scout.query, { from, to: now });
    // One transaction: a failure part-way must not leave Proposals behind
    // that the next run, finding them known, would not count as new.
    queue.exec("BEGIN");
    let arrived: { new: number; held: number };
    try {
      arrived = arrive(deps, scout, runId, found.items);
      queue.exec("COMMIT");
    } catch (cause) {
      queue.exec("ROLLBACK");
      throw cause;
    }
    queue
      .prepare(
        "UPDATE scout_runs SET finished = ?, outcome = 'ok', fetched = ?, new = ?, held = ?, truncated = ? WHERE id = ?"
      )
      .run(
        iso(deps.now()),
        found.items.length,
        arrived.new,
        arrived.held,
        found.moreMatched,
        runId
      );
    summary = {
      runId,
      outcome: "ok",
      errorKind: null,
      fetched: found.items.length,
      ...arrived,
      truncated: found.moreMatched,
    };
  } catch (cause) {
    // Only what the client names is an arXiv fault; anything else is a bug
    // in this module and must not be filed as "arXiv's answer did not read".
    if (!(cause instanceof ArxivError)) {
      queue
        .prepare("DELETE FROM scout_runs WHERE id = ? AND finished IS NULL")
        .run(runId);
      throw cause;
    }
    queue
      .prepare(
        "UPDATE scout_runs SET finished = ?, outcome = 'failed', error_kind = ?, error_message = ? WHERE id = ?"
      )
      .run(iso(deps.now()), cause.kind, cause.message, runId);
    summary = {
      runId,
      outcome: "failed",
      errorKind: cause.kind,
      fetched: 0,
      new: 0,
      held: 0,
      truncated: 0,
    };
  }
  events.emit({ type: "scoutFinished", scoutId, runId });
  return summary;
}

/**
 * Record what a run found. A paper the Scout (or another) has seen before is
 * a new *Appearance* on the same card, never a second card (ADR 0016
 * decision 7); one the vault already holds is stored `held` and never
 * becomes a card (ADR 0039 decision 1).
 */
function arrive(
  deps: ScoutDeps,
  scout: Scout,
  runId: number,
  items: ArxivItem[]
): { new: number; held: number } {
  const { queue } = deps;
  const at = iso(deps.now());
  const known = queue.prepare("SELECT id FROM proposals WHERE source_key = ?");
  const insert = queue.prepare(
    `INSERT INTO proposals (source_key, doi, title, authors, published, venue, abstract, url, lane, state, first_seen, stub_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const appear = queue.prepare(
    "INSERT OR IGNORE INTO appearances (proposal_id, run_id, scout_id, seen_at, url) VALUES (?, ?, ?, ?, ?)"
  );
  const vaultHas = heldIn(deps.index);
  let fresh = 0;
  let held = 0;
  for (const item of items) {
    const key = `arxiv:${item.arxivId}`;
    let id = (known.get(key) as { id: number } | undefined)?.id;
    if (id === undefined) {
      const heldBy = vaultHas(key, item.doi);
      id = Number(
        insert.run(
          key,
          item.doi,
          item.title,
          JSON.stringify(item.authors),
          item.published,
          item.venue,
          item.abstract,
          item.url,
          scout.lane,
          heldBy === null ? "pending" : "held",
          at,
          heldBy
        ).lastInsertRowid
      );
      if (heldBy === null) fresh++;
      else held++;
    }
    appear.run(id, runId, scout.id, at, item.url);
  }
  return { new: fresh, held };
}

/**
 * The vault's own DOIs and arXiv-normalised URLs, and the file each belongs
 * to. Exact on the key, never fuzzy on a title: a false positive hides a new
 * paper, and the only warrant for hiding one is an identical key (ADR 0039
 * decision 1).
 */
function heldIn(
  index: VaultIndex
): (key: string, doi: string | null) => string | null {
  const keys = new Map<string, string>();
  for (const row of index.select<{ path: string; value: string }>(
    `SELECT f.path, fm.value FROM files f JOIN frontmatter fm USING (path)
      WHERE f.kind IN ('source', 'source-stub') ORDER BY f.path DESC`
  )) {
    const found = JSON.parse(row.value) as Record<string, unknown> | null;
    for (const key of keysOf(found?.["doi"], found?.["url"])) {
      keys.set(key, row.path);
    }
  }
  return (key, doi) => {
    for (const wanted of keysOf(doi, undefined, key)) {
      const path = keys.get(wanted);
      if (path !== undefined) return path;
    }
    return null;
  };
}

/** `doi:` and `arxiv:` keys a paper answers to; arXiv's own DOI namespace is the arXiv id. */
function keysOf(doi: unknown, url: unknown, key?: string): string[] {
  const keys: string[] = key === undefined ? [] : [key];
  if (typeof doi === "string" && doi.trim() !== "") {
    const bare = doi
      .trim()
      .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "")
      .toLowerCase();
    keys.push(`doi:${bare}`);
    const inArxiv = /^10\.48550\/arxiv\.(.+)$/.exec(bare);
    if (inArxiv?.[1] !== undefined) keys.push(`arxiv:${inArxiv[1]}`);
  }
  if (typeof url === "string") {
    const abs =
      /^https?:\/\/(?:www\.|export\.)?arxiv\.org\/(?:abs|pdf)\/(.+?)(?:v\d+)?(?:\.pdf)?\/?$/i.exec(
        url.trim()
      );
    if (abs?.[1] !== undefined) keys.push(`arxiv:${abs[1]}`);
  }
  return keys;
}

/** What the Queue draws: a Proposal and why it is here. Missing fields are `null`, never guessed. */
export type Card = {
  id: number;
  title: string;
  authors: string[];
  published: string;
  /** `null` is shown as missing; keywords are never supplied by arXiv and so are not on the card at all. */
  venue: string | null;
  abstract: string;
  url: string;
  doi: string | null;
  lane: "review" | "skim";
  /** Every Scout that found it, with the Questions it is assigned to; the card says *assigned to*, never *matches*. */
  scouts: Array<{
    id: string;
    name: string;
    assigned: Array<{ id: string; name: string | null }>;
  }>;
  retroactive: boolean;
};

type ProposalRow = {
  id: number;
  source_key: string;
  doi: string | null;
  title: string;
  authors: string;
  published: string;
  venue: string | null;
  abstract: string;
  url: string;
  lane: "review" | "skim";
  state: string;
  stub_path: string | null;
};

/** Pending Proposals, newest first seen first: the stack, one card in hand and the rest behind it. */
export async function readQueue(deps: ScoutDeps): Promise<Card[]> {
  const { queue, index } = deps;
  const { scouts } = await readScouts(deps.vaultPath);
  const byId = new Map(scouts.map((s) => [s.id, s]));
  const rows = queue
    .prepare(
      "SELECT * FROM proposals WHERE state = 'pending' ORDER BY first_seen DESC, id DESC"
    )
    .all() as ProposalRow[];
  const seen = queue.prepare(
    `SELECT DISTINCT a.scout_id, a.run_id, r.retroactive FROM appearances a
       JOIN scout_runs r ON r.id = a.run_id
      WHERE a.proposal_id = ? ORDER BY a.run_id`
  );
  return rows.map((row) => {
    const appearances = seen.all(row.id) as Array<{
      scout_id: string;
      retroactive: number;
    }>;
    const scoutIds = [...new Set(appearances.map((a) => a.scout_id))];
    return {
      id: row.id,
      title: row.title,
      authors: JSON.parse(row.authors) as string[],
      published: row.published,
      venue: row.venue,
      abstract: row.abstract,
      url: row.url,
      doi: row.doi,
      lane: row.lane,
      scouts: scoutIds.flatMap((id) => {
        const scout = byId.get(id);
        return scout === undefined
          ? []
          : [
              {
                id,
                name: scout.name,
                assigned: scout.assigned.map((q) => ({
                  id: q,
                  name: questionFile(index, q)?.display ?? null,
                })),
              },
            ];
      }),
      retroactive: appearances[0]?.retroactive === 1,
    };
  });
}

function questionFile(
  index: VaultIndex,
  id: string
): { path: string; display: string } | null {
  const [found] = index.select<{ path: string; display: string }>(
    "SELECT path, display FROM files WHERE id = ?",
    id
  );
  return found ?? null;
}

export type Accepted = {
  /** The stub's vault-relative path: the one just written, or the one the vault already held. */
  path: string;
  /** True when the vault already held the work and nothing was written. */
  held: boolean;
};

// An accept is read, check, write and record; two for one Proposal that
// overlapped would both pass the guard and write the stub twice. The queue
// is here, in the function, never in a caller that must remember it.
const accepting = serialised();

/**
 * Accept a Proposal into a Source stub. The held guard is inside this
 * function so that no caller can skip it: before the write, the Proposal's
 * key is matched exactly against the vault's DOIs and arXiv-normalised URLs,
 * and a match writes nothing — which is also how a stub orphaned by a crash
 * between the write and the row is *adopted* instead of duplicated under a
 * suffixed name (ADR 0039 decision 1).
 */
export function acceptProposal(
  deps: ScoutDeps,
  proposalId: number
): Promise<Accepted> {
  return accepting(async () => {
    const { queue, index, vaultPath } = deps;
    const row = queue
      .prepare("SELECT * FROM proposals WHERE id = ?")
      .get(proposalId) as ProposalRow | undefined;
    if (row === undefined) {
      throw new VaultError("refused", "That Proposal is gone.");
    }
    if (row.stub_path !== null) {
      return { path: row.stub_path, held: row.state === "held" };
    }
    if (row.state === "rejected") {
      throw new VaultError("refused", "That Proposal was rejected.");
    }
    const heldBy = heldIn(index)(row.source_key, row.doi);
    if (heldBy !== null) {
      queue
        .prepare(
          "UPDATE proposals SET state = 'held', stub_path = ? WHERE id = ?"
        )
        .run(heldBy, row.id);
      return { path: heldBy, held: true };
    }

    const { scouts } = await readScouts(vaultPath);
    const first = queue
      .prepare(
        `SELECT a.scout_id, r.retroactive FROM appearances a
           JOIN scout_runs r ON r.id = a.run_id
          WHERE a.proposal_id = ? ORDER BY a.run_id LIMIT 1`
      )
      .get(row.id) as { scout_id: string; retroactive: number } | undefined;
    const urls = (
      queue
        .prepare(
          "SELECT DISTINCT url FROM appearances WHERE proposal_id = ? ORDER BY rowid"
        )
        .all(row.id) as Array<{ url: string }>
    ).map((a) => a.url);
    const involved = [
      ...new Set(
        (
          queue
            .prepare(
              "SELECT scout_id FROM appearances WHERE proposal_id = ? ORDER BY rowid"
            )
            .all(row.id) as Array<{ scout_id: string }>
        ).map((a) => a.scout_id)
      ),
    ];
    const assigned = involved.flatMap(
      (id) => scouts.find((s) => s.id === id)?.assigned ?? []
    );
    const authors = JSON.parse(row.authors) as string[];
    const year = String(new Date(row.published).getUTCFullYear());
    const stub = await claimStub(
      vaultPath,
      index,
      citekeyFor({ authors: authors.join(";"), year, title: row.title }),
      (citekey) =>
        stubText(
          citekey,
          row,
          authors,
          year,
          first?.scout_id,
          [...new Set(assigned)].map((q) => {
            const file = questionFile(index, q);
            // An id that resolves to nothing is written as it stands: dropping
            // it would lose which Question the Scout was for.
            return file === null
              ? q
              : wikilinkTo(index, `sources/${citekey}.md`, file.path);
          }),
          first?.retroactive === 1,
          urls
        )
    );
    queue
      .prepare(
        "UPDATE proposals SET state = 'accepted', stub_path = ? WHERE id = ?"
      )
      .run(stub.path, row.id);
    queue
      .prepare(
        "INSERT INTO triage (proposal_id, action, at) VALUES (?, 'accept', ?)"
      )
      .run(row.id, iso(deps.now()));
    return { path: stub.path, held: false };
  });
}

/** Plain where YAML allows it, quoted by `yaml` where it does not. */
const plain = (value: string) => stringify(value, { lineWidth: 0 }).trim();

/**
 * The stub's bytes: the keys § Vault layout lists, in its order, and none
 * the source did not supply. `venue` is present only when arXiv gave a
 * `journal_ref`; `year` is the UTC year of first submission; `keywords` are
 * never written; `origin_retroactive` only when true.
 */
function stubText(
  citekey: string,
  row: ProposalRow,
  authors: string[],
  year: string,
  scout: string | undefined,
  questions: string[],
  retroactive: boolean,
  urls: string[]
): string {
  const lines = [
    "---",
    "kind: source-stub",
    `citekey: ${citekey}`,
    `title: ${plain(row.title)}`,
  ];
  if (authors.length > 0) {
    lines.push("authors:", ...authors.map((a) => `  - ${plain(a)}`));
  }
  lines.push(`year: ${year}`);
  if (row.venue !== null) lines.push(`venue: ${plain(row.venue)}`);
  if (row.doi !== null) lines.push(`doi: ${plain(row.doi)}`);
  lines.push(`url: ${plain(row.url)}`);
  if (scout !== undefined) lines.push(`origin_scout: ${plain(scout)}`);
  if (questions.length > 0) {
    lines.push("origin_question:", ...questions.map((q) => `  - ${plain(q)}`));
  }
  if (retroactive) lines.push("origin_retroactive: true");
  lines.push("appearances:", ...urls.map((u) => `  - ${plain(u)}`));
  lines.push("---");
  for (const line of escapeThirdParty(row.abstract).split("\n")) {
    lines.push(line === "" ? ">" : `> ${line}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Third-party text becomes Markdown structure unless escaped, so an abstract
 * is written verbatim apart from a backslash before a `#` that would begin a
 * tag and before `[[` and `]]` (which also defuses `![[`) — otherwise an
 * abstract grows phantom tags or unresolved links nobody wrote. What counts
 * as a tag is `markdown`'s own rule, so this cannot drift from what the index
 * would find.
 */
export function escapeThirdParty(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("[[", i) || text.startsWith("]]", i)) {
      out += `\\${text.slice(i, i + 2)}`;
      i += 2;
    } else if (text[i] === "#" && beginsTag(text, i)) {
      out += "\\#";
      i++;
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

function beginsTag(text: string, at: number): boolean {
  const before = at === 0 ? undefined : text.charCodeAt(at - 1);
  if (before !== undefined && isTagCharacter(before)) return false;
  let end = at + 1;
  while (end < text.length && isTagCharacter(text.charCodeAt(end))) end++;
  return "canonical" in parseTag(text.slice(at + 1, end));
}
