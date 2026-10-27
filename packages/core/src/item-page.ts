import { decode, squash } from "./page-reduce.js";

/**
 * What an Item page declares for machines (ADR 0055 decisions 3 and 9;
 * `docs/architecture.md` § *Item pages*): the fields a site publishes so that
 * search engines and reference managers need not guess, read in a fixed order
 * — `citation_*`, then JSON-LD, then OpenGraph, then `<time datetime>` for the
 * date — and the first that has a field gives it. These are the page's own
 * claims, not a model's, so they are taken as declared and not Verified.
 *
 * Two things a page declares are not what they seem. An `Organization` named
 * as the author is the lab, not a person, and Rank's first signal is author
 * overlap: one lab as everyone's author would make every card from it match
 * every other. And a description equal to the listing's own `og:description`
 * is the site's blurb, which a site serves on every page that has none of its
 * own. A site's own script payload is not read: it is undocumented, and on
 * anthropic.com its author field is empty or wrong.
 */

export type Declared = {
  authors: string[];
  /** `YYYY-MM-DD` when it parses as one, else as declared; null when none. */
  date: string | null;
  doi: string | null;
  abstract: string | null;
  /** The organisations it names as its author, never authors themselves, kept so a model's copy of one is refused too. */
  organisations: string[];
};

const ARTICLE_TYPES = ["Article", "ScholarlyArticle", "BlogPosting"];

const ATTRIBUTE = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const m of tag.matchAll(ATTRIBUTE)) {
    attributes.set(m[1]!.toLowerCase(), decode(m[2] ?? m[3] ?? m[4] ?? ""));
  }
  return attributes;
}

/** Every `<meta>` value under a `name` or `property`, in page order: `citation_author` repeats. */
function metaOf(html: string): Map<string, string[]> {
  const meta = new Map<string, string[]>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = attributesOf(tag);
    const key = (
      attributes.get("name") ?? attributes.get("property")
    )?.toLowerCase();
    const content = squash(attributes.get("content") ?? "");
    if (key === undefined || content === "") continue;
    meta.set(key, [...(meta.get(key) ?? []), content]);
  }
  return meta;
}

const typesOf = (node: Record<string, unknown>): unknown[] =>
  Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];

/** The first JSON-LD node that is an article of a kind ADR 0055 names, through arrays and `@graph`. */
function articleOf(html: string): Record<string, unknown> | null {
  const scripts = html.matchAll(
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const [, body] of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body!);
    } catch {
      // A malformed block declares nothing; the next source is asked.
      continue;
    }
    const queue: unknown[] = [parsed];
    while (queue.length > 0) {
      const node = queue.shift();
      if (Array.isArray(node)) queue.push(...(node as unknown[]));
      else if (typeof node === "object" && node !== null) {
        const record = node as Record<string, unknown>;
        if (typesOf(record).some((t) => ARTICLE_TYPES.includes(t as string))) {
          return record;
        }
        if (record["@graph"] !== undefined) queue.push(record["@graph"]);
      }
    }
  }
  return null;
}

function text(value: unknown): string | null {
  const squashed = typeof value === "string" ? squash(value) : "";
  return squashed === "" ? null : squashed;
}

/** The names of the entries of one `@type`; an untyped name is neither a person nor an organisation. */
function namesOf(author: unknown, type: "Person" | "Organization"): string[] {
  const all = Array.isArray(author) ? author : [author];
  return all.flatMap((a) =>
    typeof a === "object" &&
    a !== null &&
    typesOf(a as Record<string, unknown>).includes(type)
      ? (text((a as Record<string, unknown>).name) ?? [])
      : []
  );
}

/** A declared date as the card shows dates; one that does not read as a day is kept as declared, never guessed at. */
function dayOf(value: string): string {
  const m = /^(\d{4})[-/](\d{2})[-/](\d{2})/.exec(value);
  return m === null ? value : `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Read an Item page's declared fields. `blurb` is the listing page's own
 * `og:description`, or null when it has none.
 */
export function declaredOf(html: string, blurb: string | null): Declared {
  const meta = metaOf(html);
  const first = (key: string) => meta.get(key)?.[0] ?? null;
  const article = articleOf(html);
  // The first `<time>` that carries a machine date; one with only words in it says nothing.
  const time = /<time\b[^>]*\bdatetime\s*=[^>]*>/i.exec(html);

  const citationAuthors = meta.get("citation_author") ?? [];
  const authors =
    citationAuthors.length > 0
      ? citationAuthors
      : // People only: an `Organization` is never one (ADR 0055 decision 9).
        namesOf(article?.author, "Person");
  const date = [
    first("citation_publication_date"),
    text(article?.datePublished),
    first("article:published_time"),
    time === null ? null : text(attributesOf(time[0]).get("datetime")),
  ].find((d) => d !== null);
  const notBlurb = (d: string | null) => d !== null && d !== blurb;
  const abstract = [
    first("citation_abstract"),
    text(article?.description),
    first("og:description"),
  ].find(notBlurb);

  return {
    authors,
    date: date === undefined ? null : dayOf(date),
    doi: first("citation_doi"),
    abstract: abstract ?? null,
    organisations: namesOf(article?.author, "Organization"),
  };
}

/** The listing's own `og:description`, the blurb an Item page may repeat. */
export const blurbOf = (html: string): string | null =>
  metaOf(html).get("og:description")?.[0] ?? null;
