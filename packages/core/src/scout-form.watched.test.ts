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
import type { TriedPage } from "./scout-form.js";
import {
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
  } = {}
) {
  const vault = await fixtureCopy("obsidian-vault");
  const served = options.served ?? { "/publications": { body: PAGE } };
  let extractions = 0;
  const models: ModelProvider = {
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
      model: "claude-sonnet-5-5",
      fetch: (input) => {
        const url = urlOf(input);
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
    tryPage: (address: string) =>
      ok<TriedPage>("mutate", "scouts.tryWatched", { address }),
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
      source: { kind: "watched", url: LAB },
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

// A saved page's address is the one thing a save does not change yet: ADR 0042
// decision 5 keeps it on the form and leaves how it is changed to a decision of
// its own, since a different page invalidates the hash and the
// structure-change test its history rests on. Everything else the form owns —
// and so a Scout Activity row's Assigned Questions, which write through this
// same `scouts.save` (#520) — is saved as it is for an arXiv Scout.
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
      source: { kind: "watched", url: LAB },
    });
    // Saving never runs a page's Scout (ADR 0040 decision 5), and a changed
    // Assigned Question is not a changed page.
    expect(c.written().runs.n).toBe(0);
    expect(c.extractions()).toBe(0);
    expect(await c.file(id)).not.toContain("filter");
  });

  it("refuses a different address, in words that say where it is changed, and writes nothing", async () => {
    const c = await opened();
    const { id } = await c.save({});
    const before = await c.file(id);

    const reply = await raw(c, { id, query: "https://other.example/papers" });

    expect(reply.error?.message).toBe(
      "What a Scout watches is changed in its file for now."
    );
    expect(reply.error?.data).toMatchObject({
      code: "BAD_REQUEST",
      kind: "refused",
    });
    expect(await c.file(id)).toBe(before);
  });

  // An arXiv Query written over a page's address would quietly turn one
  // Scout's history into another's.
  it("refuses to be saved as an arXiv Scout, and writes nothing", async () => {
    const c = await opened();
    const { id } = await c.save({});
    const before = await c.file(id);

    const reply = await raw(c, { id, watching: "arxiv", query: "all:sleep" });

    expect(reply.error?.message).toBe(
      "What a Scout watches is changed in its file for now."
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
      "What a Scout watches is changed in its file for now."
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
    expect(c.written()).toEqual({ runs: { n: 0 }, proposals: { n: 0 } });
  });

  it("reads a feed with no model call, and says so", async () => {
    const c = await opened({
      key: null,
      served: { "/publications": { body: FEED, type: "application/atom+xml" } },
    });

    const tried = await c.tryPage(LAB);

    expect(tried).toMatchObject({ outcome: "found", via: "feed" });
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
    const r = await c.c.mutate("scouts.tryWatched", { address: "nope" });
    expect(r.error).toBeDefined();
  });
});
