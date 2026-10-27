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
import {
  ModelError,
  type ItemPageField,
  type ModelProvider,
} from "./model-provider.js";
import { blurbOf, declaredOf, type Declared } from "./item-page.js";
import {
  FetchError,
  fetchPage,
  type Page,
  type PageFetchOptions,
} from "./page-fetch.js";
import { reduceHtml, squash } from "./page-reduce.js";
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
  /** Only an OpenAlex work says what kind of venue it was published in. */
  venueType?: "journal" | "conference" | null;
  /** Likewise the OpenAlex source ID and publisher lineage Mute rules match on (ADR 0051 decision 8). */
  venueId?: string | null;
  publisherLineage?: string[];
  /** The name of the lineage's first publisher; stored so the card can offer the rule by name without a second fetch (ADR 0051 decision 8). */
  publisherName?: string | null;
  abstract: string;
  url: string;
  /** A Watched Scout's Item page still owed, with the tries spent on it; absent or null when none is (ADR 0055). */
  itemPageTries?: number | null;
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
  itemPagesRead: number;
  /** Values an Item page's Extraction copied that were not on that page. */
  itemValuesDropped: number;
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
/** The most Item pages one run reads (ADR 0055 decision 2), a starting point. */
export const ITEM_PAGE_CEILING = 25;
/** Input tokens one Item page's reduced text may use (ADR 0055 decision 2): the card fields sit at its top. */
export const ITEM_PAGE_BUDGET = 8_000;

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
  scout: { id: string; url: string },
  /** How many Item pages it may read; *try* reads none yet. */
  { itemPages = ITEM_PAGE_CEILING }: { itemPages?: number } = {}
): Promise<Read> {
  const fetchOptions: PageFetchOptions = {
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
    itemPagesRead: 0,
    itemValuesDropped: 0,
  };

  // A page that has not changed since the last clean look costs nothing: the
  // hash is of the reduced text, so a re-served page with a new timestamp in
  // its chrome is the same page. Only runs at this page vouch for it: a
  // changed page is read once even when its text hashes as the old one's
  // (ADR 0043 d.3); a run from before the column recorded no page and counts.
  const last = queue
    .prepare(
      "SELECT page_hash FROM scout_runs WHERE scout_id = ? AND outcome = 'ok' AND page_hash IS NOT NULL AND (query IS NULL OR query = ?) ORDER BY id DESC LIMIT 1"
    )
    .get(scout.id, scout.url) as { page_hash: string } | undefined;
  if (last?.page_hash === facts.pageHash) {
    return { items: [], moreMatched: 0, fetched: 0, facts };
  }

  const model = await deps.model();
  facts.model = model;
  let read: Read;
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
    read = verify(extracted.items, text, facts, queue, scout);
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
  return readItemPages(
    read,
    page,
    queue,
    fetchOptions,
    { models: deps.models, key, model },
    itemPages
  );
}

/** A host with any leading `www.` dropped, so `anthropic.com` and `www.anthropic.com` are one site; null for a link that does not parse. */
function siteOf(url: string): string | null {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Read the Item page of each new item on the listing's own site, up to the
 * ceiling, and fill what the listing left empty from what the page declares
 * (ADR 0055 decisions 2 and 3). One page per item, with the listing's
 * etiquette, and nothing the page links to: a Watched source is a reading of
 * one site, never a crawl. An item on another site is not owed a read, so it
 * is neither fetched nor a failure. An item already in the queue was read, or
 * owed, when it first arrived. A page that cannot be fetched leaves its card
 * as the listing showed it, with the try counted; one the model cannot read
 * keeps what it declared, and is a try too.
 */
async function readItemPages(
  read: Read,
  listing: Page,
  queue: DatabaseSync,
  fetchOptions: PageFetchOptions,
  reader: ItemPageReader,
  ceiling: number
): Promise<Read> {
  const site = siteOf(listing.url);
  const blurb = blurbOf(listing.body);
  const known = queue.prepare("SELECT 1 FROM proposals WHERE source_key = ?");
  // A listing may link one item twice; it is one card, read once.
  const seen = new Set<string>();
  let asked = 0;
  let readCount = 0;
  let dropped = 0;
  let usage = read.facts.usage;
  const items: Arrival[] = [];
  for (const item of read.items) {
    const owed =
      site !== null &&
      siteOf(item.url) === site &&
      !seen.has(item.key) &&
      known.get(item.key) === undefined;
    seen.add(item.key);
    if (!owed) {
      items.push(item);
    } else if (asked >= ceiling) {
      items.push({ ...item, itemPageTries: 0 });
    } else {
      asked++;
      let page;
      try {
        page = await fetchPage(item.url, fetchOptions);
      } catch (cause) {
        if (!(cause instanceof FetchError)) throw cause;
        items.push({ ...item, itemPageTries: 1 });
        continue;
      }
      const pageDeclared = declaredOf(page.body, blurb);
      const declared = filled(item, pageDeclared);
      const needed = neededOf(declared);
      if (needed.length === 0) {
        readCount++;
        items.push(declared);
        continue;
      }
      try {
        const copied = await copiedFrom(
          page,
          needed,
          pageDeclared.organisations,
          reader
        );
        usage = plus(usage, copied.usage);
        dropped += copied.dropped;
        readCount++;
        items.push(filledFromCopy(declared, copied.fields));
      } catch (cause) {
        if (!(cause instanceof ModelError)) throw cause;
        if (cause.usage !== undefined) usage = plus(usage, cause.usage);
        // A key rejected mid-run is a broken Scout, not one page's bad
        // luck: the run fails as the listing's call would, with what it
        // spent, and its items arrive on the next run that can read them.
        if (cause.kind === "credentials") {
          throw new WatchedError("credentials", KEY_REJECTED, {
            ...read.facts,
            usage,
            costUsd: usage === null ? null : costUsd(reader.model, usage),
          });
        }
        items.push({ ...declared, itemPageTries: 1 });
      }
    }
  }
  return {
    ...read,
    items,
    facts: {
      ...read.facts,
      usage,
      costUsd: usage === null ? null : costUsd(reader.model, usage),
      itemPagesRead: readCount,
      itemValuesDropped: dropped,
    },
  };
}

type ItemPageReader = { models: ModelProvider; key: string; model: string };

const plus = (a: Usage | null, b: Usage): Usage => ({
  input: (a?.input ?? 0) + b.input,
  output: (a?.output ?? 0) + b.output,
  cacheRead: (a?.cacheRead ?? 0) + b.cacheRead,
});

/**
 * What is still empty once the page's declarations are in, and so worth a
 * call. A missing venue never makes a call on its own: nothing a page
 * declares fills a venue, so counting it would make every Item page a paid
 * one, and a post with no venue is a valid card (ADR 0055 decision 3; brief
 * `## Scouts` § Proposals). It is asked for when the call is made anyway.
 */
function neededOf(card: Arrival): ItemPageField[] {
  const empty = {
    authors: card.authors.length === 0,
    date: card.published === "",
    venue: card.venue === null || card.venue === "",
    abstract: card.abstract === "",
  };
  if (!empty.authors && !empty.date && !empty.abstract) return [];
  return (["authors", "date", "venue", "abstract"] as const).filter(
    (field) => empty[field]
  );
}

type Copied = {
  fields: { authors: string[]; date: string; venue: string; abstract: string };
  dropped: number;
  usage: Usage;
};

/**
 * Ask the model for one Item page's missing fields, and keep each value only
 * if it occurs on the text the model was shown (ADR 0055 decision 4). On a
 * listing the title and link are what a model would invent; on an Item page
 * those are already known, so its mistakes land in the authors, the date and
 * the abstract instead, and every one of them is checked: each author name on
 * its own, so one invented co-author costs that name and not the byline. A
 * value that fails is dropped and counted, and the rest of the card stands.
 * An organisation the page declares as its author is on the page, so the
 * substring check would pass it: it is refused by name, as declared authors
 * are (ADR 0055 decision 9).
 */
async function copiedFrom(
  page: Page,
  needed: ItemPageField[],
  organisations: string[],
  { models, key, model }: ItemPageReader
): Promise<Copied> {
  let text = reduceHtml(page.body, page.url);
  const tokens = await models.countTokens({ key, model, text });
  if (tokens > ITEM_PAGE_BUDGET) {
    // Cut as a listing is cut: a page that is a whole paper is paid for as its top.
    text = text.slice(0, Math.floor((text.length * ITEM_PAGE_BUDGET) / tokens));
  }
  const answer = await models.extractItemPage({
    key,
    model,
    page: text,
    needed,
  });

  const flat = squash(text);
  let dropped = 0;
  // Whitespace collapsed on both sides, as the listing's Verify does: a
  // sentence the page wrapped is still the page's sentence.
  const verified = (value: string | null): string => {
    const copied = squash(value ?? "");
    if (copied === "") return "";
    if (flat.includes(copied)) return copied;
    dropped++;
    return "";
  };
  const asked = (field: ItemPageField) => needed.includes(field);
  const organisation = new Set(organisations.map((o) => o.toLowerCase()));
  const person = (name: string) => {
    if (!organisation.has(name.toLowerCase())) return true;
    dropped++;
    return false;
  };
  const fields = {
    authors: asked("authors")
      ? (answer.fields.authors ?? [])
          .map(verified)
          .filter((a) => a !== "" && person(a))
      : [],
    date: asked("date") ? dayOfCopied(verified(answer.fields.date)) : "",
    venue: asked("venue") ? verified(answer.fields.venue) : "",
    abstract: asked("abstract") ? verified(answer.fields.abstract) : "",
  };
  return { fields, dropped, usage: answer.usage };
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/**
 * A date as the page wrote it, as a day when it plainly is one: ISO, or a
 * month by name with its day and year (`Jun 20, 2025`, `20 June 2025`). It
 * was Verified as copied, so this only formats. Anything else — `06/20/2025`,
 * whose order is a guess, or `Summer 2025`, which is no day — is kept as
 * copied, and no time zone is involved, so a day never shifts by one.
 */
function dayOfCopied(copied: string): string {
  // `Jun`, `June` and `Sept` name a month; `Junk` does not.
  const month = (name: string) =>
    name.length < 3
      ? 0
      : MONTHS.findIndex((m) => m.startsWith(name.toLowerCase())) + 1;
  const parts =
    /^(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})\b/.exec(copied)?.groups ??
    /^(?<name>[A-Za-z]{3,9})\.?\s+(?<d>\d{1,2}),?\s+(?<y>\d{4})$/.exec(copied)
      ?.groups ??
    /^(?<d>\d{1,2})\s+(?<name>[A-Za-z]{3,9})\.?,?\s+(?<y>\d{4})$/.exec(copied)
      ?.groups;
  if (parts === undefined) return copied;
  const y = Number(parts.y);
  const m = parts.name === undefined ? Number(parts.m) : month(parts.name);
  const d = Number(parts.d);
  // A day the calendar does not have (`Feb 31`) is no day: kept as copied.
  const at = new Date(Date.UTC(y, m - 1, d));
  if (m < 1 || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d) {
    return copied;
  }
  return at.toISOString().slice(0, 10);
}

/** The copy fills only what is still empty: what the listing or the page declared stands. */
const filledFromCopy = (card: Arrival, copied: Copied["fields"]): Arrival => ({
  ...card,
  authors: card.authors.length > 0 ? card.authors : copied.authors,
  published: card.published !== "" ? card.published : copied.date,
  venue:
    card.venue !== null && card.venue !== ""
      ? card.venue
      : copied.venue || null,
  abstract: card.abstract !== "" ? card.abstract : copied.abstract,
});

/** Only what the listing left empty: a field it gave is never replaced (ADR 0055 decision 5). */
const filled = (item: Arrival, declared: Declared): Arrival => ({
  ...item,
  authors: item.authors.length > 0 ? item.authors : declared.authors,
  published: item.published !== "" ? item.published : (declared.date ?? ""),
  doi: item.doi ?? declared.doi,
  abstract: item.abstract !== "" ? item.abstract : (declared.abstract ?? ""),
});

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
  scout: { id: string; url: string }
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
    // time there is nothing to compare against and it says only that. Last
    // time is read at this page only: a page the Scout was pointed at has no
    // memory of its own until it adds a paper (the page predicate is
    // `finishedRunsAtPage`'s, in SQL; a run with no recorded page is taken as this one), and an empty read of it is *no
    // listing found*, never *its structure changed* (ADR 0043 d.6).
    const before = (
      queue
        .prepare(
          `SELECT DISTINCT p.title FROM appearances a JOIN proposals p ON p.id = a.proposal_id
            WHERE a.run_id = (
              SELECT a2.run_id FROM appearances a2 JOIN scout_runs r ON r.id = a2.run_id
               WHERE r.scout_id = ? AND r.outcome = 'ok' AND (r.query IS NULL OR r.query = ?)
               ORDER BY a2.run_id DESC LIMIT 1)`
        )
        .all(scout.id, scout.url) as Array<{ title: string }>
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
  itemPagesRead: 0,
  itemValuesDropped: 0,
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
