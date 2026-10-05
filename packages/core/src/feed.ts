import { decode } from "./page-reduce.js";

/**
 * A feed read as the source wrote it (`docs/architecture.md` § BYOK and
 * watched sources, *Fetch*): RSS or Atom entries become cards directly, so a
 * page that advertises one costs nothing and cannot be misread by a model.
 * Elements are read by local name with namespace prefixes ignored, the way
 * `arxiv.ts` reads Atom, because the two formats are regular enough that a
 * parser library would only add a dependency.
 */

export type FeedEntry = {
  title: string;
  authors: string[];
  /** `YYYY-MM-DD` when the feed's date parses, else the feed's own text. */
  published: string;
  abstract: string;
  url: string;
};

/** Whether a response body is itself a feed: its root element says so, whatever the content type claims. */
export function isFeed(body: string): boolean {
  return /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:\w+:)?(?:rss|feed|RDF)[\s>]/.test(
    body
  );
}

const FEED_TYPE = /^application\/(?:rss|atom)\+xml\b/i;

/** An attribute's value, single- or double-quoted. */
function quoted(tag: string, name: string): string | undefined {
  const found = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i"
  ).exec(tag);
  return found?.[1] ?? found?.[2];
}

/** The first feed a page advertises, made absolute; null when it advertises none. */
export function advertisedFeed(html: string, base: string): string | null {
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const relValue = quoted(tag, "rel") ?? "";
    const typeValue = quoted(tag, "type") ?? "";
    const target = quoted(tag, "href");
    if (
      /\balternate\b/i.test(relValue) &&
      FEED_TYPE.test(typeValue.trim()) &&
      target !== undefined
    ) {
      try {
        return new URL(decode(target), base).href;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Null when the body has entries but none a card can be made of; an empty feed is a quiet one, not a failure. */
export function readFeed(xml: string): FeedEntry[] | null {
  const raw =
    xml.match(
      /<(?:\w+:)?(?:item|entry)[\s>][\s\S]*?<\/(?:\w+:)?(?:item|entry)>/g
    ) ?? [];
  const entries: FeedEntry[] = [];
  for (const entry of raw) {
    const title = text(entry, "title");
    const url = linkOf(entry);
    if (title === null || url === null) continue;
    entries.push({
      title,
      authors: authorsOf(entry),
      published: dateOf(
        text(entry, "published") ??
          text(entry, "pubDate") ??
          text(entry, "date") ??
          text(entry, "updated") ??
          ""
      ),
      abstract:
        text(entry, "summary") ??
        text(entry, "description") ??
        text(entry, "content") ??
        "",
      url,
    });
  }
  // Entries that all failed to read are a broken feed, not a quiet one.
  return raw.length > 0 && entries.length === 0 ? null : entries;
}

/** Text of the first `<name>`: CDATA unwrapped, entities decoded, markup stripped, whitespace collapsed. */
function text(xml: string, name: string): string | null {
  const found = new RegExp(
    `<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`
  ).exec(xml);
  return found?.[1] === undefined ? null : clean(found[1]);
}

function clean(raw: string): string | null {
  // Entity-escaped markup (Atom `type="html"`) is decoded before it is stripped.
  const unwrapped = raw.replace(
    /<!\[CDATA\[([\s\S]*?)\]\]>/g,
    (_, inner: string) => inner
  );
  const value = decode(decode(unwrapped).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return value === "" ? null : value;
}

function linkOf(entry: string): string | null {
  for (const [tag] of entry.matchAll(/<(?:\w+:)?link\b[^>]*>/g)) {
    const rel = quoted(tag, "rel");
    const href = quoted(tag, "href");
    if (href !== undefined && (rel === undefined || rel === "alternate")) {
      return decode(href);
    }
  }
  return text(entry, "link");
}

function authorsOf(entry: string): string[] {
  const atom = [
    ...entry.matchAll(/<(?:\w+:)?author\b[^>]*>[\s\S]*?<\/(?:\w+:)?author>/g),
  ]
    .map(([author]) => text(author, "name") ?? clean(author))
    .filter((name): name is string => name !== null);
  const creators = [
    ...entry.matchAll(/<(?:\w+:)?creator\b[^>]*>[\s\S]*?<\/(?:\w+:)?creator>/g),
  ]
    .map(([creator]) => clean(creator))
    .filter((name): name is string => name !== null);
  // RSS `<author>` is `address (Name)`; the name is what a card shows.
  return [...atom, ...creators].map(
    (name) => /\(([^)]+)\)\s*$/.exec(name)?.[1] ?? name
  );
}

function dateOf(value: string): string {
  const parsed = new Date(value);
  return value === "" || Number.isNaN(parsed.getTime())
    ? value
    : parsed.toISOString().slice(0, 10);
}
