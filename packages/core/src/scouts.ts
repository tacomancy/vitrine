import type { DatabaseSync } from "node:sqlite";
import { isTagCharacter, parseTag } from "markdown";
import { stringify } from "yaml";
import { ArxivError, type ArxivClient } from "./arxiv.js";
import {
  readWatched,
  WatchedError,
  type Arrival,
  type RunFacts,
  type WatchedDeps,
} from "./watched.js";
import { finishedRunsAtPage, type RunErrorKind } from "./scout-health.js";
import { VaultError } from "./errors.js";
import type { Events } from "./events.js";
import {
  DEFAULT_SKIM_DAYS,
  readScouts,
  scoutIdOf,
  type Scout,
} from "./scout-file.js";
import { serialised } from "./serialise.js";
import { citekeyFor, claimStub } from "./sources.js";
import { wikilinkTo } from "./link-text.js";
import { inTransaction, returnDeferred } from "./triage.js";
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
  /** What reading a page needs: fetch, model and key (ADR 0017). */
  watched: WatchedDeps;
  events: Events;
  now: () => Date;
};

export type RunSummary = {
  runId: number;
  outcome: "ok" | "failed";
  errorKind: RunErrorKind | null;
  fetched: number;
  new: number;
  held: number;
  /** Cards the model returned that the page did not bear out; always 0 for arXiv. */
  unverified: number;
  /** How many more matched than the ceiling let through; 0 when the run was not cut. */
  truncated: number;
};

const iso = (date: Date) => date.toISOString();

/** A clean run that asked the Scout's current page; a run from before the column (no page) is taken as belonging, as in `finishedRunsAtPage`. */
function hasCleanRunAtPage(queue: DatabaseSync, scout: Scout): boolean {
  return (
    queue
      .prepare(
        "SELECT 1 FROM scout_runs WHERE scout_id = ? AND outcome = 'ok' AND (query IS NULL OR query = ?) LIMIT 1"
      )
      .get(scout.id, scout.query) !== undefined
  );
}

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
  const watched = scout.source.kind === "watched";
  // A page has no date window: "new" is an unseen `source_key`, so its first
  // run proposes everything the page lists, all Retroactive (spec #463).
  const from = watched
    ? now
    : last !== undefined
      ? new Date(last.window_to)
      : scout.searchBackTo !== null && scout.searchBackTo < scout.created
        ? scout.searchBackTo
        : scout.created;
  // A page's first look is the first run *at that page* (ADR 0043 d.3): a
  // Scout pointed elsewhere has runs, none here, and what it finds is as new
  // to the researcher as a first Scout's. Pointed back at a page it has read,
  // those runs count again, so that is no first look.
  const retroactive = watched
    ? !hasCleanRunAtPage(queue, scout)
    : last === undefined && from < scout.created;
  const runId = Number(
    queue
      .prepare(
        "INSERT INTO scout_runs (scout_id, started, window_from, window_to, retroactive, query) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        scoutId,
        iso(now),
        iso(from),
        iso(now),
        retroactive ? 1 : 0,
        scout.query
      ).lastInsertRowid
  );

  let summary: RunSummary;
  try {
    const read =
      scout.source.kind === "watched"
        ? await readWatched(deps.watched, queue, {
            id: scout.id,
            url: scout.source.url,
          })
        : await readArxiv(arxiv, scout.query, from, now);
    // One transaction: a failure part-way must not leave Proposals behind
    // that the next run, finding them known, would not count as new.
    const arrived = inTransaction(queue, () => {
      const arrived = arrive(deps, scout, runId, read.items);
      // A clean run is the moment a deferral ends (ADR 0016 decision 8).
      returnDeferred(deps, scout.id);
      return arrived;
    });
    record(queue, runId, read.facts);
    queue
      .prepare(
        "UPDATE scout_runs SET finished = ?, outcome = 'ok', fetched = ?, new = ?, held = ?, truncated = ? WHERE id = ?"
      )
      .run(
        iso(deps.now()),
        read.fetched,
        arrived.new,
        arrived.held,
        read.moreMatched,
        runId
      );
    summary = {
      runId,
      outcome: "ok",
      errorKind: null,
      fetched: read.fetched,
      ...arrived,
      unverified: read.facts?.unverified ?? 0,
      truncated: read.moreMatched,
    };
  } catch (cause) {
    // Only what a source names is its fault; anything else is a bug in this
    // module and must not be filed as "the answer did not read".
    if (!(cause instanceof ArxivError || cause instanceof WatchedError)) {
      queue
        .prepare("DELETE FROM scout_runs WHERE id = ? AND finished IS NULL")
        .run(runId);
      throw cause;
    }
    if (cause instanceof WatchedError) record(queue, runId, cause.facts);
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
      unverified:
        cause instanceof WatchedError ? (cause.facts.unverified ?? 0) : 0,
      truncated: 0,
    };
  }
  events.emit({ type: "scoutFinished", scoutId, runId });
  return summary;
}

export type WaitingScout = { id: string; name: string; message: string };

/**
 * The Scouts whose newest run stopped for want of a usable key — *no key* and
 * *key rejected* both, since Settings names both (ADR 0040 decision 1). Read
 * from the run rows, never the Keychain, so it cannot disagree with the
 * Scout's own Voice. A paused Scout is not waiting on anything: it has been
 * told to stop, and a key must not start it. Watched Scouts are the only ones
 * that use a Provider, and there is one.
 */
export async function waitingOnKey(deps: {
  vaultPath: string;
  queue: DatabaseSync;
}): Promise<WaitingScout[]> {
  const { scouts } = await readScouts(deps.vaultPath);
  const newestRow = deps.queue.prepare(
    "SELECT finished FROM scout_runs WHERE scout_id = ? ORDER BY id DESC LIMIT 1"
  );
  return scouts.flatMap((scout) => {
    if (scout.paused || scout.source.kind !== "watched") return [];
    // A newest run still going is its own answer to being due. Past that, only a run
    // at the page the Scout watches now can leave it waiting: one refused at
    // the old page says nothing of the new one, whose first look is still to
    // come (ADR 0043 d.2) — so this agrees with the Voice.
    const newest = newestRow.get(scout.id) as
      { finished: string | null } | undefined;
    if (newest !== undefined && newest.finished === null) return [];
    const run = finishedRunsAtPage(deps.queue, scout).at(-1);
    return run?.error_kind === "credentials"
      ? [{ id: scout.id, name: scout.name, message: run.error_message ?? "" }]
      : [];
  });
}

// Storing a key and a passing test can arrive together; each must see the
// other's runs as done, so the second finds nothing left waiting. The queue
// is here, in the function, and not in the two procedures that call it.
const starting = serialised();

/**
 * Run every Scout waiting on the key, at once, overriding the wait the hourly
 * check would otherwise leave them in (ADR 0040 decision 2). It is the
 * callee's job so that no caller — Settings or anything after it — can store
 * a key and forget to start what was waiting. A Scout that throws does not
 * stop the ones behind it, and Scouts that cannot be listed start none
 * without failing the key.
 */
export function runWaiting(deps: ScoutDeps): Promise<string[]> {
  return starting(async () => {
    const ran: string[] = [];
    let waiting: WaitingScout[];
    try {
      waiting = await waitingOnKey(deps);
    } catch (cause) {
      // The key is stored and it works, and whoever stored it is not told it
      // failed because the Scouts could not be listed. Which were waiting is
      // not known, so none start; the Scout surfaces state the folder's fault
      // for themselves, as they do for every other read of it.
      if (!(cause instanceof VaultError)) throw cause;
      console.error(
        `vitrine-core: no Scout started for the key: ${cause.message}`
      );
      return ran;
    }
    for (const { id } of waiting) {
      try {
        await runScout(deps, id);
        ran.push(id);
      } catch (cause) {
        console.error(
          `vitrine-core: Scout ${id} failed to run: ${cause instanceof Error ? cause.message : String(cause)}`
        );
      }
    }
    return ran;
  });
}

async function readArxiv(
  arxiv: ArxivClient,
  query: string,
  from: Date,
  to: Date
): Promise<{
  items: Arrival[];
  moreMatched: number;
  fetched: number;
  facts?: undefined;
}> {
  const found = await arxiv.search(query, { from, to });
  return {
    items: found.items.map((item) => ({
      key: `arxiv:${item.arxivId}`,
      doi: item.doi,
      title: item.title,
      authors: item.authors,
      published: item.published,
      venue: item.venue,
      abstract: item.abstract,
      url: item.url,
    })),
    moreMatched: found.moreMatched,
    fetched: found.items.length,
  };
}

/** What a model-read run spent and saw, written whether it ended clean or not: a failed extraction still cost tokens. */
function record(
  queue: DatabaseSync,
  runId: number,
  facts: Partial<RunFacts> | undefined
): void {
  if (facts === undefined) return;
  queue
    .prepare(
      `UPDATE scout_runs SET model = ?, input_tokens = ?, output_tokens = ?, cache_read_tokens = ?,
              cost_usd = ?, page_hash = ?, page_length = ?, page_capped = ?, unverified = ? WHERE id = ?`
    )
    .run(
      facts.model ?? null,
      facts.usage?.input ?? null,
      facts.usage?.output ?? null,
      facts.usage?.cacheRead ?? null,
      facts.costUsd ?? null,
      facts.pageHash ?? null,
      facts.pageLength ?? null,
      facts.capped === true ? 1 : 0,
      facts.unverified ?? 0,
      runId
    );
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
  items: Arrival[]
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
  const isSkimPending = queue.prepare(
    "SELECT 1 FROM proposals WHERE id = ? AND lane = 'skim' AND state = 'pending'"
  );
  const otherScout = queue.prepare(
    "SELECT 1 FROM appearances WHERE proposal_id = ? AND scout_id <> ?"
  );
  const raise = queue.prepare(
    "UPDATE proposals SET lane = 'review' WHERE id = ?"
  );
  const logRaise = queue.prepare(
    "INSERT INTO triage (proposal_id, action, at) VALUES (?, 'raise', ?)"
  );
  const vaultHas = heldIn(deps.index);
  let fresh = 0;
  let held = 0;
  for (const item of items) {
    const key = item.key;
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
    // Corroboration crosses Lanes: a Skim line a second Scout also finds has
    // been independently found, which is what Review is for (ADR 0044
    // decision 8). A `raise` row, like a `promote`, keeps it out of Accept
    // rate. Checked before this Appearance is written, so it asks whether
    // another Scout was already there.
    if (
      id !== undefined &&
      (isSkimPending.get(id) as object | undefined) !== undefined &&
      (otherScout.get(id, scout.id) as object | undefined) !== undefined
    ) {
      raise.run(id);
      logRaise.run(id, at);
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
    /** A Scout the researcher retired: its Proposals stay in Review under its name, marked, until they are triaged (ADR 0042 decision 1). */
    dropped: boolean;
  }>;
  retroactive: boolean;
  /**
   * The Rank signals that fired for this card, and nothing for one that had
   * none (ADR 0044 decision 2). Review only; Skim is not ranked.
   */
  signals: RankSignal[];
  /**
   * Why the card is in this Lane when it did not arrive there: the Lane move
   * is a triage row, and the card says so rather than leave it a surprise
   * (ADR 0044 decision 8). `null` when it is where its Scout put it, or where
   * the researcher put it by hand.
   */
  moved: LaneMove | null;
};

export type LaneMove =
  { kind: "demoted" } | { kind: "raised"; by: { id: string; name: string } };

export type RankSignal =
  | { kind: "authors"; names: string[] }
  | { kind: "corroboration"; scouts: number }
  | { kind: "questions"; count: number };

/** Review's sort: Rank by default, or `newest` for the order the stack has always had. */
export type QueueSort = "rank" | "newest";

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

/**
 * Review's pending Proposals: the stack, one card in hand and the rest behind
 * it. Ranked by default; `newest` is first seen first. The sort reorders and
 * never filters, so nothing a sort puts last is out of reach (ADR 0044).
 */
export async function readQueue(
  deps: ScoutDeps,
  sort: QueueSort = "rank"
): Promise<Card[]> {
  const cards = await readCards(deps, "review");
  if (sort === "newest") return cards;
  // `readCards` is newest first and Array#sort is stable, so the final
  // tie-break (newest) is the order already there.
  return cards.sort((a, b) => byRank(b, a));
}

/** The order of this tuple is the precedence of Rank (ADR 0044 decision 2): accepted-work authors, then Corroboration, then Assigned Questions. */
function rankTuple(card: Card): [number, number, number] {
  let authors = 0;
  let scouts = 0;
  let questions = 0;
  for (const signal of card.signals) {
    if (signal.kind === "authors") authors = signal.names.length;
    else if (signal.kind === "corroboration") scouts = signal.scouts;
    else questions = signal.count;
  }
  return [authors, scouts, questions];
}

/** Ascending by Rank; the caller flips the arguments for best-first. */
function byRank(a: Card, b: Card): number {
  const [x, y] = [rankTuple(a), rankTuple(b)];
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return x[i]! - y[i]!;
  }
  return 0;
}

/**
 * Skim: `lane = skim`, newest first, split at the Scout's `skim_days` (30 when
 * the file does not say) — older lines sit behind *show older* and nothing is
 * deleted (ADR 0016 decision 6; ADR 0044 d.11). A promoted line has
 * left for Review (its lane is rewritten), and an accepted one is a stub, so
 * what remains is only what the researcher has not touched.
 */
export async function readSkim(
  deps: ScoutDeps
): Promise<{ recent: Card[]; older: Card[] }> {
  const lines = await readCards(deps, "skim");
  const { scouts, dropped } = await readScouts(deps.vaultPath);
  const skimDays = new Map(
    [...scouts, ...dropped].map((s) => [s.id, s.skimDays])
  );
  // The Scout that placed the line (its first Appearance) owns its cutoff; a
  // line whose Scout is gone from the vault gets the default.
  const now = deps.now().getTime();
  const cutoffOf = (line: Card) =>
    now -
    (skimDays.get(line.scouts[0]?.id ?? "") ?? DEFAULT_SKIM_DAYS) * 86_400_000;
  const stamps = new Map(
    (
      deps.queue
        .prepare("SELECT id, first_seen FROM proposals WHERE lane = 'skim'")
        .all() as Array<{ id: number; first_seen: string }>
    ).map((row) => [row.id, Date.parse(row.first_seen)])
  );
  const isOlder = (line: Card) => (stamps.get(line.id) ?? 0) < cutoffOf(line);
  return {
    recent: lines.filter((line) => !isOlder(line)),
    older: lines.filter(isOlder),
  };
}

async function readCards(
  deps: ScoutDeps,
  lane: "review" | "skim"
): Promise<Card[]> {
  const { queue, index } = deps;
  const { scouts, dropped } = await readScouts(deps.vaultPath);
  // A dropped Scout is not in `scouts` and the rail does not list it, but its
  // Proposals stay in Review under its name, so the card has to know it.
  const byId = new Map([...scouts, ...dropped].map((s) => [s.id, s]));
  // Only Review is ranked, so only Review reads the vault's accepted authors.
  const accepted = lane === "review" ? acceptedAuthors(index) : null;
  const rows = queue
    .prepare(
      "SELECT * FROM proposals WHERE state = 'pending' AND lane = ? ORDER BY first_seen DESC, id DESC"
    )
    .all(lane) as ProposalRow[];
  const seen = queue.prepare(
    `SELECT DISTINCT a.scout_id, a.run_id, r.retroactive FROM appearances a
       JOIN scout_runs r ON r.id = a.run_id
      WHERE a.proposal_id = ? ORDER BY a.run_id`
  );
  const lastMove = queue.prepare(
    "SELECT action FROM triage WHERE proposal_id = ? AND action IN ('promote', 'demote', 'raise') ORDER BY rowid DESC LIMIT 1"
  );
  return rows.map((row) => {
    const appearances = seen.all(row.id) as Array<{
      scout_id: string;
      retroactive: number;
    }>;
    const scoutIds = [...new Set(appearances.map((a) => a.scout_id))];
    const authors = JSON.parse(row.authors) as string[];
    const questions = new Set(
      scoutIds.flatMap((id) => byId.get(id)?.assigned ?? [])
    );
    const signals: RankSignal[] = [];
    if (accepted !== null) {
      const known = authors.filter((name) => accepted.has(authorKey(name)));
      if (known.length > 0) signals.push({ kind: "authors", names: known });
      if (scoutIds.length > 1) {
        signals.push({ kind: "corroboration", scouts: scoutIds.length });
      }
      if (questions.size > 0) {
        signals.push({ kind: "questions", count: questions.size });
      }
    }
    // The last move stands only while the card is still in the Lane it moved
    // it to: a demoted card promoted or undone back is simply in Review.
    const last = (lastMove.get(row.id) as { action: string } | undefined)
      ?.action;
    const raiser = scoutIds[1];
    const moved: LaneMove | null =
      last === "demote" && row.lane === "skim"
        ? { kind: "demoted" }
        : last === "raise" && row.lane === "review" && raiser !== undefined
          ? {
              kind: "raised",
              by: { id: raiser, name: byId.get(raiser)?.name ?? raiser },
            }
          : null;
    return {
      signals,
      moved,
      id: row.id,
      title: row.title,
      authors,
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
                dropped: scout.dropped !== null,
              },
            ];
      }),
      retroactive: appearances[0]?.retroactive === 1,
    };
  });
}

const authorKey = (name: string) => name.trim().toLowerCase();

/**
 * Authors with accepted work: every author on a Source or a stub, so a paper
 * the researcher attached by hand counts as much as one a Scout earned. A
 * reject writes no file, so it is never here — it is about a paper, not its
 * author (ADR 0044 decision 2).
 */
function acceptedAuthors(index: VaultIndex): Set<string> {
  const names = new Set<string>();
  for (const row of index.select<{ value: string }>(
    `SELECT fm.value FROM files f JOIN frontmatter fm USING (path)
      WHERE f.kind IN ('source', 'source-stub')`
  )) {
    const found = (JSON.parse(row.value) as Record<string, unknown> | null)?.[
      "authors"
    ];
    // A hand-edited file may hold anything; it simply adds no author.
    if (!Array.isArray(found)) continue;
    for (const name of found) {
      if (typeof name === "string") names.add(authorKey(name));
    }
  }
  return names;
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

    const { scouts, dropped, unreadable } = await readScouts(vaultPath);
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
    // A Scout whose file the app cannot use still has its Assigned
    // Questions. A stub written without them would read as a Scout that had
    // none, with nothing to say they were lost (ADR 0039 decision 7).
    const unknown = unreadable.filter((u) =>
      involved.includes(scoutIdOf(u.file))
    );
    if (unknown.length > 0) {
      throw new VaultError(
        "refused",
        `${unknown.map((u) => u.file).join(", ")} could not be read, so the Questions this paper was found for are not known.`
      );
    }
    // A dropped Scout's Proposals stay in Review until triaged, and accepting
    // one stamps the Questions that Scout was for like any other's would: its
    // file keeps them (ADR 0042 decision 1).
    const everyScout = [...scouts, ...dropped];
    const assigned = involved.flatMap(
      (id) => everyScout.find((s) => s.id === id)?.assigned ?? []
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
