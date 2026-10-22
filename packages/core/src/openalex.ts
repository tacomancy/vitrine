import type { ArxivClock } from "./arxiv.js";
import { serialised } from "./serialise.js";
import { arxivIdOf } from "./source-key.js";

/**
 * The one OpenAlex client (ADR 0045; `docs/architecture.md` § Lexicon). It
 * takes its `fetch` and clock as parameters, and an endpoint the demo and
 * tests point at a stand-in, so neither ever reaches the real API. Only
 * compiled Terms are sent; there is no credential.
 */

export type OpenAlexOptions = {
  fetch: typeof fetch;
  clock: ArxivClock;
  endpoint?: string;
  /** The URL length past which a query is split; tests shorten it. */
  maxUrl?: number;
};

export type OpenAlexErrorKind = "network" | "http" | "rate_limited" | "parse";

export class OpenAlexError extends Error {
  constructor(
    readonly kind: OpenAlexErrorKind,
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

/** Where OpenAlex's own arXiv repository record lives: a location from it is the arXiv copy (ADR 0051 decision 10). */
const ARXIV_SOURCE = "https://openalex.org/S4306400194";

/** Works a request asks for; OpenAlex's largest page. */
export const WORKS_PAGE = 200;
/** A safety limit, not a ranking cap: a broad Query must be loud (ADR 0051 decision 7). */
export const WORKS_CEILING = 400;
/** The days before a run's window that every run asks again, so work OpenAlex indexed late is not missed (ADR 0051 decision 7). */
export const LOOKBACK_DAYS = 60;

/** A work as the Scout runner needs it. A field OpenAlex did not supply is empty or `null`, never composed. */
export type OpenAlexWork = {
  title: string;
  authors: string[];
  /** `YYYY-MM-DD` as OpenAlex dates it; empty when it gave none. */
  published: string;
  venue: string | null;
  venueType: "journal" | "conference" | null;
  /** Lower-cased, without the `doi.org` prefix. */
  doi: string | null;
  /** The primary location's landing page, else the DOI link, else OpenAlex's own id. */
  url: string;
  /** Rebuilt from OpenAlex's inverted index; empty when it has none. */
  abstract: string;
  /** The id of an arXiv-repository copy, when one of the work's locations is. */
  arxivId: string | null;
};

export type OpenAlexFound = {
  works: OpenAlexWork[];
  total: number;
  /** How many matched beyond the ceiling and were not fetched; 0 when nothing was cut. */
  moreMatched: number;
  /** `x-ratelimit-remaining` on the last answer: the shared daily budget as OpenAlex states it; null when it did not say. */
  creditsLeft: number | null;
};

export type OpenAlexClient = {
  /**
   * Journal and conference work that is not retracted and matches `search`
   * (OpenAlex search syntax), published inside the window. Never a
   * repository (ADR 0051 decision 3). With no window and a `limit` it is
   * *try*: one request for that many works and the total, nothing paged.
   */
  searchWorks: (
    search: string,
    window: { from: Date; to: Date } | null,
    options?: { limit: number }
  ) => Promise<OpenAlexFound>;
  /**
   * How many works the Terms match in each month (`YYYY-MM`), in the order
   * asked. One count per month, so a different growth definition recomputes
   * from what is stored without another request (ADR 0045 decision 1).
   */
  monthlyCounts: (terms: string[], months: string[]) => Promise<number[]>;
};

const ENDPOINT = "https://api.openalex.org/works";
/** OpenAlex's limit is 10 requests a second; this stays well under it. */
const GAP_MS = 150;
const TIMEOUT_MS = 30_000;
/** The spec's "nears 4 KB": some headroom under the 4096 a server may refuse. */
const MAX_URL = 3800;
const ID_PAGE = 200;
/** When the response says the budget is spent but not when it returns: a day. */
const DAY_MS = 86_400_000;

/** The compiled query, verbatim as the editor shows it and a Measurement stores it. */
/** What `compileOpenAlexQuery` begins with; a run sends the rest as its search, so both read this one constant. */
export const SEARCH_FILTER = "filter=title_and_abstract.search:";
export const compileOpenAlexQuery = (terms: readonly string[]) =>
  `${SEARCH_FILTER}(${terms.map((t) => `"${t}"`).join(" OR ")})`;

/** First and last day of a `YYYY-MM`, as OpenAlex's date filters take them. */
function monthBounds(month: string): { from: string; to: string } {
  const [year, mon] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, "0")}`,
  };
}

export function createOpenAlexClient({
  fetch: fetcher,
  clock,
  endpoint = ENDPOINT,
  maxUrl = MAX_URL,
}: OpenAlexOptions): OpenAlexClient {
  const serially = serialised();
  let last: number | null = null;
  // Set when a response says the budget is spent: every request until then
  // fails as rate_limited without being sent, so the sync stops cleanly.
  let exhaustedUntil = 0;
  // The budget as the last good answer stated it.
  let creditsLeft: number | null = null;

  const urlFor = (terms: string[], month: string, extra: string) => {
    const { from, to } = monthBounds(month);
    const filter = `${compileOpenAlexQuery(terms).slice("filter=".length)},from_publication_date:${from},to_publication_date:${to}`;
    return `${endpoint}?${new URLSearchParams({ filter }).toString()}&${extra}`;
  };

  const request = (url: string) =>
    serially(async () => {
      if (clock.now() < exhaustedUntil) {
        throw new OpenAlexError("rate_limited", "the daily budget is spent");
      }
      if (last !== null) {
        const wait = last + GAP_MS - clock.now();
        if (wait > 0) await clock.sleep(wait);
      }
      last = clock.now();
      let response: Response;
      try {
        response = await fetcher(url, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new OpenAlexError("network", "OpenAlex could not be reached");
      }
      if (response.status === 429) {
        exhaustedUntil = clock.now() + resetMs(response);
        throw new OpenAlexError("rate_limited", "HTTP 429", 429);
      }
      if (!response.ok) {
        throw new OpenAlexError(
          "http",
          `HTTP ${response.status}`,
          response.status
        );
      }
      const stated = response.headers.get("x-ratelimit-remaining");
      creditsLeft =
        stated !== null &&
        stated.trim() !== "" &&
        Number.isFinite(Number(stated))
          ? Number(stated)
          : null;
      // This answer is good; the budget behind it may be spent, and the next
      // request must not be sent into a 429.
      if (response.headers.get("x-ratelimit-remaining") === "0") {
        exhaustedUntil = clock.now() + resetMs(response);
      }
      try {
        return await response.json();
      } catch {
        throw new OpenAlexError("parse", "the answer was not JSON");
      }
    });

  const count = async (terms: string[], month: string) => {
    const body = (await request(urlFor(terms, month, "per-page=1"))) as {
      meta?: { count?: unknown };
    };
    const n = body?.meta?.count;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
      throw new OpenAlexError("parse", "the answer carried no count");
    }
    return n;
  };

  // A count cannot be unioned (two chunks may match the same work), so a
  // split query reads the ids and unions those.
  const unionCount = async (chunks: string[][], month: string) => {
    const ids = new Set<string>();
    for (const chunk of chunks) {
      let cursor: string | null = "*";
      while (cursor !== null) {
        const body = (await request(
          urlFor(
            chunk,
            month,
            `select=id&per-page=${ID_PAGE}&cursor=${encodeURIComponent(cursor)}`
          )
        )) as {
          results?: Array<{ id?: unknown }>;
          meta?: { next_cursor?: unknown };
        };
        if (!Array.isArray(body?.results)) {
          throw new OpenAlexError("parse", "the answer carried no results");
        }
        for (const { id } of body.results) {
          if (typeof id === "string") ids.add(id);
        }
        const next = body.meta?.next_cursor;
        cursor =
          typeof next === "string" && body.results.length > 0 ? next : null;
      }
    }
    return ids.size;
  };

  const searchWorks: OpenAlexClient["searchWorks"] = async (
    search,
    window,
    options
  ) => {
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const filter = [
      "primary_location.source.type:journal|conference",
      "is_retracted:false",
      `title_and_abstract.search:${search}`,
      ...(window === null
        ? []
        : [
            `from_publication_date:${day(window.from)}`,
            `to_publication_date:${day(window.to)}`,
          ]),
    ].join(",");
    const perPage = options?.limit ?? WORKS_PAGE;
    const works: OpenAlexWork[] = [];
    let total = 0;
    for (let n = 1; works.length < WORKS_CEILING; n++) {
      const body = (await request(
        `${endpoint}?${new URLSearchParams({ filter, "per-page": String(perPage), page: String(n) }).toString()}`
      )) as { meta?: { count?: unknown }; results?: unknown };
      const count = body?.meta?.count;
      if (
        !Array.isArray(body?.results) ||
        typeof count !== "number" ||
        !Number.isInteger(count) ||
        count < 0
      ) {
        throw new OpenAlexError("parse", "the answer carried no results");
      }
      total = count;
      for (const raw of body.results) works.push(readWork(raw));
      if (body.results.length < perPage || works.length >= total) break;
      if (options !== undefined) break;
    }
    return {
      works: works.slice(0, WORKS_CEILING),
      total,
      moreMatched: Math.max(0, total - WORKS_CEILING),
      creditsLeft,
    };
  };

  return {
    searchWorks,
    monthlyCounts: async (terms, months) => {
      const chunks = splitToFit(
        terms,
        (chunk) => urlFor(chunk, "2000-01", "per-page=1").length <= maxUrl
      );
      const counts: number[] = [];
      for (const month of months) {
        counts.push(
          chunks.length === 1
            ? await count(terms, month)
            : await unionCount(chunks, month)
        );
      }
      return counts;
    },
  };
}

/** How long the budget stays spent, from `X-RateLimit-Reset` (seconds) or `Retry-After`; a day when neither says. */
function resetMs(response: Response): number {
  for (const name of ["x-ratelimit-reset", "retry-after"]) {
    const seconds = Number(response.headers.get(name));
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }
  return DAY_MS;
}

/** The Terms in as few chunks as keep each chunk's URL within the limit; one Term is never cut. */
function splitToFit(
  terms: string[],
  fits: (chunk: string[]) => boolean
): string[][] {
  if (fits(terms)) return [terms];
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const term of terms) {
    if (current.length > 0 && !fits([...current, term])) {
      chunks.push(current);
      current = [];
    }
    current.push(term);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

type Raw = Record<string, unknown>;

/** A value as a map, or an empty one: every field of a work is optional. */
const rec = (value: unknown): Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Raw)
    : {};
const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

function readWork(raw: unknown): OpenAlexWork {
  if (typeof raw !== "object" || raw === null) {
    throw new OpenAlexError("parse", "a work was not an object");
  }
  const w = raw as Raw;
  const title = text(w["title"])?.trim();
  if (title === undefined || title === "") {
    throw new OpenAlexError("parse", "a work carried no title");
  }
  const primary = rec(w["primary_location"]);
  const source = rec(primary["source"]);
  const doiLink = text(w["doi"]);
  const type = source["type"];
  return {
    title,
    authors: (Array.isArray(w["authorships"]) ? w["authorships"] : []).flatMap(
      (a: unknown) => {
        const name = text(rec(rec(a)["author"])["display_name"]);
        return name === null ? [] : [name];
      }
    ),
    published: text(w["publication_date"]) ?? "",
    venue: text(source["display_name"]),
    venueType: type === "journal" || type === "conference" ? type : null,
    doi:
      doiLink === null
        ? null
        : doiLink.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase(),
    url: text(primary["landing_page_url"]) ?? doiLink ?? text(w["id"]) ?? "",
    abstract: abstractOf(w["abstract_inverted_index"]),
    arxivId: arxivIdOfLocations(w["locations"]),
  };
}

/** OpenAlex ships an abstract as word → positions; sorting the positions gives the text back. Absent stays empty. */
function abstractOf(index: unknown): string {
  const words: string[] = [];
  for (const [word, at] of Object.entries(rec(index))) {
    if (Array.isArray(at)) for (const i of at) words[Number(i)] = word;
  }
  // Positions can leave holes (a missing index), which join would print as blanks.
  return words.filter((w) => w !== undefined).join(" ");
}

function arxivIdOfLocations(locations: unknown): string | null {
  if (!Array.isArray(locations)) return null;
  for (const location of locations) {
    const l = rec(location);
    if (rec(l["source"])["id"] !== ARXIV_SOURCE) continue;
    for (const field of ["landing_page_url", "pdf_url"]) {
      const url = text(l[field]);
      const id = url === null ? null : arxivIdOf(url);
      if (id !== null) return id;
    }
  }
  return null;
}
