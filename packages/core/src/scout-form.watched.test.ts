import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryCredentialStore } from "./credentials.js";
import {
  ModelError,
  type ExtractedItem,
  type Extraction,
  type ModelProvider,
} from "./model-provider.js";
import type { Scout } from "./scout-file.js";
import type { Health } from "./scout-health.js";
import type { TriedPage, TriedPages } from "./scout-form.js";
import { costUsd } from "./model-prices.js";
import {
  copiesNothing,
  closeCores,
  core,
  fixtureCopy,
  fixtures,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// #469: the Scout form's *Watching* choice. Driven through the router; what a
// hand edit would write, what *try* shows and what it leaves unwritten.

const NOW = new Date("2026-10-05T12:00:00Z");
const LAB = "https://lab.example/publications";
const page = (name: string) =>
  readFile(join(fixtures, "watched", name), "utf8");
const PAGE = await page("lab-page.html");
const WITH_FEED = await page("lab-page-with-feed.html");
const FEED = await page("lab-feed.atom.xml");

const item = (over: Partial<ExtractedItem>): ExtractedItem => ({
  title: null,
  authors: null,
  date: null,
  venue: null,
  keywords: null,
  abstract: null,
  url: null,
  ...over,
});
const GOOD = [
  item({
    title: "Overnight Replay Consolidates Declarative Memory",
    url: "https://arxiv.org/abs/2609.01234v2?utm_source=lab",
  }),
  item({
    title: "Sleep Spindles Predict Next-Day Learning",
    url: "https://lab.example/papers/spindles/",
  }),
];
const INVENTED = item({
  title: "Sleep Cures Everything",
  url: "https://lab.example/papers/cures",
});
const usage = { input: 1200, output: 300, cacheRead: 0 };

async function opened(
  options: {
    served?: Record<string, { body: string; type?: string }>;
    key?: string | null;
    model?: () => Extraction | Error;
    /** The model's copy of an Item page; nothing found, at no cost, by default. */
    itemPage?: ModelProvider["extractItemPage"];
    modelId?: string;
  } = {}
) {
  const vault = await fixtureCopy("obsidian-vault");
  const served = options.served ?? { "/publications": { body: PAGE } };
  let extractions = 0;
  const asked: string[] = [];
  const models: ModelProvider = {
    extractItemPage: options.itemPage ?? copiesNothing,
    countTokens: ({ text }) => Promise.resolve(Math.ceil(text.length / 4)),
    extract: () => {
      extractions++;
      const answer = (options.model ?? (() => ({ items: GOOD, usage })))();
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    },
  };
  const c = await core({
    now: () => NOW,
    arxiv: {
      clock: virtualClock(),
      fetch: () => Promise.resolve(new Response("")),
    },
    watched: {
      timeoutMs: 1000,
      models,
      credentials: createMemoryCredentialStore(
        options.key === null ? {} : { anthropic: options.key ?? "sk-test" }
      ),
      model: options.modelId ?? "claude-sonnet-5-5",
      fetch: (input) => {
        const url = urlOf(input);
        asked.push(url.pathname);
        const found = served[url.pathname];
        return Promise.resolve(
          found === undefined
            ? new Response("", { status: 404 })
            : new Response(found.body, {
                headers: { "content-type": found.type ?? "text/html" },
              })
        );
      },
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const ok = async <T>(
    kind: "query" | "mutate",
    path: string,
    input?: unknown
  ) => {
    const r = await c[kind]<T>(path, input);
    expect(r.error).toBeUndefined();
    return r.result!.data;
  };
  return {
    vault,
    c,
    extractions: () => extractions,
    /** Every path asked for, robots.txt aside. */
    asked: () => asked.filter((p) => p !== "/robots.txt"),
    save: (input: Record<string, unknown>) =>
      ok<{ id: string }>("mutate", "scouts.save", {
        name: "Sleep Lab",
        watching: "watched",
        query: LAB,
        cadence: "weekly",
        assigned: [],
        lane: "review",
        searchBackTo: null,
        ...input,
      }),
    tryPage: async (address: string) =>
      (
        await ok<TriedPages>("mutate", "scouts.tryWatched", {
          addresses: [address],
        })
      )[0]!.tried,
    tryPages: (addresses: string[]) =>
      ok<TriedPages>("mutate", "scouts.tryWatched", { addresses }),
    list: async () =>
      (await ok<{ scouts: Scout[] }>("query", "scouts.list")).scouts,
    health: () =>
      ok<{ scouts: Array<{ id: string; health: Health }> }>(
        "query",
        "scouts.health"
      ),
    file: (id: string) =>
      readFile(join(vault, ".vitrine/scouts", `${id}.yaml`), "utf8"),
    written: () => {
      const db = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"), {
        readOnly: true,
      });
      try {
        return {
          runs: db.prepare("SELECT count(*) AS n FROM scout_runs").get() as {
            n: number;
          },
          proposals: db
            .prepare("SELECT count(*) AS n FROM proposals")
            .get() as { n: number },
          appearances: db
            .prepare("SELECT count(*) AS n FROM appearances")
            .get() as { n: number },
        };
      } finally {
        db.close();
      }
    },
  };
}

describe("saving a Scout that watches a page", () => {
  it("writes the file a hand edit would write, and runs nothing", async () => {
    const c = await opened();

    const { id } = await c.save({
      query: `  ${LAB} `,
      assigned: ["rq2b7x9mk4"],
    });

    const text = await c.file(id);
    expect(text).toContain("kind: watched");
    expect(text).toContain(`url: ${LAB}`);
    // The Query belongs to arXiv: a page's file carries no filter and no window.
    expect(text).not.toContain("filter");
    expect(text).not.toContain("search_back_to");
    expect((await c.list())[0]).toMatchObject({
      source: { kind: "watched", urls: [LAB] },
      assigned: ["rq2b7x9mk4"],
    });
    expect(c.written().runs.n).toBe(0);
    expect(c.extractions()).toBe(0);
  });

  it("says why it has not looked: not yet, first check due now", async () => {
    const c = await opened();
    const { id } = await c.save({});

    expect((await c.health()).scouts).toEqual([
      {
        id,
        health: {
          voice: "not yet",
          sentence: "Not yet — first check due now.",
        },
        lastCostUsd: null,
      },
    ]);
  });

  it("needs a name and an address that is a web address, never a successful try", async () => {
    const c = await opened({ key: null });
    for (const bad of [
      { name: " " },
      { query: " " },
      { query: "lab.example" },
    ]) {
      const r = await c.c.mutate("scouts.save", {
        name: "x",
        watching: "watched",
        query: LAB,
        cadence: "daily",
        assigned: [],
        lane: "review",
        searchBackTo: null,
        ...bad,
      });
      expect(r.error).toBeDefined();
    }
    // No key and no try: saving still works.
    await c.save({});
    expect(await c.list()).toHaveLength(1);
  });
});

// What the form owns, a Scout Activity row's Assigned Questions included —
// they write through this same `scouts.save` (#520) — is saved as it is for an
// arXiv Scout. Pointing the Scout at another page is scout-form.repoint.test.ts.
describe("editing a Scout that watches a page", () => {
  const raw = (c: Awaited<ReturnType<typeof opened>>, input: object) =>
    c.c.mutate("scouts.save", {
      name: "Sleep Lab",
      watching: "watched",
      query: LAB,
      cadence: "weekly",
      assigned: [],
      lane: "review",
      searchBackTo: null,
      ...input,
    });

  it("saves its Assigned Questions, name, cadence and lane, leaves the address and the history as they were, and runs nothing", async () => {
    const c = await opened();
    const { id } = await c.save({});

    await c.save({
      id,
      name: "Sleep Lab, renamed",
      cadence: "monthly",
      lane: "skim",
      assigned: ["rq2b7x9mk4"],
    });

    expect((await c.list())[0]).toMatchObject({
      id,
      name: "Sleep Lab, renamed",
      cadence: "monthly",
      lane: "skim",
      assigned: ["rq2b7x9mk4"],
      source: { kind: "watched", urls: [LAB] },
    });
    // Saving never runs a page's Scout (ADR 0040 decision 5), and a changed
    // Assigned Question is not a changed page.
    expect(c.written().runs.n).toBe(0);
    expect(c.extractions()).toBe(0);
    expect(await c.file(id)).not.toContain("filter");
  });

  // An arXiv Query written over a page's address would quietly turn one
  // Scout's history into another's.
  it("refuses to be saved as an arXiv Scout, and writes nothing", async () => {
    const c = await opened();
    const { id } = await c.save({});
    const before = await c.file(id);

    const reply = await raw(c, { id, watching: "arxiv", query: "all:sleep" });

    expect(reply.error?.message).toBe(
      "A Scout keeps its kind of source. To watch arXiv instead, make a new Scout."
    );
    expect(await c.file(id)).toBe(before);
  });

  // The rule is one way round as much as the other: a page's address saved
  // over an arXiv Scout would skip its Query write and say nothing of it.
  it("keeps an arXiv Scout from being saved as one that watches a page, and writes nothing", async () => {
    const c = await opened();
    const { id } = await c.save({ watching: "arxiv", query: "all:sleep" });
    const before = await c.file(id);

    const reply = await raw(c, { id, watching: "watched", query: LAB });

    expect(reply.error?.message).toBe(
      "A Scout keeps its kind of source. To watch a page instead, make a new Scout."
    );
    expect(await c.file(id)).toBe(before);
  });
});

describe("trying a page", () => {
  it("shows what a model read: the total, five titles, verified and dropped, and what it cost", async () => {
    const c = await opened({
      model: () => ({ items: [...GOOD, INVENTED], usage }),
    });

    const tried = await c.tryPage(LAB);

    expect(tried).toMatchObject({
      outcome: "found",
      via: "model",
      total: 3,
      verified: 2,
      dropped: 1,
      titles: GOOD.map((i) => i.title),
      tokens: { input: 1200, output: 300 },
      costUsd: expect.any(Number) as number,
    });
    // Writes nothing: no run, no Proposal.
    expect(c.written()).toEqual({
      runs: { n: 0 },
      proposals: { n: 0 },
      appearances: { n: 0 },
    });
  });

  it("reads a feed with no model call, and says so", async () => {
    const c = await opened({
      key: null,
      served: { "/publications": { body: FEED, type: "application/atom+xml" } },
    });

    const tried = await c.tryPage(LAB);

    expect(tried).toMatchObject({ outcome: "found", via: "feed" });
    // A feed costs nothing to read, so there is nothing to project.
    expect(tried).not.toHaveProperty("projection");
    expect(c.extractions()).toBe(0);
    expect(c.written().proposals.n).toBe(0);
  });

  it("reads the feed a page advertises, with no model call", async () => {
    const c = await opened({
      served: {
        "/publications": { body: WITH_FEED },
        "/feed.xml": { body: FEED, type: "application/atom+xml" },
        "/feed.atom": { body: FEED, type: "application/atom+xml" },
      },
    });

    const tried = await c.tryPage(LAB);

    expect(tried).toMatchObject({ outcome: "found", via: "feed" });
    expect(c.extractions()).toBe(0);
  });

  it("says no key, and makes no model call, when a page needs one", async () => {
    const c = await opened({ key: null });

    expect(await c.tryPage(LAB)).toEqual({
      outcome: "no-key",
      sentence: "No model key is stored, so this page has not been read yet.",
    });
    expect(c.extractions()).toBe(0);
  });

  it("says a failure in the Scout's own sentence", async () => {
    const c = await opened({ served: {} });
    expect(await c.tryPage(LAB)).toEqual({
      outcome: "failed",
      sentence:
        "The page answered with an error (HTTP 404) or was too large to read, so nothing was checked.",
    });

    const refused = await opened({
      model: () => new ModelError("credentials", "key rejected"),
    });
    expect(await refused.tryPage(LAB)).toEqual({
      outcome: "failed",
      sentence:
        "The model provider refused the stored key, so nothing was checked.",
    });
  });

  it("refuses an address that is not a web address", async () => {
    const c = await opened();
    const r = await c.c.mutate("scouts.tryWatched", { addresses: ["nope"] });
    expect(r.error).toBeDefined();
  });
});

// #912 (ADR 0056 decisions 10 and 13): one *try* reads every page of the
// list, each as a one-page *try* reads it, and answers per page.
describe("trying several pages", () => {
  const NEWS = "https://lab.example/news";
  const GONE = "https://lab.example/gone";
  const served = {
    "/publications": { body: PAGE },
    "/news": { body: FEED, type: "application/atom+xml" },
  };

  it("answers each page under its own address, a failing page among good ones, and writes nothing", async () => {
    const c = await opened({ served });

    const tried = await c.tryPages([LAB, ` ${GONE} `, NEWS]);

    expect(tried).toEqual([
      {
        address: LAB,
        tried: expect.objectContaining({
          outcome: "found",
          via: "model",
          verified: 2,
        }) as TriedPage,
      },
      {
        address: GONE,
        tried: {
          outcome: "failed",
          sentence:
            "The page answered with an error (HTTP 404) or was too large to read, so nothing was checked.",
        },
      },
      {
        address: NEWS,
        tried: expect.objectContaining({
          outcome: "found",
          via: "feed",
        }) as TriedPage,
      },
    ]);
    expect(c.extractions()).toBe(1);
    expect(c.written()).toEqual({
      runs: { n: 0 },
      proposals: { n: 0 },
      appearances: { n: 0 },
    });
  });

  // A feed needs no key, so a missing key holds back only the page that
  // needs a model.
  it("reads a feed page with no key beside a page that needs one", async () => {
    const c = await opened({ served, key: null });

    const tried = await c.tryPages([LAB, NEWS]);

    expect(tried.map((t) => t.tried.outcome)).toEqual(["no-key", "found"]);
    expect(c.extractions()).toBe(0);
  });

  it("refuses a list with an address that is not a web address, or a page twice, and fetches nothing", async () => {
    const c = await opened({ served });

    const bad = await c.c.mutate("scouts.tryWatched", {
      addresses: [LAB, "nope"],
    });
    const twice = await c.c.mutate("scouts.tryWatched", {
      addresses: [LAB, `${LAB} `],
    });
    const none = await c.c.mutate("scouts.tryWatched", { addresses: [] });

    expect(bad.error?.message).toBe(
      "An address needs to start with http:// or https://."
    );
    expect(twice.error?.message).toBe(
      `${LAB} is listed twice. A Scout reads each page once.`
    );
    expect(none.error).toBeDefined();
    expect(c.asked()).toEqual([]);
  });
});

// #891 (spec #884 story 41; ADR 0055): *try* reads up to three Item pages and
// projects what the first look will spend on the rest from what they cost.
describe("trying a page reads three of its Item pages", () => {
  const N = 24;
  const link = (n: number) => `https://lab.example/papers/p${n}/`;
  const LISTING = `<!doctype html><html><head><title>Publications</title></head><body><main><ul>${Array.from(
    { length: N },
    (_, i) => `<li><a href="${link(i + 1)}">Paper Number ${i + 1}</a></li>`
  ).join("")}</ul></main></body></html>`;
  const LISTED = Array.from({ length: N }, (_, i) =>
    item({ title: `Paper Number ${i + 1}`, url: link(i + 1) })
  );
  // The first page declares everything a card needs, so it costs no call;
  // the rest declare nothing, so each costs one.
  const DECLARED = `<!doctype html><html><head><title>Paper Number 1</title>
    <meta name="citation_title" content="Paper Number 1" />
    <meta name="citation_author" content="Rowe, Ada" />
    <meta name="citation_publication_date" content="2026/09/14" />
    <meta name="citation_abstract" content="Probes read planning off the residual stream." />
    </head><body><main><h1>Paper Number 1</h1></main></body></html>`;
  const plain = (n: number) =>
    `<!doctype html><html><head><title>Paper Number ${n}</title></head><body><main><article><h1>Paper Number ${n}</h1><p>By Ben Ito</p><p>Posted September 20, 2026</p><p>Replay consolidates what was learned in the day.</p></article></main></body></html>`;
  const itemUsage = { input: 400, output: 60, cacheRead: 100 };
  const perCall = costUsd("claude-sonnet-5-5", itemUsage)!;
  const served: Record<string, { body: string }> = {
    "/publications": { body: LISTING },
    "/papers/p1/": { body: DECLARED },
    ...Object.fromEntries(
      Array.from({ length: N - 1 }, (_, i) => [
        `/papers/p${i + 2}/`,
        { body: plain(i + 2) },
      ])
    ),
  };
  const copies: ModelProvider["extractItemPage"] = () =>
    Promise.resolve({
      fields: {
        authors: ["Ben Ito"],
        date: "September 20, 2026",
        venue: null,
        abstract: "Replay consolidates what was learned in the day.",
        paperUrl: null,
      },
      usage: itemUsage,
    });

  it("returns three filled cards and projects their mean cost over every new item", async () => {
    const c = await opened({
      served,
      model: () => ({ items: LISTED, usage }),
      itemPage: copies,
    });

    const tried = await c.tryPage(LAB);

    expect(c.asked().filter((p) => p.startsWith("/papers/"))).toEqual([
      "/papers/p1/",
      "/papers/p2/",
      "/papers/p3/",
    ]);
    expect(tried).toMatchObject({
      outcome: "found",
      via: "model",
      cards: [
        {
          title: "Paper Number 1",
          url: link(1),
          authors: ["Rowe, Ada"],
          published: "2026-09-14",
          abstract: "Probes read planning off the residual stream.",
        },
        {
          title: "Paper Number 2",
          url: link(2),
          authors: ["Ben Ito"],
          published: "2026-09-20",
          abstract: "Replay consolidates what was learned in the day.",
        },
        { title: "Paper Number 3", authors: ["Ben Ito"] },
      ],
      projection: { itemPages: N },
      itemPagesUnfetched: 0,
    });
    // Two of the three pages cost a call and one cost nothing: the mean, not
    // the dearest page, is what the rest are projected at.
    expect(
      (tried as { projection: { costUsd: number } }).projection.costUsd
    ).toBeCloseTo(((2 * perCall) / 3) * N, 10);
    expect(c.written()).toEqual({
      runs: { n: 0 },
      proposals: { n: 0 },
      appearances: { n: 0 },
    });
  });

  it("measures a page the model failed on, and says how many could not be fetched", async () => {
    const missingP3 = { ...served };
    delete missingP3["/papers/p3/"];
    let call = 0;
    const c = await opened({
      // p2 is the only page asked of the model, and the call fails after spending.
      served: missingP3,
      model: () => ({ items: LISTED, usage }),
      itemPage: (req) =>
        call++ === 0
          ? Promise.reject(new ModelError("model", "overloaded", itemUsage))
          : copies(req),
    });

    const tried = (await c.tryPage(LAB)) as Extract<
      TriedPage,
      { via: "model" }
    >;

    // p1 declared everything; p2's card keeps only what it declared; p3 was
    // not there. The three fetched pages are the sample, p2's spend in it.
    expect(tried.cards.map((card) => card.title)).toEqual(["Paper Number 1"]);
    expect(tried.itemPagesUnfetched).toBe(1);
    expect(tried.projection?.itemPages).toBe(N);
    expect(tried.projection?.costUsd).toBeCloseTo((perCall / 2) * N, 10);
  });

  it("projects nothing for a model whose price is not known, even when no page cost a call", async () => {
    const declaredOnly = Object.fromEntries(
      Object.entries(served).map(([path, page]) =>
        path === "/publications" ? [path, page] : [path, { body: DECLARED }]
      )
    );
    const c = await opened({
      served: declaredOnly,
      model: () => ({ items: LISTED, usage }),
      modelId: "an-unpriced-model",
    });

    const tried = await c.tryPage(LAB);

    expect(tried).toMatchObject({ outcome: "found", projection: null });
  });

  it("projects nothing when there is no key, and reads no Item page", async () => {
    const c = await opened({ key: null, served, itemPage: copies });

    expect(await c.tryPage(LAB)).toEqual({
      outcome: "no-key",
      sentence: "No model key is stored, so this page has not been read yet.",
    });
    expect(c.asked()).toEqual(["/publications"]);
  });
});
