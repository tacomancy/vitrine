import { serialised } from "./serialise.js";

/**
 * The one arXiv client every Scout shares (ADR 0016 decisions 1, 3, 11;
 * `docs/architecture.md` § Scouts). It takes its `fetch` and its clock as
 * parameters so the ToU's three-second gap is asserted against a clock a
 * test moves, never slept for.
 */

export type ArxivClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export type ArxivOptions = {
  fetch: typeof fetch;
  clock: ArxivClock;
  /** Where the API is; the closing demo points it at a local stand-in, never the real one. */
  endpoint?: string;
};

/** What a paper is, as the Atom entry gave it. A field arXiv did not supply is `null`; keywords are never read. */
export type ArxivItem = {
  /** `id` with the trailing `v<n>` stripped: the work, not the version (ADR 0016 decision 7). */
  arxivId: string;
  title: string;
  authors: string[];
  /** First submission — the only date arXiv has. */
  published: string;
  venue: string | null;
  abstract: string;
  url: string;
  doi: string | null;
};

export type ArxivFound = {
  items: ArxivItem[];
  /** `opensearch:totalResults` of the first page. */
  total: number;
  /** How many matched beyond the ceiling and were not fetched; 0 when nothing was cut. */
  moreMatched: number;
};

export type ArxivErrorKind = "network" | "http" | "rate_limited" | "parse";

export class ArxivError extends Error {
  constructor(
    readonly kind: ArxivErrorKind,
    message: string,
    /** The HTTP status, for `http` and `rate_limited`. */
    readonly status?: number
  ) {
    super(message);
  }
}

export type ArxivClient = {
  /**
   * The Query, wrapped in the window when there is one, newest cut first by a
   * ceiling. With `limit`, one request for that many and no paging: what
   * *try* sends.
   */
  search: (
    query: string,
    window: { from: Date; to: Date } | null,
    options?: { limit?: number }
  ) => Promise<ArxivFound>;
};

const ENDPOINT = "http://export.arxiv.org/api/query";
/** The ToU's gap between requests. */
const GAP_MS = 3000;
const PAGE = 100;
/** A safety limit, not a ranking cap: a broad Query must be loud, not a stack of thousands (ADR 0016 decision 11). */
export const CEILING = 500;
const TIMEOUT_MS = 30_000;

export function createArxivClient({
  fetch: fetcher,
  clock,
  endpoint = ENDPOINT,
}: ArxivOptions): ArxivClient {
  // One connection for every Scout: ten that are due together queue here
  // rather than trip the ToU, so the gap lives in the client and no caller
  // can forget it.
  const serially = serialised();
  let last: number | null = null;

  const request = (params: Record<string, string>) =>
    serially(async () => {
      if (last !== null) {
        const wait = last + GAP_MS - clock.now();
        if (wait > 0) await clock.sleep(wait);
      }
      last = clock.now();
      const url = `${endpoint}?${new URLSearchParams(params).toString()}`;
      let response: Response;
      try {
        response = await fetcher(url, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new ArxivError("network", "arXiv could not be reached");
      }
      if (response.status === 429) {
        throw new ArxivError("rate_limited", "HTTP 429", 429);
      }
      if (!response.ok) {
        throw new ArxivError(
          "http",
          `HTTP ${response.status}`,
          response.status
        );
      }
      return readFeed(await response.text().catch(() => ""));
    });

  return {
    search: async (query, window, options) => {
      const wrapped =
        window === null
          ? query
          : `(${query}) AND submittedDate:[${gmt(window.from)} TO ${gmt(window.to)}]`;
      const sorted = {
        sortBy: "submittedDate",
        sortOrder: "ascending",
      };
      if (options?.limit !== undefined) {
        const one = await request({
          search_query: wrapped,
          start: "0",
          max_results: String(options.limit),
          ...sorted,
        });
        return {
          items: one.items,
          total: one.total,
          moreMatched: Math.max(0, one.total - one.items.length),
        };
      }
      const items: ArxivItem[] = [];
      let total = 0;
      for (let start = 0; items.length < CEILING; start += PAGE) {
        const page = await request({
          search_query: wrapped,
          start: String(start),
          max_results: String(Math.min(PAGE, CEILING - items.length)),
          ...sorted,
        });
        total = page.total;
        items.push(...page.items);
        // A short page is the end whatever `totalResults` claimed.
        if (page.items.length === 0 || items.length >= total) break;
      }
      return { items, total, moreMatched: Math.max(0, total - items.length) };
    },
  };
}

/** `202609010000`: the form `submittedDate` takes, in GMT. */
function gmt(date: Date): string {
  return date.toISOString().replace(/[-:T]/g, "").slice(0, 12);
}

// Atom as arXiv writes it is regular enough that a library would only add a
// dependency: every element is read by its local name, namespace prefixes
// ignored, and an answer without the feed element is not a result.
function readFeed(xml: string): { items: ArxivItem[]; total: number } {
  if (!/<(?:\w+:)?feed[\s>]/.test(xml)) {
    throw new ArxivError("parse", "the answer was not an Atom feed");
  }
  const total = Number(text(xml.replace(/<entry[\s\S]*$/, ""), "totalResults"));
  if (!Number.isInteger(total)) {
    throw new ArxivError("parse", "the feed carried no total");
  }
  const items: ArxivItem[] = [];
  for (const entry of xml.match(/<entry[\s>][\s\S]*?<\/entry>/g) ?? []) {
    const id = text(entry, "id") ?? "";
    // A malformed Query comes back as a feed of one entry that says so; that
    // is the API's structure change, not an empty run (ADR 0016 decision 10).
    if (id.includes("/api/errors")) {
      throw new ArxivError("parse", text(entry, "summary") ?? "arXiv error");
    }
    const arxivId = id.replace(/^.*\/abs\//, "").replace(/v\d+$/, "");
    const url = alternateLink(entry);
    const published = text(entry, "published");
    const title = text(entry, "title");
    if (
      arxivId === "" ||
      url === null ||
      published === null ||
      title === null
    ) {
      throw new ArxivError("parse", "an entry lacked what a Proposal needs");
    }
    items.push({
      arxivId,
      title: collapse(title),
      authors: [...entry.matchAll(/<author>[\s\S]*?<\/author>/g)]
        .map(([author]) => text(author, "name"))
        .filter((name): name is string => name !== null)
        .map(collapse),
      published,
      venue: text(entry, "journal_ref"),
      abstract: (text(entry, "summary") ?? "").trim(),
      url,
      doi: text(entry, "doi"),
    });
  }
  return { items, total };
}

/** The text of the first `<name>` element, entities decoded; null when it is absent or empty. */
function text(xml: string, name: string): string | null {
  const found = new RegExp(
    `<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`
  ).exec(xml);
  const value = found?.[1] === undefined ? "" : decode(found[1]).trim();
  return value === "" ? null : value;
}

function alternateLink(entry: string): string | null {
  for (const [tag] of entry.matchAll(/<link\s[^>]*>/g)) {
    if (/\brel="alternate"/.test(tag)) {
      const href = /\bhref="([^"]*)"/.exec(tag)?.[1];
      return href === undefined ? null : decode(href);
    }
  }
  return null;
}

const collapse = (value: string) => value.replace(/\s+/g, " ").trim();

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decode(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|\w+);/gi,
    (whole, entity: string) => {
      if (entity.startsWith("#x")) {
        return String.fromCodePoint(parseInt(entity.slice(2), 16));
      }
      if (entity.startsWith("#")) {
        return String.fromCodePoint(parseInt(entity.slice(1), 10));
      }
      return ENTITIES[entity] ?? whole;
    }
  );
}
