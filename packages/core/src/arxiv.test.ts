import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArxivError, createArxivClient } from "./arxiv.js";
import { fixtures, urlOf, virtualClock } from "./test-core.js";

// The one arXiv client every Scout shares (`docs/architecture.md` § Scouts,
// ADR 0016 decision 3): paged, serialised under the ToU's three-second gap,
// cut at a ceiling, and honest about an answer it could not read.

const atom = (name: string) =>
  readFile(join(fixtures, "arxiv", `${name}.xml`), "utf8");

const respond = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { "content-type": "application/atom+xml" },
  });

/** A feed of `count` entries, ids from `first`, claiming `total` matches. */
function feed(total: number, first: number, count: number): string {
  const entries = Array.from({ length: count }, (_, i) => {
    const id = `2609.${String(first + i).padStart(5, "0")}`;
    return `<entry><id>http://arxiv.org/abs/${id}v1</id><published>2026-09-28T00:00:00Z</published><title>Paper ${id}</title><summary>s</summary><author><name>A B</name></author><link href="http://arxiv.org/abs/${id}v1" rel="alternate" type="text/html"/></entry>`;
  });
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>${total}</opensearch:totalResults>${entries.join("")}</feed>`;
}

const WINDOW = {
  from: new Date("2026-09-01T00:00:00Z"),
  to: new Date("2026-09-30T12:34:00Z"),
};

describe("the arXiv client", () => {
  it("wraps the query in the window, GMT, and sorts oldest first", async () => {
    const requested: URL[] = [];
    const client = createArxivClient({
      fetch: (url) => {
        requested.push(urlOf(url));
        return Promise.resolve(respond(feed(0, 0, 0)));
      },
      clock: virtualClock(),
    });

    await client.search("cat:cs.LG AND ti:probing", WINDOW);

    const params = requested[0]!.searchParams;
    expect(params.get("search_query")).toBe(
      "(cat:cs.LG AND ti:probing) AND submittedDate:[202609010000 TO 202609301234]"
    );
    expect(params.get("max_results")).toBe("100");
    expect(params.get("sortBy")).toBe("submittedDate");
    expect(params.get("sortOrder")).toBe("ascending");
  });

  it("maps the fields as § Scouts lists, and never keywords", async () => {
    const client = createArxivClient({
      fetch: async () => respond(await atom("normal")),
      clock: virtualClock(),
    });

    const found = await client.search("q", WINDOW);

    expect(found.total).toBe(2);
    expect(found.items).toEqual([
      {
        arxivId: "2609.01234",
        title: "Probing the Overnight Benefit: Consolidation or Encoding?",
        authors: ["Anna Müller", "Jan Born"],
        published: "2026-09-28T17:59:59Z",
        venue: "Journal of Sleep Research 12 (2026) 1-9",
        abstract: expect.stringContaining(
          "consolidation & not to encoding"
        ) as string,
        url: "http://arxiv.org/abs/2609.01234v1",
        doi: "10.1000/xyz123",
      },
      {
        arxivId: "2609.05678",
        title: "Slow Oscillations Reconsidered",
        authors: ["Ana van der Meer"],
        published: "2026-09-29T10:00:00Z",
        venue: null,
        abstract: "A short abstract.",
        url: "http://arxiv.org/abs/2609.05678v1",
        doi: null,
      },
    ]);
    expect(Object.keys(found.items[0]!)).not.toContain("keywords");
  });

  it("reads an empty feed as an empty run, not a failure", async () => {
    const client = createArxivClient({
      fetch: async () => respond(await atom("empty")),
      clock: virtualClock(),
    });

    expect(await client.search("q", WINDOW)).toEqual({
      items: [],
      total: 0,
      moreMatched: 0,
    });
  });

  it("takes a feed whose one entry is an error as a parse failure", async () => {
    const client = createArxivClient({
      fetch: async () => respond(await atom("error")),
      clock: virtualClock(),
    });

    await expect(client.search("(", WINDOW)).rejects.toMatchObject({
      kind: "parse",
    });
  });

  it("takes an answer that is not a feed at all as a parse failure", async () => {
    const client = createArxivClient({
      fetch: () => Promise.resolve(respond("<html>maintenance</html>")),
      clock: virtualClock(),
    });

    await expect(client.search("q", WINDOW)).rejects.toBeInstanceOf(ArxivError);
    await expect(client.search("q", WINDOW)).rejects.toMatchObject({
      kind: "parse",
    });
  });

  it.each([
    [429, "rate_limited"],
    [503, "http"],
    [404, "http"],
  ])("answers %i as %s, carrying the status", async (status, kind) => {
    const client = createArxivClient({
      fetch: () => Promise.resolve(respond("", status)),
      clock: virtualClock(),
    });

    await expect(client.search("q", WINDOW)).rejects.toMatchObject({
      kind,
      status,
    });
  });

  it("takes a request that never got an answer as a network failure", async () => {
    const client = createArxivClient({
      fetch: () => Promise.reject(new TypeError("fetch failed")),
      clock: virtualClock(),
    });

    await expect(client.search("q", WINDOW)).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("keeps three seconds between requests on its one connection", async () => {
    const clock = virtualClock();
    const stamps: number[] = [];
    const client = createArxivClient({
      fetch: () => {
        stamps.push(clock.now());
        return Promise.resolve(respond(feed(0, 0, 0)));
      },
      clock,
    });

    // Three searches asked for together, as three Scouts due at once would.
    await Promise.all([
      client.search("a", WINDOW),
      client.search("b", WINDOW),
      client.search("c", WINDOW),
    ]);

    expect(stamps.slice(1).map((at, i) => at - stamps[i]!)).toEqual([
      3000, 3000,
    ]);
  });

  it("does not wait before the first request, nor for time that has passed anyway", async () => {
    const clock = virtualClock();
    const client = createArxivClient({
      fetch: () => Promise.resolve(respond(feed(0, 0, 0))),
      clock,
    });

    await client.search("a", WINDOW);
    expect(clock.slept).toEqual([]);

    await clock.sleep(10_000);
    await client.search("b", WINDOW);
    expect(clock.slept).toEqual([10_000]);
  });

  it("pages at 100 and stops at the ceiling, saying how many more matched", async () => {
    const starts: string[] = [];
    const client = createArxivClient({
      fetch: (url) => {
        const start = Number(urlOf(url).searchParams.get("start"));
        starts.push(String(start));
        return Promise.resolve(respond(feed(730, start, 100)));
      },
      clock: virtualClock(),
    });

    const found = await client.search("q", WINDOW);

    expect(starts).toEqual(["0", "100", "200", "300", "400"]);
    expect(found.items).toHaveLength(500);
    expect(found.moreMatched).toBe(230);
    // The ceiling cuts the newest: the oldest 500 are the ones kept.
    expect(found.items[0]!.arxivId).toBe("2609.00000");
    expect(found.items[499]!.arxivId).toBe("2609.00499");
  });

  it("stops when a page comes back short, with nothing left unsaid", async () => {
    let calls = 0;
    const client = createArxivClient({
      fetch: (url) => {
        calls++;
        const start = Number(urlOf(url).searchParams.get("start"));
        return Promise.resolve(
          respond(feed(130, start, start === 0 ? 100 : 30))
        );
      },
      clock: virtualClock(),
    });

    const found = await client.search("q", WINDOW);

    expect(calls).toBe(2);
    expect(found.items).toHaveLength(130);
    expect(found.moreMatched).toBe(0);
  });

  it("tries a query once with no window, for the first five titles", async () => {
    const requested: URL[] = [];
    const client = createArxivClient({
      fetch: (url) => {
        requested.push(urlOf(url));
        return Promise.resolve(respond(feed(40, 0, 5)));
      },
      clock: virtualClock(),
    });

    const tried = await client.search("cat:cs.LG", null, { limit: 5 });

    const params = requested[0]!.searchParams;
    expect(params.get("search_query")).toBe("cat:cs.LG");
    expect(params.get("max_results")).toBe("5");
    expect(requested).toHaveLength(1);
    expect(tried.total).toBe(40);
  });
});
