import { mkdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryCredentialStore } from "./credentials.js";
import type { LooseEnds } from "./loose-ends.js";
import type { ExtractedItem, ModelProvider } from "./model-provider.js";
import type { ScoutActivity, ScoutRow } from "./scout-activity.js";
import type { FleetHealth } from "./scout-health.js";
import type { Card, RunSummary } from "./scouts.js";
import {
  closeCores,
  core,
  fixtureCopy,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// Item pages that fail (#888; spec #884; ADR 0055 decision 6). A page that
// cannot be read leaves its card Listing-only and is tried again on later
// runs, three times in all, and the run counts what it could not read. When
// fewer than half of a run's Item pages can be read, the run says *item
// pages unread* as an `extraction` failure, and its cards are proposed all
// the same: a site that starts refusing these reads looks broken, never
// quiet, and costs the researcher detail, never finds.

const SITE = "https://www.lab.example";
const LISTING = `${SITE}/research`;

const SCOUT = `name: Lab
source:
  kind: watched
  url: ${LISTING}
cadence: weekly
lane: review
created: 2026-10-20T00:00:00Z
`;

const UNREAD_SENTENCE =
  "Fewer than half of this page's items could be read on their own pages, so its cards show only what the listing gave.";

const item = (n: number): ExtractedItem => ({
  title: `Post number ${n}`,
  authors: null,
  date: null,
  venue: null,
  keywords: null,
  abstract: null,
  url: `${SITE}/research/post-${n}`,
});

const itemPage = (n: number) =>
  `<html><head>
<meta name="citation_author" content="Author of ${n}">
<meta name="citation_abstract" content="The summary of post ${n}.">
</head><body><h1>Post number ${n}</h1></body></html>`;

const listingOf = (ns: number[]) =>
  `<html><body><main>${ns
    .map(
      (n) =>
        `<article><a href="${SITE}/research/post-${n}">Post number ${n}</a></article>`
    )
    .join("")}</main></body></html>`;

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

const usage = { input: 1200, output: 300, cacheRead: 0 };

async function opened() {
  const vault = await fixtureCopy("obsidian-vault");
  const path = join(vault, ".vitrine/scouts", "lab.yaml");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, SCOUT);
  let listed: number[] = [];
  let robots: string | null = null;
  let now = new Date("2026-10-27T12:00:00Z");
  const requests: string[] = [];
  /** Paths that answer 404. */
  const missing = new Set<string>();
  const calls = { extract: 0 };
  const models: ModelProvider = {
    countTokens: ({ text }) => Promise.resolve(Math.ceil(text.length / 4)),
    extract: () => {
      calls.extract++;
      return Promise.resolve({ items: listed.map((n) => item(n)), usage });
    },
  };
  const c = await core({
    now: () => now,
    arxiv: {
      clock: virtualClock(),
      fetch: () => Promise.resolve(new Response("")),
    },
    watched: {
      timeoutMs: 1000,
      models,
      credentials: createMemoryCredentialStore({ anthropic: "sk-test" }),
      fetch: (input) => {
        const url = urlOf(input);
        if (url.pathname === "/robots.txt") {
          return Promise.resolve(
            robots === null
              ? new Response("", { status: 404 })
              : new Response(robots, {
                  headers: { "content-type": "text/plain" },
                })
          );
        }
        requests.push(url.pathname);
        const post = /^\/research\/post-(\d+)$/.exec(url.pathname);
        const body = missing.has(url.pathname)
          ? undefined
          : url.pathname === "/research"
            ? listingOf(listed)
            : post !== null
              ? itemPage(Number(post[1]))
              : undefined;
        return Promise.resolve(
          body === undefined
            ? new Response("", { status: 404 })
            : new Response(body, { headers: { "content-type": "text/html" } })
        );
      },
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const rows = <T>(sql: string): T[] => {
    const handle = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"), {
      readOnly: true,
    });
    try {
      return handle.prepare(sql).all() as T[];
    } finally {
      handle.close();
    }
  };
  const cards = async () => {
    const r = await c.query<Card[]>("scouts.queue", { sort: "newest" });
    expect(r.error).toBeUndefined();
    return r.result!.data;
  };
  return {
    c,
    calls,
    missing,
    rows,
    cards,
    list: (ns: number[]) => (listed = ns),
    /** What `/robots.txt` answers; null is a 404, which allows everything. */
    robots: (rules: string | null) => (robots = rules),
    later: () => {
      now = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    },
    /** The Item pages asked for since the last call, as post numbers. */
    postsAsked: () =>
      requests
        .splice(0)
        .flatMap((p) => /post-(\d+)$/.exec(p)?.[1] ?? [])
        .map(Number),
    run: async () => {
      const r = await c.mutate<RunSummary>("scouts.runNow", { scoutId: "lab" });
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    card: async (n: number) =>
      (await cards()).find((card) => card.title === `Post number ${n}`),
    tries: (n: number) =>
      rows<{ item_page_tries: number | null }>(
        `SELECT item_page_tries FROM proposals WHERE title = 'Post number ${n}'`
      )[0]!.item_page_tries,
    /** The newest run's row, as the dashboards read it. */
    lastRun: () =>
      rows<{
        outcome: string;
        error_kind: string | null;
        error_message: string | null;
        new: number;
        item_pages_read: number;
        item_pages_unread: number;
      }>(
        "SELECT outcome, error_kind, error_message, new, item_pages_read, item_pages_unread FROM scout_runs ORDER BY id DESC LIMIT 1"
      )[0]!,
    health: async () => {
      const r = await c.query<FleetHealth>("scouts.health");
      expect(r.error).toBeUndefined();
      return r.result!.data.scouts.find((s) => s.id === "lab")!.health;
    },
    activity: async () => {
      const r = await c.query<ScoutActivity>("scouts.activity");
      expect(r.error).toBeUndefined();
      return r.result!.data.rows.find(
        (row): row is ScoutRow => row.kind === "scout" && row.id === "lab"
      )!;
    },
    looseEnds: async () => {
      const r = await c.query<LooseEnds>("looseEnds.rows");
      expect(r.error).toBeUndefined();
      return r
        .result!.data.groups.flatMap((g) => g.rows)
        .filter((row) => row.subject === "lab");
    },
  };
}

describe("an Item page that fails", () => {
  it("leaves one card of ten Listing-only on a clean run, counted, and is tried again on the next", async () => {
    const lab = await opened();
    lab.list(range(1, 10));
    lab.missing.add("/research/post-4");

    expect(await lab.run()).toMatchObject({ outcome: "ok", new: 10 });
    expect(lab.lastRun()).toMatchObject({
      outcome: "ok",
      item_pages_read: 9,
      item_pages_unread: 1,
    });
    expect(await lab.card(4)).toMatchObject({ authors: [], abstract: "" });
    expect(lab.tries(4)).toBe(1);

    lab.postsAsked();
    lab.missing.clear();
    lab.later();
    await lab.run();

    expect(lab.postsAsked()).toEqual([4]);
    expect(await lab.card(4)).toMatchObject({
      authors: ["Author of 4"],
      abstract: "The summary of post 4.",
    });
    expect(lab.tries(4)).toBeNull();
  });

  it("is tried three times in all, and never a fourth", async () => {
    const lab = await opened();
    lab.list(range(1, 4));
    lab.missing.add("/research/post-2");

    await lab.run();
    expect(lab.tries(2)).toBe(1);
    for (const tries of [2, 3]) {
      lab.postsAsked();
      lab.later();
      await lab.run();
      expect(lab.postsAsked()).toEqual([2]);
      expect(lab.tries(2)).toBe(tries);
    }

    lab.later();
    await lab.run();
    lab.missing.clear();
    lab.later();
    await lab.run();

    expect(lab.postsAsked()).toEqual([]);
    expect(lab.tries(2)).toBe(3);
    expect(await lab.card(2)).toMatchObject({ authors: [], abstract: "" });
  });

  it("is counted unread on a run that read only Listing-only cards", async () => {
    const lab = await opened();
    lab.list(range(1, 4));
    lab.missing.add("/research/post-2");
    await lab.run();

    lab.later();
    await lab.run();

    expect(lab.lastRun()).toMatchObject({
      item_pages_read: 0,
      item_pages_unread: 1,
    });
  });
});

describe("a run that could read fewer than half its Item pages", () => {
  it("is an extraction failure, item pages unread, with its cards in the Queue", async () => {
    const lab = await opened();
    lab.list(range(1, 4));
    lab.robots("User-agent: *\nDisallow: /research/post-");

    const summary = await lab.run();

    expect(summary).toMatchObject({
      outcome: "failed",
      errorKind: "extraction",
      new: 4,
    });
    expect(lab.lastRun()).toMatchObject({
      outcome: "failed",
      error_kind: "extraction",
      error_message: "item pages unread",
      new: 4,
      item_pages_read: 0,
      item_pages_unread: 4,
    });
    expect((await lab.cards()).map((c) => c.title).sort()).toEqual(
      range(1, 4).map((n) => `Post number ${n}`)
    );
    expect(lab.tries(1)).toBe(1);
  });

  it("is said on Home and Scout Activity: broken, with its finds counted", async () => {
    const lab = await opened();
    lab.list(range(1, 2));
    await lab.run();
    const before = await lab.activity();

    lab.list(range(1, 5));
    lab.robots("User-agent: *\nDisallow: /research/post-");
    lab.later();
    await lab.run();

    const broken = {
      voice: "wrong",
      kind: "extraction",
      sentence: UNREAD_SENTENCE,
    };
    // Home's broken Scouts read this.
    expect(await lab.health()).toEqual(broken);
    const after = await lab.activity();
    expect(after.health).toEqual(broken);
    // Last new item moved: the three new cards are this Scout's finds, and
    // the run that found them is its newest look.
    expect(after.volume.proposals).toBe(before.volume.proposals + 3);
    expect(after.lastRun!.finished).not.toBe(before.lastRun!.finished);
    // Last successful extraction did not: the newest clean run is still the
    // first one.
    expect(
      lab.rows<{ n: number }>(
        "SELECT COUNT(*) AS n FROM scout_runs WHERE outcome = 'ok'"
      )
    ).toEqual([{ n: 1 }]);
  });

  it("is a failure with one page of three read", async () => {
    const lab = await opened();
    lab.list(range(1, 3));
    lab.missing.add("/research/post-1");
    lab.missing.add("/research/post-2");

    expect(await lab.run()).toMatchObject({
      outcome: "failed",
      errorKind: "extraction",
    });
    expect(await lab.card(3)).toMatchObject({ authors: ["Author of 3"] });
  });

  it("is not the clean run a deferral waits for", async () => {
    const lab = await opened();
    lab.list(range(1, 2));
    await lab.run();
    const id = lab.rows<{ id: number }>(
      "SELECT id FROM proposals WHERE title = 'Post number 1'"
    )[0]!.id;
    expect(
      (await lab.c.mutate("scouts.defer", { proposalId: id })).error
    ).toBeUndefined();

    lab.list(range(1, 4));
    lab.robots("User-agent: *\nDisallow: /research/post-");
    lab.later();
    await lab.run();
    const state = () =>
      lab.rows<{ state: string }>(
        `SELECT state FROM proposals WHERE id = ${id}`
      )[0]!.state;
    expect(state()).toBe("deferred");

    lab.robots(null);
    lab.later();
    await lab.run();
    expect(state()).toBe("pending");
  });

  it("at exactly half read is a clean run", async () => {
    const lab = await opened();
    lab.list(range(1, 4));
    lab.missing.add("/research/post-1");
    lab.missing.add("/research/post-2");

    expect(await lab.run()).toMatchObject({ outcome: "ok" });
    expect(lab.lastRun()).toMatchObject({
      item_pages_read: 2,
      item_pages_unread: 2,
    });
  });

  it("is the generic failed-Scout row in Loose Ends, never a structure change, after a clean run that found items", async () => {
    const lab = await opened();
    lab.list(range(1, 2));
    await lab.run();

    lab.list(range(1, 4));
    lab.robots("User-agent: *\nDisallow: /research/post-");
    lab.later();
    await lab.run();

    expect(await lab.looseEnds()).toEqual([
      {
        kind: "failed-scout",
        subject: "lab",
        path: ".vitrine/scouts/lab.yaml",
        title: "Lab",
        errorKind: "extraction",
        sentence: UNREAD_SENTENCE,
      },
    ]);
  });

  it("vouches for its listing: the same page next time is not read by the model again", async () => {
    const lab = await opened();
    lab.list(range(1, 2));
    lab.robots("User-agent: *\nDisallow: /research/post-");
    await lab.run();
    expect(lab.calls.extract).toBe(1);

    lab.robots(null);
    lab.later();
    await lab.run();

    expect(lab.calls.extract).toBe(1);
    expect(await lab.card(1)).toMatchObject({ authors: ["Author of 1"] });
  });

  it("does not make the next run's finds Retroactive: its listing was looked at", async () => {
    const lab = await opened();
    lab.list(range(1, 2));
    lab.robots("User-agent: *\nDisallow: /research/post-");
    await lab.run();

    lab.robots(null);
    lab.list(range(1, 3));
    lab.later();
    await lab.run();

    expect(
      lab.rows<{ retroactive: number }>(
        "SELECT retroactive FROM scout_runs ORDER BY id"
      )
    ).toEqual([{ retroactive: 1 }, { retroactive: 0 }]);
  });
});
