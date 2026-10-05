import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  ANTHROPIC,
  CredentialFault,
  type CredentialStore,
} from "./credentials.js";
import { CEILING } from "./arxiv.js";
import { advertisedFeed, isFeed, readFeed, type FeedEntry } from "./feed.js";
import { costUsd, type Usage } from "./model-prices.js";
import { ModelError, type ModelProvider } from "./model-provider.js";
import { FetchError, fetchPage } from "./page-fetch.js";
import { reduceHtml } from "./page-reduce.js";
import { doiOf, sourceKeyOf } from "./source-key.js";

/**
 * Reading a page that has no feed (spec #463; `docs/architecture.md` § BYOK
 * and watched sources): fetch, reduce to text, ask the researcher's model to
 * copy out the cards, and keep only those whose title and link both occur
 * literally in what the model was shown. A model asked to read a page will,
 * left alone, invent a paper that is not there — the substring check is the
 * one thing standing between that and the Queue, so confidence is never
 * asked for (ADR 0017 decision 7) and a card that fails is dropped and
 * counted, never proposed.
 */

export type WatchedDeps = {
  fetch: typeof fetch;
  /** A test shortens the fetch's 30 s. */
  timeoutMs?: number;
  models: ModelProvider;
  /** Read at each run and never held between runs. */
  credentials: CredentialStore;
  /** The model id, asked for at each run so an edit in Settings reaches the next one. */
  model: () => Promise<string>;
};

/** A paper as a run found it, from whichever source: what `arrive` records. */
export type Arrival = {
  /** `arxiv:<id>`, `doi:<doi>` or `url:<normalised>` (`source-key.ts`). */
  key: string;
  doi: string | null;
  title: string;
  authors: string[];
  /** Missing is the empty string, never a guess. */
  published: string;
  venue: string | null;
  abstract: string;
  url: string;
};

export type WatchedErrorKind =
  "network" | "http" | "parse" | "credentials" | "model" | "extraction";

/** What a run that fetched or called a model learned even when it failed. */
export type RunFacts = {
  model: string | null;
  usage: Usage | null;
  costUsd: number | null;
  pageHash: string | null;
  pageLength: number | null;
  capped: boolean;
  unverified: number;
};

export class WatchedError extends Error {
  constructor(
    readonly kind: WatchedErrorKind,
    message: string,
    readonly facts: Partial<RunFacts> = {}
  ) {
    super(message);
  }
}

export type Read = {
  items: Arrival[];
  /** Verified items beyond the ceiling, which were not kept. */
  moreMatched: number;
  fetched: number;
  facts: RunFacts;
};

/** Input tokens the reduced text may use before the call (counted, not guessed). */
export const TOKEN_BUDGET = 40_000;

/** The extraction's messages; the sentences that say them live in `scout-health.ts`. */
export const FEED_UNREADABLE = "feed unreadable";
export const FEED_NOT_READ = "feed not read";
export const NO_KEY = "no key";
export const KEY_REJECTED = "key rejected";
export const KEYCHAIN_FAULT = "keychain fault";
export const LISTING_MISSED = "listing missed";
export const STRUCTURE_CHANGE = "structure change";
export const NO_LISTING = "no listing found";
export const FEW_VERIFIED = "fewer than half verified";

export async function readWatched(
  deps: WatchedDeps,
  queue: DatabaseSync,
  scout: { id: string; url: string }
): Promise<Read> {
  const fetchOptions = {
    fetch: deps.fetch,
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
  };
  let page;
  try {
    page = await fetchPage(scout.url, fetchOptions);
  } catch (cause) {
    if (cause instanceof FetchError) {
      throw new WatchedError(cause.kind, cause.message);
    }
    throw cause;
  }

  // A feed needs no model and so no key, which is why the key is read only
  // once the page is known not to be one or to advertise one (ADR 0040 d.3).
  if (isFeed(page.body)) return fromFeed(page.body, null);
  const advertised = advertisedFeed(page.body, page.url);
  if (advertised !== null) {
    // The page's HTML is never reduced or sent anywhere, and a feed that
    // fails is a stated failure, never a quiet fall back to paying a model.
    let feed;
    try {
      // One page and its feed, never a crawl: a feed elsewhere is not read.
      if (new URL(advertised).host !== new URL(page.url).host) {
        throw new FetchError("http", FEED_UNREADABLE);
      }
      feed = await fetchPage(advertised, fetchOptions);
    } catch (cause) {
      if (cause instanceof FetchError) {
        throw new WatchedError("http", FEED_UNREADABLE);
      }
      throw cause;
    }
    return fromFeed(feed.body, FEED_UNREADABLE);
  }

  let key;
  try {
    key = await deps.credentials.get(ANTHROPIC);
  } catch (cause) {
    // A Keychain that cannot be read is not a missing key: it is said as a
    // fault, in the *wrong* voice, so no one is sent to store one that is there.
    if (cause instanceof CredentialFault) {
      throw new WatchedError("credentials", KEYCHAIN_FAULT);
    }
    throw cause;
  }
  // No model call: a Scout with no key records that it did nothing, so "not
  // yet" is a row and not an inference (ADR 0040 d.1).
  if (key === null) throw new WatchedError("credentials", NO_KEY);

  let text = reduceHtml(page.body, page.url);
  const facts: RunFacts = {
    model: null,
    usage: null,
    costUsd: null,
    pageHash: createHash("sha256").update(text).digest("hex"),
    pageLength: text.length,
    capped: false,
    unverified: 0,
  };

  // A page that has not changed since the last clean look costs nothing: the
  // hash is of the reduced text, so a re-served page with a new timestamp in
  // its chrome is the same page.
  const last = queue
    .prepare(
      "SELECT page_hash FROM scout_runs WHERE scout_id = ? AND outcome = 'ok' AND page_hash IS NOT NULL ORDER BY id DESC LIMIT 1"
    )
    .get(scout.id) as { page_hash: string } | undefined;
  if (last?.page_hash === facts.pageHash) {
    return { items: [], moreMatched: 0, fetched: 0, facts };
  }

  const model = await deps.model();
  facts.model = model;
  try {
    const tokens = await deps.models.countTokens({ key, model, text });
    if (tokens > TOKEN_BUDGET) {
      // Cut proportionally and say so on the run: a long listing was not all read.
      text = text.slice(0, Math.floor((text.length * TOKEN_BUDGET) / tokens));
      facts.capped = true;
    }
    const extracted = await deps.models.extract({ key, model, page: text });
    facts.usage = extracted.usage;
    facts.costUsd = costUsd(model, extracted.usage);
    return verify(extracted.items, text, facts, queue, scout.id);
  } catch (cause) {
    if (cause instanceof ModelError) {
      const spent = cause.usage ?? null;
      throw new WatchedError(cause.kind, cause.message, {
        ...facts,
        usage: spent,
        costUsd: spent === null ? null : costUsd(model, spent),
      });
    }
    throw cause;
  }
}

/** Collapse whitespace the way reduction did, so a title that wrapped on the page still matches. */
const squash = (value: string) => value.replace(/\s+/g, " ").trim();

function verify(
  returned: Array<{
    title: string | null;
    authors: string[] | null;
    date: string | null;
    venue: string | null;
    abstract: string | null;
    url: string | null;
  }>,
  text: string,
  facts: RunFacts,
  queue: DatabaseSync,
  scoutId: string
): Read {
  const flat = squash(text);
  const kept: Arrival[] = [];
  for (const item of returned) {
    if (item.title === null || item.url === null) continue;
    const title = squash(item.title);
    if (title === "" || !flat.includes(title) || !text.includes(item.url)) {
      continue;
    }
    kept.push({
      key: sourceKeyOf(item.url),
      doi: doiOf(item.url),
      title,
      authors: item.authors ?? [],
      published: item.date ?? "",
      venue: item.venue,
      abstract: item.abstract ?? "",
      url: item.url,
    });
  }
  facts.unverified = returned.length - kept.length;

  // Fewer than half verifying is a model reading badly: a broken Scout, not a thin one.
  if (returned.length > 0 && kept.length * 2 < returned.length) {
    throw new WatchedError("extraction", FEW_VERIFIED, facts);
  }
  if (returned.length === 0) {
    // Nothing came back. Whether that is a quiet page, a miss, or a redesign
    // is told by whether last time's papers are still on it; with no last
    // time there is nothing to compare against and it says only that.
    const before = (
      queue
        .prepare(
          `SELECT DISTINCT p.title FROM appearances a JOIN proposals p ON p.id = a.proposal_id
            WHERE a.run_id = (
              SELECT a2.run_id FROM appearances a2 JOIN scout_runs r ON r.id = a2.run_id
               WHERE r.scout_id = ? AND r.outcome = 'ok' ORDER BY a2.run_id DESC LIMIT 1)`
        )
        .all(scoutId) as Array<{ title: string }>
    ).map((row) => squash(row.title));
    if (before.length === 0) {
      throw new WatchedError("extraction", NO_LISTING, facts);
    }
    const still = before.filter((title) => flat.includes(title)).length;
    throw new WatchedError(
      "extraction",
      still * 2 >= before.length ? LISTING_MISSED : STRUCTURE_CHANGE,
      facts
    );
  }

  return {
    items: kept.slice(0, CEILING),
    moreMatched: Math.max(0, kept.length - CEILING),
    fetched: kept.length,
    facts,
  };
}

const noFacts = (): RunFacts => ({
  model: null,
  usage: null,
  costUsd: null,
  pageHash: null,
  pageLength: null,
  capped: false,
  unverified: 0,
});

/** `message` is what a failure says; null leaves the default for an address that was itself a feed. */
function fromFeed(xml: string, message: string | null): Read {
  const entries = isFeed(xml) ? readFeed(xml) : null;
  if (entries === null) {
    throw new WatchedError("parse", message ?? FEED_NOT_READ);
  }
  const arrivals = entries.map(arrivalOf);
  return {
    items: arrivals.slice(0, CEILING),
    moreMatched: Math.max(0, arrivals.length - CEILING),
    fetched: arrivals.length,
    // No page hash: nothing was reduced, so the hash short-circuit has nothing to compare.
    facts: noFacts(),
  };
}

const arrivalOf = (entry: FeedEntry): Arrival => ({
  key: sourceKeyOf(entry.url),
  doi: doiOf(entry.url),
  title: entry.title,
  authors: entry.authors,
  published: entry.published,
  venue: null,
  abstract: entry.abstract,
  url: entry.url,
});
