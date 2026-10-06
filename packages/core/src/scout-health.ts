import type { DatabaseSync } from "node:sqlite";
import { readScouts, type Scout, type UnreadableScout } from "./scout-file.js";
import { DISALLOWED } from "./page-fetch.js";
import {
  FEED_NOT_READ,
  FEED_UNREADABLE,
  FEW_VERIFIED,
  KEY_REJECTED,
  LISTING_MISSED,
  KEYCHAIN_FAULT,
  NO_KEY,
  STRUCTURE_CHANGE,
} from "./watched.js";

/**
 * How a Scout is doing, in one of ADR 0032's three voices, derived from its
 * run rows and nothing else (`docs/architecture.md` § Scouts, *What that
 * query renders*). It is written here once so that no surface composes its
 * own words: Home, Loose Ends, the rail and the header render `sentence` and
 * `fragments` verbatim and choose only their actions. Nothing here is
 * stored — a Voice is as re-derivable as the health it reads (ADR 0016
 * decision 10) — and no sentence names a path or anything about the machine
 * (ADR 0028).
 */
export type RunErrorKind =
  | "network"
  | "http"
  | "rate_limited"
  | "parse"
  | "interrupted"
  | "credentials"
  | "model"
  | "extraction";

export type Health =
  /** `kind` is null for a Scout file that does not parse: no run exists to carry one (ADR 0039 decision 7). */
  | { voice: "wrong"; kind: RunErrorKind | null; sentence: string }
  /** `kind` is set only for a Scout waiting on a key, which Loose Ends draws as its own row. */
  | { voice: "not yet"; sentence: string; kind?: "credentials" }
  | { voice: "claim"; warrant: Warrant | null };

/** A Quiet field's evidence: the three fragments, in the order they are read. */
export type Warrant = {
  /** The newest run's `finished`. */
  finished: string;
  /** *newest run 2h ago · parsed cleanly · usually ~4 a week (6 runs)*, each ready to render. */
  fragments: [string, string, string];
};

export const CADENCE_MS = {
  daily: 24 * 3_600_000,
  weekly: 7 * 24 * 3_600_000,
  monthly: 30 * 24 * 3_600_000,
} as const;

/** Runs a rate needs before it is quoted; a lucky run must not set an expectation. */
export const BASELINE_RUNS = 3;

type RunRow = {
  id: number;
  started: string;
  finished: string;
  outcome: "ok" | "failed";
  error_kind: RunErrorKind | null;
  error_message: string | null;
  window_from: string;
  window_to: string;
  retroactive: number;
  fetched: number;
  new: number;
  query: string | null;
  cost_usd: number | null;
};

/**
 * Finished runs for a Scout, oldest first. An unfinished one has said nothing
 * yet. A *no key* run is among them, since the Voice and the scheduler read
 * what the Scout last *said*; anything that counts or averages what it
 * *checked* must leave `isNoKeyRun` rows out.
 */
export function finishedRuns(queue: DatabaseSync, scoutId: string): RunRow[] {
  return queue
    .prepare(
      "SELECT * FROM scout_runs WHERE scout_id = ? AND finished IS NOT NULL ORDER BY id"
    )
    .all(scoutId) as RunRow[];
}

/**
 * A *no key* run (ADR 0040 decision 1): the Scout was due, found no Credential
 * and went no further — no model call, no item read. Its row exists so that
 * *blocked on credentials* is read from rows, and for no other reason: it is
 * no check of the field, so a count of runs, a mean over them and the Quiet
 * field's baseline all leave it out, or a Scout waiting on a key would read
 * as having looked (ADR 0042 decision 6). A *rejected* key is not this: the
 * Scout did try, and that is a fault.
 */
export function isNoKeyRun(
  run: Pick<RunRow, "outcome" | "error_kind" | "error_message">
): boolean {
  return (
    run.outcome === "failed" &&
    run.error_kind === "credentials" &&
    run.error_message === NO_KEY
  );
}

export function healthOf(queue: DatabaseSync, scout: Scout, now: Date): Health {
  const runs = finishedRuns(queue, scout.id);
  // Before `wrong`: a paused Scout is not looking, so a retired Scout does
  // not keep nagging about a failure its researcher has already answered
  // (Loose Ends offers *pause* as the way out of a broken one).
  if (scout.paused) {
    return {
      voice: "not yet",
      sentence: "Paused — it is not looking.",
    };
  }
  const newest = runs.at(-1);
  if (newest === undefined) {
    // Saving a page's Scout runs nothing (ADR 0040 d.5), and the header
    // says why rather than leaving it to look idle.
    return {
      voice: "not yet",
      sentence:
        scout.source.kind === "watched"
          ? "Not yet — first check due now."
          : "It has not run yet.",
    };
  }
  // What the baseline rests on: runs that read the field and parsed it. A *no
  // key* run is `failed`, so it is never one: a Scout that lost its key and got
  // it back keeps the baseline it earned.
  const ok = runs.filter((r) => r.outcome === "ok");
  if (newest.outcome === "failed") {
    const kind = newest.error_kind ?? "network";
    // A key never stored is not a fault: the Scout has not been set up, so
    // it says *not yet* with the reason, and a rejected key says *wrong*
    // (ADR 0040 decision 1). Which one is the run's message, not its kind.
    if (isNoKeyRun(newest)) {
      return {
        voice: "not yet",
        kind: "credentials",
        sentence: faultSentence(
          "credentials",
          NO_KEY,
          false,
          scout.source.kind
        ),
      };
    }
    const lastClean = ok.at(-1);
    // Only known when a clean run recorded the Query it asked: a run from
    // before the column, or no clean run at all, claims no edit.
    const edited = lastClean?.query != null && lastClean.query !== scout.query;
    return {
      voice: "wrong",
      kind,
      sentence: faultSentence(
        kind,
        newest.error_message,
        edited,
        scout.source.kind
      ),
    };
  }
  const lastFinding = [...ok].reverse().find((r) => r.new > 0);
  const quiet = lastFinding === undefined || lastFinding.id < newest.id;
  if (!quiet) return { voice: "claim", warrant: null };
  return {
    voice: "claim",
    warrant: {
      finished: newest.finished,
      fragments: [
        `newest run ${ago(now.getTime() - Date.parse(newest.finished))}`,
        "parsed cleanly",
        usualRate(ok),
      ],
    },
  };
}

/** *wrong*, by the second route: a Scout file that does not parse, named by its file only. */
export function unreadableHealth(file: UnreadableScout): Health {
  return { voice: "wrong", kind: null, sentence: file.sentence };
}

/** One sentence per kind; the surfaces render it and never reword it. */
export function faultSentence(
  kind: RunErrorKind,
  message: string | null,
  queryEdited: boolean,
  source: Scout["source"]["kind"] = "arxiv"
): string {
  if (
    source === "watched" &&
    (message === FEED_UNREADABLE || message === FEED_NOT_READ)
  ) {
    return message === FEED_UNREADABLE
      ? "This page advertises a feed that could not be read, so nothing was checked."
      : "This address did not read as an RSS or Atom feed, so nothing was checked.";
  }
  if (source === "watched" && (kind === "network" || kind === "http")) {
    if (message === DISALLOWED) {
      return "The site asks not to be read by robots (disallowed by robots.txt), so nothing was checked.";
    }
    const status = /HTTP (\d{3})/.exec(message ?? "")?.[1];
    return kind === "network"
      ? "The page could not be reached, so nothing was checked."
      : `The page answered with an error${status === undefined ? "" : ` (HTTP ${status})`} or was too large to read, ` +
          "so nothing was checked.";
  }
  switch (kind) {
    case "credentials":
      return message === NO_KEY
        ? "No model key is stored, so this page has not been read yet."
        : message === KEY_REJECTED
          ? "The model provider refused the stored key, so nothing was checked."
          : message === KEYCHAIN_FAULT
            ? "The Keychain could not be used to read the model key, so nothing was checked."
            : "The model key could not be used, so nothing was checked.";
    case "model":
      return `The model could not read this page${message === null ? "" : ` (${message})`}, so nothing was checked.`;
    case "extraction":
      return message === STRUCTURE_CHANGE
        ? "The papers this page listed before are no longer on it: its structure changed."
        : message === LISTING_MISSED
          ? "The model returned nothing, but the papers seen last time are still on the page: the listing was missed."
          : message === FEW_VERIFIED
            ? "Fewer than half of what the model returned appears on the page, so nothing was proposed."
            : "The model found no papers listed on this page.";
    case "network":
      return "arXiv could not be reached, so nothing was checked.";
    case "http": {
      const status = /HTTP (\d{3})/.exec(message ?? "")?.[1];
      return `arXiv answered with an error${status === undefined ? "" : ` (HTTP ${status})`}, so nothing was checked.`;
    }
    case "rate_limited":
      return "arXiv asked Vitrine to slow down (HTTP 429), so nothing was checked.";
    case "parse":
      return (
        "arXiv's answer did not read as a search result: the query may be malformed, or arXiv changed what it returns." +
        (queryEdited ? " Its query changed since it last ran cleanly." : "")
      );
    case "interrupted":
      return "Vitrine closed before this check finished.";
  }
}

function ago(ms: number): string {
  const minutes = Math.floor(Math.max(ms, 0) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

const WEEK_MS = 7 * 24 * 3_600_000;

/**
 * The Scout's own rate of finding: runs that found something, over the
 * stretch the clean runs cover — never a bare count, which a lucky run would
 * inflate. It names the runs it rests on, so a rate quoted from the minimum
 * looks as thin as it is, and below `BASELINE_RUNS` it says it has none
 * rather than leaving the fragment out.
 *
 * A first run that searched backward covers ninety days of papers in one
 * run, which says nothing about how often the field produces them; the
 * stretch starts where that run ended and the run itself is not counted.
 */
function usualRate(ok: RunRow[]): string {
  if (ok.length < BASELINE_RUNS) return "no baseline yet";
  const first = ok[0]!;
  const backward = first.retroactive === 1;
  const from = Date.parse(backward ? first.window_to : first.window_from);
  const span = Date.parse(ok.at(-1)!.window_to) - from;
  const counted = backward ? ok.slice(1) : ok;
  const found = counted.filter((r) => r.new > 0).length;
  const runs = `(${ok.length} runs)`;
  if (span <= 0) return "no baseline yet";
  if (found === 0) return `nothing found yet ${runs}`;
  const perWeek = found / (span / WEEK_MS);
  if (perWeek >= 1) return `usually ~${Math.round(perWeek)} a week ${runs}`;
  const perMonth = found / (span / CADENCE_MS.monthly);
  if (perMonth >= 1) return `usually ~${Math.round(perMonth)} a month ${runs}`;
  const perQuarter = found / (span / (3 * CADENCE_MS.monthly));
  return `usually ~${Math.max(1, Math.round(perQuarter))} a quarter ${runs}`;
}

export type FleetHealth = {
  scouts: Array<{
    id: string;
    health: Health;
    /**
     * What the newest run cost, in USD; null when it cost nothing or the
     * model had no price (the app never invents a figure). The only place
     * cost is drawn, and nothing caps it (ADR 0040 decision 6).
     */
    lastCostUsd: number | null;
  }>;
  /** Keyed by the file's name, which is all the rail may show of it. */
  unreadable: Array<{ file: string; health: Health }>;
};

function lastCost(queue: DatabaseSync, scoutId: string): number | null {
  const cost = finishedRuns(queue, scoutId).at(-1)?.cost_usd ?? null;
  return cost === null || cost <= 0 ? null : cost;
}

export async function readHealth(deps: {
  vaultPath: string;
  queue: DatabaseSync;
  now: () => Date;
}): Promise<FleetHealth> {
  const { scouts, unreadable } = await readScouts(deps.vaultPath);
  const now = deps.now();
  return {
    scouts: scouts.map((s) => ({
      id: s.id,
      health: healthOf(deps.queue, s, now),
      lastCostUsd: lastCost(deps.queue, s.id),
    })),
    unreadable: unreadable.map((u) => ({
      file: u.file,
      health: unreadableHealth(u),
    })),
  };
}

/**
 * What an empty lane may claim, from the fleet and nothing else (ADR 0032;
 * `docs/architecture.md` § Scouts): one derivation for Review's *cleared* and
 * Skim's quiet, so the two never speak in different voices. A claim needs
 * every Scout readable and its last run clean; any broken Scout withholds it
 * and is named instead. Scouts that are not looking (paused, not yet run) are
 * named inside the claim, never counted.
 */
export type FleetClaim = {
  /** `null` is no claim at all. */
  claim: string | null;
  /** Broken Scouts when the claim is withheld; the ones not looking when it stands. */
  naming: string[];
};

export async function readFleetClaim(deps: {
  vaultPath: string;
  queue: DatabaseSync;
  now: () => Date;
}): Promise<FleetClaim> {
  const { scouts, unreadable } = await readScouts(deps.vaultPath);
  const now = deps.now();
  const healths = scouts.map((s) => ({
    name: s.name,
    health: healthOf(deps.queue, s, now),
  }));
  const broken = [
    ...healths.filter((h) => h.health.voice === "wrong").map((h) => h.name),
    ...unreadable.map((u) => u.file),
  ];
  if (broken.length > 0) return { claim: null, naming: broken };
  const watching = healths.filter((h) => h.health.voice === "claim");
  const idle = healths
    .filter((h) => h.health.voice === "not yet")
    .map((h) => h.name);
  if (watching.length === 0) return { claim: null, naming: idle };

  const newest = deps.queue
    .prepare("SELECT MAX(finished) AS at FROM scout_runs WHERE outcome = 'ok'")
    .get() as { at: string | null };
  const last = deps.queue
    .prepare(
      "SELECT MAX(first_seen) AS at FROM proposals WHERE state != 'held'"
    )
    .get() as { at: string | null };
  const parts = [
    `${watching.length} ${watching.length === 1 ? "scout" : "scouts"} watching`,
    "all parsed cleanly",
    newest.at === null
      ? "no run yet"
      : `newest run ${ago(now.getTime() - Date.parse(newest.at))}`,
    last.at === null
      ? "no proposal yet"
      : `last new proposal ${new Date(last.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}`,
  ];
  if (idle.length > 0) parts.push(`${idle.join(", ")} not looking`);
  return { claim: parts.join(" · "), naming: idle };
}
