import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, urlOf, virtualClock } from "./test-core.js";

afterEach(closeCores);

// The name search behind a venue or publisher rule (#807, ADR 0051 decision
// 9): asked only when a caller asks, labelled so near-identical names can be
// told apart, and a failed or spent search said as such, never as no results.

type Found = {
  outcome: "found";
  results: Array<{
    id: string;
    name: string;
    publisher: string | null;
    issn: string | null;
    worksCount: number;
  }>;
  creditsLeft: number | null;
};
type Failed = { outcome: "failed"; sentence: string };

const source = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `https://openalex.org/S${n}`,
  display_name: `Journal of Sleep ${n}`,
  type: "journal",
  host_organization_name: `Press ${n}`,
  issn_l: `0000-000${n}`,
  issn: [`0000-000${n}`],
  works_count: 1000 * n,
  ...extra,
});

async function searching(reply: (url: URL) => Response) {
  const asked: URL[] = [];
  const c = await core({
    openalex: {
      clock: virtualClock(),
      fetch: (input) => {
        const url = urlOf(input);
        asked.push(url);
        return Promise.resolve(reply(url));
      },
    },
  });
  return {
    asked,
    mutate: c.mutate,
    search: async (kind: "venue" | "publisher", name: string) => {
      const r = await c.mutate<Found | Failed>("scouts.searchNames", {
        kind,
        name,
      });
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
  };
}

describe("searching venues by name", () => {
  it("returns each source with its ID, publisher, ISSN and works count", async () => {
    const s = await searching(() =>
      Response.json(
        { meta: { count: 2 }, results: [source(1), source(2)] },
        { headers: { "x-ratelimit-remaining": "900" } }
      )
    );
    const found = await s.search("venue", "sleep");
    expect(found).toEqual({
      outcome: "found",
      creditsLeft: 900,
      results: [
        {
          id: "S1",
          name: "Journal of Sleep 1",
          publisher: "Press 1",
          issn: "0000-0001",
          worksCount: 1000,
        },
        {
          id: "S2",
          name: "Journal of Sleep 2",
          publisher: "Press 2",
          issn: "0000-0002",
          worksCount: 2000,
        },
      ],
    });
    const url = s.asked[0]!;
    expect(url.pathname).toBe("/sources");
    expect(url.searchParams.get("search")).toBe("sleep");
    // Published venues only, as every OpenAlex Scout asks (decision 3).
    expect(url.searchParams.get("filter")).toBe("type:journal|conference");
  });

  it("leaves a field OpenAlex did not give empty, and takes the first ISSN when there is no linking one", async () => {
    const s = await searching(() =>
      Response.json({
        meta: { count: 1 },
        results: [
          source(3, {
            host_organization_name: null,
            issn_l: null,
            issn: ["1111-2222", "3333-4444"],
          }),
        ],
      })
    );
    const found = (await s.search("venue", "x")) as Found;
    expect(found.results[0]).toMatchObject({
      publisher: null,
      issn: "1111-2222",
    });
  });
});

describe("searching publishers by name", () => {
  it("asks the publishers and returns ID, name and works count", async () => {
    const s = await searching(() =>
      Response.json({
        meta: { count: 1 },
        results: [
          {
            id: "https://openalex.org/P9",
            display_name: "MDPI",
            works_count: 500000,
          },
        ],
      })
    );
    const found = (await s.search("publisher", "mdpi")) as Found;
    expect(found.results).toEqual([
      {
        id: "P9",
        name: "MDPI",
        publisher: null,
        issn: null,
        worksCount: 500000,
      },
    ]);
    expect(s.asked[0]!.pathname).toBe("/publishers");
    expect(s.asked[0]!.searchParams.get("search")).toBe("mdpi");
  });
});

describe("a search that did not give an answer", () => {
  it("says a network failure and does not return an empty list", async () => {
    const s = await searching(() => {
      throw new TypeError("offline");
    });
    const failed = (await s.search("venue", "sleep")) as Failed;
    expect(failed.outcome).toBe("failed");
    expect(failed.sentence).toMatch(/OpenAlex/);
  });

  it("says a spent budget is waiting and does not say the user spent it", async () => {
    const s = await searching(
      () =>
        new Response("{}", {
          status: 429,
          headers: { "x-ratelimit-reset": "60" },
        })
    );
    const failed = (await s.search("venue", "sleep")) as Failed;
    expect(failed.outcome).toBe("failed");
    expect(failed.sentence).toMatch(/waiting/);
    expect(failed.sentence).not.toMatch(/you/i);
  });

  it("says an unreadable answer is a failure, not no results", async () => {
    const s = await searching(() => Response.json({ nope: true }));
    expect((await s.search("venue", "sleep")).outcome).toBe("failed");
  });

  it("says no results as found with an empty list", async () => {
    const s = await searching(() =>
      Response.json({ meta: { count: 0 }, results: [] })
    );
    expect(await s.search("venue", "zzzz")).toMatchObject({
      outcome: "found",
      results: [],
    });
  });

  it("refuses an empty name without sending anything", async () => {
    const s = await searching(() => Response.json({}));
    const r = await s.mutate("scouts.searchNames", {
      kind: "venue",
      name: " ",
    });
    expect(r.error?.message).toMatch(/name/i);
    expect(s.asked).toEqual([]);
  });
});
