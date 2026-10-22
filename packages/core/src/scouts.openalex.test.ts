import { mkdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Card, RunSummary } from "./scouts.js";
import type { Scout, UnreadableScout } from "./scout-file.js";
import type { FleetHealth } from "./scout-health.js";
import {
  closeCores,
  core,
  fixtureCopy,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// An OpenAlex Scout written by hand (#801, spec #800): its Query runs against
// a stand-in endpoint, journal and conference work becomes cards, and every
// failure says OpenAlex. Nothing here reaches the real API.

const NOW = new Date("2026-09-30T12:34:00Z");

const scoutYaml = (filter: string, kind = "openalex") =>
  `name: Published sleep\nsource:\n  kind: ${kind}\ncadence: daily\nlane: review\ncreated: 2026-09-20T00:00:00Z\nfilter:\n${filter}\n`;

const QUERY = scoutYaml(`  query: '"sleep consolidation"'`);

type Work = Record<string, unknown>;

/** A work as OpenAlex's works endpoint answers it. */
const work = (over: Work = {}): Work => ({
  id: "https://openalex.org/W1",
  doi: "https://doi.org/10.1000/Sleep.1",
  title: "Slow Oscillations Reconsidered",
  publication_date: "2026-09-22",
  authorships: [
    { author: { display_name: "Ada Meer" } },
    { author: { display_name: "B. Quist" } },
  ],
  abstract_inverted_index: { Sleep: [0, 3], helps: [1], memory: [2, 4] },
  primary_location: {
    landing_page_url: "https://journal.example/slow",
    source: { display_name: "Journal of Sleep", type: "journal" },
  },
  ...over,
});

const page = (results: Work[], count = results.length) =>
  Response.json({ meta: { count }, results });

async function opened(
  answer: (url: URL) => Response | Promise<Response>,
  scouts: Record<string, string> = { "pub.yaml": QUERY },
  vaultFiles: Record<string, string> = {}
) {
  const vault = await fixtureCopy("obsidian-vault");
  for (const [file, text] of Object.entries({
    ...Object.fromEntries(
      Object.entries(scouts).map(([f, t]) => [`.vitrine/scouts/${f}`, t])
    ),
    ...vaultFiles,
  })) {
    await mkdir(dirname(join(vault, file)), { recursive: true });
    await writeFile(join(vault, file), text);
  }
  const requests: URL[] = [];
  const c = await core({
    now: () => NOW,
    openalex: {
      clock: virtualClock(),
      fetch: async (input) => {
        const url = urlOf(input);
        requests.push(url);
        return answer(url);
      },
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  return {
    c,
    requests,
    run: async (scoutId = "pub") => {
      const r = await c.mutate<RunSummary>("scouts.runNow", { scoutId });
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    cards: async () =>
      (await c.query<Card[]>("scouts.queue", { sort: "newest" })).result!.data,
    list: async () =>
      (
        await c.query<{ scouts: Scout[]; unreadable: UnreadableScout[] }>(
          "scouts.list"
        )
      ).result!.data,
    health: async () =>
      (await c.query<FleetHealth>("scouts.health")).result!.data,
    runRows: () => {
      const db = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"), {
        readOnly: true,
      });
      try {
        return db
          .prepare(
            "SELECT outcome, error_kind, error_message, query FROM scout_runs"
          )
          .all();
      } finally {
        db.close();
      }
    },
  };
}

describe("a hand-written OpenAlex Scout file", () => {
  it("is read as found", async () => {
    const c = await opened(() => page([]));
    const { scouts } = await c.list();
    expect(scouts[0]).toMatchObject({
      id: "pub",
      source: { kind: "openalex" },
      query: '"sleep consolidation"',
    });
  });

  it("reads Tags as an arXiv Scout does", async () => {
    const c = await opened(() => page([]), {
      "pub.yaml": scoutYaml("  tags:\n    - '#sleep'"),
    });
    expect((await c.list()).scouts[0]).toMatchObject({
      source: { kind: "openalex" },
      tags: ["#sleep"],
      query: "",
    });
  });

  it.each([
    [
      "both",
      "  query: x\n  tags:\n    - '#a'",
      "it has both filter.tags and filter.query, and a Scout has one",
    ],
    ["neither", "  other: 1", "it has neither filter.tags nor filter.query"],
    ["an empty tags list", "  tags: []", "filter.tags is not a list of Tags"],
  ])("is unreadable by name with %s", async (_, filter, problem) => {
    const c = await opened(() => page([]), { "pub.yaml": scoutYaml(filter) });
    const { scouts, unreadable } = await c.list();
    expect(scouts).toEqual([]);
    expect(unreadable).toEqual([
      {
        file: "pub.yaml",
        sentence: `This file could not be read: ${problem}.`,
      },
    ]);
  });

  it("is unreadable when filter is not a map", async () => {
    const c = await opened(() => page([]), {
      "pub.yaml":
        "name: P\nsource:\n  kind: openalex\ncadence: daily\ncreated: 2026-09-20T00:00:00Z\nfilter: sleep\n",
    });
    expect((await c.list()).unreadable).toHaveLength(1);
  });

  it("still reads a file with no source.kind as arXiv", async () => {
    const c = await opened(() => page([]), {
      "old.yaml":
        "name: Old\ncadence: daily\ncreated: 2026-09-20T00:00:00Z\nfilter:\n  query: all:sleep\n",
    });
    expect((await c.list()).scouts[0]?.source).toEqual({ kind: "arxiv" });
  });
});

describe("running an OpenAlex Scout", () => {
  it("asks for journal and conference work that is not retracted, with the Query", async () => {
    const c = await opened(() => page([]));
    await c.run();
    const url = c.requests[0]!;
    const filter = url.searchParams.get("filter")!;
    expect(filter).toContain("primary_location.source.type:journal|conference");
    expect(filter).toContain("is_retracted:false");
    expect(filter).toContain('title_and_abstract.search:"sleep consolidation"');
    expect(filter).not.toContain("repository");
    expect(url.searchParams.get("per-page")).toBe("200");
    expect(c.runRows()).toMatchObject([
      {
        outcome: "ok",
        query: expect.stringContaining("sleep consolidation") as string,
      },
    ]);
  });

  it("opens the window at the Scout's creation on the first run", async () => {
    const c = await opened(() => page([]));
    await c.run();
    expect(c.requests[0]!.searchParams.get("filter")).toContain(
      "from_publication_date:2026-09-20"
    );
  });

  it("makes cards that carry the source's own fields, with the venue kind", async () => {
    const c = await opened(() =>
      page([
        work(),
        work({
          id: "https://openalex.org/W2",
          doi: null,
          title: "A Talk",
          abstract_inverted_index: null,
          publication_date: "2026-09-25",
          primary_location: {
            landing_page_url: "https://conf.example/talk",
            source: { display_name: "SleepConf 2026", type: "conference" },
          },
        }),
      ])
    );
    const summary = await c.run();
    expect(summary).toMatchObject({ outcome: "ok", fetched: 2, new: 2 });
    const cards = await c.cards();
    const slow = cards.find((card) => card.title.startsWith("Slow"))!;
    expect(slow).toMatchObject({
      authors: ["Ada Meer", "B. Quist"],
      published: "2026-09-22",
      venue: "Journal of Sleep",
      venueType: "journal",
      doi: "10.1000/sleep.1",
      url: "https://journal.example/slow",
      abstract: "Sleep helps memory Sleep memory",
    });
    const talk = cards.find((card) => card.title === "A Talk")!;
    expect(talk).toMatchObject({
      venue: "SleepConf 2026",
      venueType: "conference",
      abstract: "",
    });
  });

  it("falls back to the DOI link when there is no landing page, and never composes an abstract", async () => {
    const c = await opened(() =>
      page([
        work({
          primary_location: {
            source: { display_name: "Journal of Sleep", type: "journal" },
          },
          abstract_inverted_index: undefined,
        }),
      ])
    );
    await c.run();
    const [card] = await c.cards();
    expect(card).toMatchObject({
      url: "https://doi.org/10.1000/Sleep.1",
      abstract: "",
    });
  });

  it("counts a work held in the vault by DOI as held, not a card", async () => {
    const c = await opened(
      () => page([work()]),
      { "pub.yaml": QUERY },
      {
        "sources/held.md":
          "---\nkind: source\ncitekey: held2026\ntitle: Held\ndoi: 10.1000/SLEEP.1\n---\n",
      }
    );
    await c.c.indexed();
    const summary = await c.run();
    expect(summary).toMatchObject({ new: 0, held: 1 });
    expect(await c.cards()).toEqual([]);
  });

  it("pages at 200 and says how many more matched at the ceiling", async () => {
    const many = (start: number, n: number) =>
      Array.from({ length: n }, (_, i) =>
        work({
          id: `https://openalex.org/W${start + i}`,
          doi: `https://doi.org/10.1/${start + i}`,
        })
      );
    const c = await opened((url) => {
      const n = Number(url.searchParams.get("page"));
      return page(many(n * 1000, 200), 450);
    });
    const summary = await c.run();
    expect(summary).toMatchObject({ fetched: 400, truncated: 50 });
    expect(c.requests.map((u) => u.searchParams.get("page"))).toEqual([
      "1",
      "2",
    ]);
  });

  it.each([
    [
      "network",
      () => Promise.reject(new TypeError("down")),
      /OpenAlex could not be reached/,
    ],
    [
      "http",
      () => Promise.resolve(new Response("", { status: 500 })),
      /OpenAlex answered with an error \(HTTP 500\)/,
    ],
    [
      "rate_limited",
      () => Promise.resolve(new Response("", { status: 429 })),
      /OpenAlex's daily budget is used up, so this Scout is waiting/,
    ],
    [
      "parse",
      () => Promise.resolve(Response.json({ nothing: true })),
      /OpenAlex's answer did not read as a search result/,
    ],
  ])(
    "records a %s failure that names OpenAlex",
    async (kind, reply, sentence) => {
      const c = await opened(reply);
      const summary = await c.run();
      expect(summary).toMatchObject({ outcome: "failed", errorKind: kind });
      expect(c.runRows()).toMatchObject([
        { outcome: "failed", error_kind: kind },
      ]);
      const health = await c.health();
      expect(JSON.stringify(health)).toMatch(sentence);
    }
  );

  it("fails by name when its Tags compile to nothing", async () => {
    const c = await opened(() => page([]), {
      "pub.yaml": scoutYaml("  tags:\n    - '#nothing-here'"),
    });
    const summary = await c.run();
    expect(summary).toMatchObject({ outcome: "failed", errorKind: "tags" });
    expect(c.requests).toEqual([]);
  });
});
