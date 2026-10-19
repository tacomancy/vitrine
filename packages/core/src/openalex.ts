import type { ArxivClock } from "./arxiv.js";
import { serialised } from "./serialise.js";

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

export type OpenAlexClient = {
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
export const compileOpenAlexQuery = (terms: readonly string[]) =>
  `filter=title_and_abstract.search:(${terms.map((t) => `"${t}"`).join(" OR ")})`;

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

  return {
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
