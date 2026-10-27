import { mkdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryCredentialStore } from "./credentials.js";
import {
  ModelError,
  type ExtractedItem,
  type ModelProvider,
} from "./model-provider.js";
import { openQueue } from "./queue.js";
import type { Card, RunSummary } from "./scouts.js";
import {
  closeCores,
  copiesNothing,
  core,
  fixtureCopy,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// Listing-only cards fill in on later runs (#887; spec #884; ADR 0055
// decision 5). Items past a run's 25 Item pages are proposed at once from
// what the listing showed, and their pages are read on later runs: this
// run's new items first, then the Scout's pending Listing-only cards oldest
// first. A read fills only the fields a pending card lacks, and a card the
// researcher has triaged is never written.

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

const item = (n: number, over: Partial<ExtractedItem> = {}): ExtractedItem => ({
  title: `Post number ${n}`,
  authors: null,
  date: null,
  venue: null,
  keywords: null,
  abstract: null,
  url: `${SITE}/research/post-${n}`,
  ...over,
});

/** Each post's own page: a declared date, summary and author. */
const itemPage = (n: number) =>
  `<html><head>
<meta property="article:published_time" content="2025-09-${String((n % 28) + 1).padStart(2, "0")}T00:00:00Z">
<meta name="citation_author" content="Author of ${n}">
<meta name="citation_abstract" content="The summary of post ${n}.">
<meta name="citation_doi" content="10.5555/post.${n}">
</head><body><h1>Post number ${n}</h1></body></html>`;

/** A post whose page declares only its date; its author is in a byline the model must copy (#886). */
const bylinePage = (n: number) =>
  `<html><head>
<meta property="article:published_time" content="2025-09-01T00:00:00Z">
</head><body><main><h1>Post number ${n}</h1><p>By Ada Rowe</p><p>What post ${n} found.</p><p><a href="${SITE}/papers/post-${n}.pdf">Read the paper</a></p></main></body></html>`;

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

async function opened(
  options: {
    /** Writes into the vault's queue before the core opens it. */
    seed?: (vault: string) => Promise<void>;
  } = {}
) {
  const vault = await fixtureCopy("obsidian-vault");
  const path = join(vault, ".vitrine/scouts", "lab.yaml");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, SCOUT);
  await options.seed?.(vault);
  let listed: number[] = [];
  let listedItems: ExtractedItem[] | null = null;
  let now = new Date("2026-10-27T12:00:00Z");
  const requests: string[] = [];
  const calls = { extract: 0 };
  /** Paths whose fetch waits on a promise, to triage a card mid-read. */
  const held = new Map<string, Promise<void>>();
  /** Paths that answer 404. */
  const missing = new Set<string>();
  /** Posts whose page declares only a date. */
  const bylined = new Set<number>();
  const models: ModelProvider = {
    countTokens: ({ text }) => Promise.resolve(Math.ceil(text.length / 4)),
    extract: () => {
      calls.extract++;
      return Promise.resolve({
        items: listedItems ?? listed.map((n) => item(n)),
        usage,
      });
    },
    extractItemPage: copiesNothing,
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
      fetch: async (input) => {
        const url = urlOf(input);
        if (url.pathname !== "/robots.txt") requests.push(url.pathname);
        await held.get(url.pathname);
        const post = /^\/research\/post-(\d+)$/.exec(url.pathname);
        const body = missing.has(url.pathname)
          ? undefined
          : url.pathname === "/research"
            ? listingOf(listed)
            : post !== null
              ? (bylined.has(Number(post[1])) ? bylinePage : itemPage)(
                  Number(post[1])
                )
              : undefined;
        return body === undefined
          ? new Response("", { status: 404 })
          : new Response(body, { headers: { "content-type": "text/html" } });
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
    missing,
    bylined,
    models,
    /** Writes to the queue as another source would have. */
    write: (sql: string) => {
      const handle = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"));
      try {
        handle.exec(sql);
      } finally {
        handle.close();
      }
    },
    /** Points the Scout at another page, as an edit to its file would. */
    repoint: (url: string) => writeFile(path, SCOUT.replace(LISTING, url)),
    calls,
    held,
    rows,
    cards,
    list: (ns: number[], items?: ExtractedItem[]) => {
      listed = ns;
      listedItems = items ?? null;
    },
    later: () => {
      now = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    },
    /** The Item pages asked for since the last call, in order, as post numbers. */
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
    idOf: (n: number) =>
      rows<{ id: number }>(
        `SELECT id FROM proposals WHERE title = 'Post number ${n}'`
      )[0]!.id,
    /** The titles of the cards still owed an Item page read. */
    listingOnly: () =>
      rows<{ title: string; item_page_tries: number | null }>(
        "SELECT title, item_page_tries FROM proposals WHERE item_page_tries IS NOT NULL ORDER BY id"
      ).map((r) => r.title),
  };
}

describe("a Listing-only card", () => {
  it("is proposed at once past the 25, and the next run fills it, though the listing has not changed", async () => {
    const lab = await opened();
    lab.list(range(1, 30));

    expect(await lab.run()).toMatchObject({ outcome: "ok", new: 30 });
    expect(lab.postsAsked()).toEqual(range(1, 25));
    expect(lab.listingOnly()).toEqual(
      range(26, 30).map((n) => `Post number ${n}`)
    );
    expect(await lab.card(26)).toMatchObject({
      published: "",
      abstract: "",
      authors: [],
    });
    expect(await lab.card(25)).toMatchObject({
      abstract: "The summary of post 25.",
    });

    lab.later();
    expect(await lab.run()).toMatchObject({ outcome: "ok", new: 0 });

    // The same page hashes as the last clean look, so the listing costs no
    // call, and the five pages it owed are read all the same.
    expect(lab.calls.extract).toBe(1);
    expect(lab.postsAsked()).toEqual(range(26, 30));
    expect(lab.listingOnly()).toEqual([]);
    for (const n of range(26, 30)) {
      expect(await lab.card(n)).toEqual(
        expect.objectContaining({
          published: `2025-09-${String((n % 28) + 1).padStart(2, "0")}`,
          abstract: `The summary of post ${n}.`,
          authors: [`Author of ${n}`],
        })
      );
    }
    expect(
      lab.rows("SELECT item_pages_read FROM scout_runs ORDER BY id")
    ).toEqual([{ item_pages_read: 25 }, { item_pages_read: 5 }]);
  });

  it("is read after this run's new items, oldest first, within the 25", async () => {
    const lab = await opened();
    lab.list(range(1, 27));
    await lab.run();
    lab.postsAsked();
    // 26 and 27 are owed from the first run.

    lab.later();
    lab.list(range(1, 53));
    await lab.run();
    // 26 new items: the first 25 take the run, so 53 is owed too, and the
    // older two wait behind them.
    expect(lab.postsAsked()).toEqual(range(28, 52));
    expect(lab.listingOnly()).toEqual([
      "Post number 26",
      "Post number 27",
      "Post number 53",
    ]);

    lab.later();
    lab.list(range(1, 54));
    await lab.run();
    // This run's new item first, then the owed cards as they were first seen.
    expect(lab.postsAsked()).toEqual([54, 26, 27, 53]);
    expect(lab.listingOnly()).toEqual([]);
  });

  it("is read no more than the 25 allow, and the rest wait for the run after", async () => {
    const lab = await opened();
    lab.list(range(1, 60));
    await lab.run();
    lab.postsAsked();

    lab.later();
    await lab.run();

    expect(lab.postsAsked()).toEqual(range(26, 50));
    expect(lab.listingOnly()).toEqual(
      range(51, 60).map((n) => `Post number ${n}`)
    );
  });

  it("is read by its own Scout's runs, never another's", async () => {
    const lab = await opened({
      seed: async (vault) => {
        const queue = await openQueue(vault);
        queue.exec(
          `INSERT INTO scout_runs (id, scout_id, started, finished, outcome, window_from, window_to, fetched, new, query)
           VALUES (1, 'blog', '2026-10-21T10:00:00Z', '2026-10-21T10:01:00Z', 'ok', '2026-10-21T10:00:00Z', '2026-10-21T10:00:00Z', 1, 1, '${SITE}/blog')`
        );
        queue.exec(
          `INSERT INTO proposals (id, source_key, title, authors, published, abstract, url, lane, state, first_seen, item_page_tries)
           VALUES (1, 'url:${SITE}/research/post-90', 'Post number 90', '[]', '', '', '${SITE}/research/post-90', 'review', 'pending', '2026-10-21T10:01:00Z', 0)`
        );
        queue.exec(
          `INSERT INTO appearances (proposal_id, run_id, scout_id, seen_at, url)
           VALUES (1, 1, 'blog', '2026-10-21T10:01:00Z', '${SITE}/research/post-90')`
        );
        queue.close();
      },
    });
    lab.list([1]);

    await lab.run();

    expect(lab.postsAsked()).toEqual([1]);
    expect(lab.listingOnly()).toEqual(["Post number 90"]);
  });

  it("gains only the fields it lacks: what the listing gave is never replaced", async () => {
    const lab = await opened();
    lab.list(
      range(1, 26),
      range(1, 26).map((n) =>
        n === 26
          ? item(26, { date: "Jun 20, 2025", authors: ["Jane Listed"] })
          : item(n)
      )
    );
    await lab.run();
    expect(lab.listingOnly()).toEqual(["Post number 26"]);

    lab.later();
    await lab.run();

    expect(await lab.card(26)).toMatchObject({
      published: "Jun 20, 2025",
      authors: ["Jane Listed"],
      abstract: "The summary of post 26.",
      doi: "10.5555/post.26",
    });
  });

  it("keeps an abstract and a DOI it already has", async () => {
    const lab = await opened();
    lab.list(range(1, 26));
    await lab.run();
    // As a feed entry or a later sighting would have given them.
    lab.write(
      "UPDATE proposals SET abstract = 'Given elsewhere.', doi = '10.1/given' WHERE title = 'Post number 26'"
    );

    lab.later();
    await lab.run();

    expect(await lab.card(26)).toMatchObject({
      abstract: "Given elsewhere.",
      doi: "10.1/given",
      authors: ["Author of 26"],
    });
    expect(lab.listingOnly()).toEqual([]);
  });

  it("stays owed, with the try counted, when its page cannot be fetched", async () => {
    const lab = await opened();
    lab.list(range(1, 26));
    await lab.run();
    lab.missing.add("/research/post-26");

    lab.later();
    await lab.run();

    expect(
      lab.rows(
        "SELECT abstract, item_page_tries FROM proposals WHERE title = 'Post number 26'"
      )
    ).toEqual([{ abstract: "", item_page_tries: 1 }]);
  });

  it("is not read, nor changed, once it has been accepted, rejected or deferred", async () => {
    const lab = await opened();
    lab.list(range(1, 28));
    await lab.run();
    lab.postsAsked();
    expect(
      (await lab.c.mutate("scouts.accept", { proposalId: lab.idOf(26) })).error
    ).toBeUndefined();
    expect(
      (await lab.c.mutate("scouts.reject", { proposalId: lab.idOf(27) })).error
    ).toBeUndefined();
    expect(
      (await lab.c.mutate("scouts.defer", { proposalId: lab.idOf(28) })).error
    ).toBeUndefined();
    const before = lab.rows(
      "SELECT id, authors, published, abstract, doi FROM proposals WHERE title IN ('Post number 26', 'Post number 27', 'Post number 28') ORDER BY id"
    );

    lab.later();
    await lab.run();

    expect(lab.postsAsked()).toEqual([]);
    expect(
      lab.rows(
        "SELECT id, authors, published, abstract, doi FROM proposals WHERE title IN ('Post number 26', 'Post number 27', 'Post number 28') ORDER BY id"
      )
    ).toEqual(before);
  });

  it("is not written when it is triaged while its page is being read", async () => {
    const lab = await opened();
    lab.list(range(1, 26));
    await lab.run();
    lab.postsAsked();
    let release!: () => void;
    lab.held.set(
      "/research/post-26",
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );

    lab.later();
    const running = lab.run();
    // The page is asked for, and the card is accepted before it answers.
    await expect.poll(() => lab.postsAsked()).toEqual([26]);
    expect(
      (await lab.c.mutate("scouts.accept", { proposalId: lab.idOf(26) })).error
    ).toBeUndefined();
    release();
    await running;

    expect(
      lab.rows(
        "SELECT state, authors, published, abstract FROM proposals WHERE title = 'Post number 26'"
      )
    ).toEqual([
      { state: "accepted", authors: "[]", published: "", abstract: "" },
    ]);
  });

  it("is not read once its Scout is pointed at another site", async () => {
    const lab = await opened();
    lab.list(range(1, 27));
    await lab.run();
    lab.postsAsked();

    await lab.repoint("https://other.example/research");
    lab.list([1]);
    lab.later();
    expect(await lab.run()).toMatchObject({ outcome: "ok" });

    expect(lab.postsAsked()).toEqual([]);
    expect(lab.listingOnly()).toEqual(["Post number 26", "Post number 27"]);
  });

  it("is a pending card from before Item pages, on the Scout's site, and fills in on the next run; an arXiv card is untouched", async () => {
    const lab = await opened({
      seed: async (vault) => {
        const queue = await openQueue(vault);
        queue.exec("ALTER TABLE scout_runs DROP COLUMN item_values_dropped");
        queue.exec("ALTER TABLE proposals DROP COLUMN paper_url");
        queue.exec(
          `INSERT INTO scout_runs (id, scout_id, started, finished, outcome, window_from, window_to, fetched, new, query)
           VALUES (1, 'lab', '2026-10-21T10:00:00Z', '2026-10-21T10:01:00Z', 'ok', '2026-10-21T10:00:00Z', '2026-10-21T10:00:00Z', 1, 1, '${LISTING}'),
                  (2, 'sleep', '2026-10-21T10:00:00Z', '2026-10-21T10:01:00Z', 'ok', '2026-10-21T10:00:00Z', '2026-10-21T10:00:00Z', 1, 1, 'cat:q-bio.NC')`
        );
        queue.exec(
          `INSERT INTO proposals (id, source_key, title, authors, published, abstract, url, lane, state, first_seen)
           VALUES (1, 'url:${SITE}/research/post-7', 'Post number 7', '[]', '', '', '${SITE}/research/post-7', 'review', 'pending', '2026-10-21T10:01:00Z'),
                  (2, 'arxiv:2610.00001', 'An arXiv paper', '[]', '2026-10-20', 'Abstract.', 'http://arxiv.org/abs/2610.00001', 'review', 'pending', '2026-10-21T10:01:00Z')`
        );
        queue.exec(
          `INSERT INTO appearances (proposal_id, run_id, scout_id, seen_at, url)
           VALUES (1, 1, 'lab', '2026-10-21T10:01:00Z', '${SITE}/research/post-7'),
                  (2, 2, 'sleep', '2026-10-21T10:01:00Z', 'http://arxiv.org/abs/2610.00001')`
        );
        // A queue file written before this build's backfill.
        queue.exec("ALTER TABLE scout_runs DROP COLUMN item_pages_unread");
        queue.exec("PRAGMA user_version = 14");
        queue.close();
      },
    });
    expect(lab.listingOnly()).toEqual(["Post number 7"]);

    lab.list([7]);
    await lab.run();

    expect(lab.postsAsked()).toEqual([7]);
    expect(await lab.card(7)).toMatchObject({
      abstract: "The summary of post 7.",
      authors: ["Author of 7"],
    });
    expect(
      lab.rows(
        "SELECT abstract, item_page_tries FROM proposals WHERE source_key = 'arxiv:2610.00001'"
      )
    ).toEqual([{ abstract: "Abstract.", item_page_tries: null }]);
  });

  it("has what its page did not declare copied by the model, asked for the fields its row lacks, and Verified", async () => {
    const lab = await opened();
    lab.list(range(1, 26));
    lab.bylined.add(26);
    await lab.run();
    expect(lab.listingOnly()).toEqual(["Post number 26"]);
    const asked: string[][] = [];
    lab.models.extractItemPage = ({ needed }) => {
      asked.push([...needed]);
      return Promise.resolve({
        fields: {
          authors: ["Ada Rowe", "Made Up"],
          date: null,
          venue: null,
          abstract: `What post 26 found.`,
          paperUrl: `${SITE}/papers/post-26.pdf`,
        },
        usage: { input: 400, output: 60, cacheRead: 0 },
      });
    };

    lab.later();
    await lab.run();

    // The page declared its date; the row had no authors, venue or summary.
    expect(asked).toEqual([["authors", "venue", "abstract", "paperUrl"]]);
    expect(await lab.card(26)).toMatchObject({
      published: "2025-09-01",
      authors: ["Ada Rowe"],
      abstract: "What post 26 found.",
      // A pending card gains its Paper link as it gains any field (#890).
      paperUrl: `${SITE}/papers/post-26.pdf`,
    });
    expect(lab.listingOnly()).toEqual([]);
    expect(
      lab.rows(
        "SELECT item_values_dropped, input_tokens FROM scout_runs ORDER BY id"
      )
    ).toEqual([
      { item_values_dropped: 0, input_tokens: usage.input },
      // An unchanged listing: the one call was the Item page's.
      { item_values_dropped: 1, input_tokens: 400 },
    ]);
  });

  it("keeps what its page declared, and stays owed with the try counted, when the model cannot read it", async () => {
    const lab = await opened();
    lab.list(range(1, 26));
    lab.bylined.add(26);
    await lab.run();
    lab.models.extractItemPage = () =>
      Promise.reject(new ModelError("model", "the provider answered HTTP 529"));

    lab.later();
    expect(await lab.run()).toMatchObject({ outcome: "ok" });

    expect(await lab.card(26)).toMatchObject({
      published: "2025-09-01",
      authors: [],
    });
    expect(
      lab.rows(
        "SELECT item_page_tries FROM proposals WHERE title = 'Post number 26'"
      )
    ).toEqual([{ item_page_tries: 1 }]);
  });

  it("is asked only for what its row still lacks, so a venue another source gave is neither asked for nor replaced", async () => {
    const lab = await opened();
    lab.list(range(1, 26));
    lab.bylined.add(26);
    await lab.run();
    lab.write(
      `UPDATE proposals SET venue = 'Workshop on Probes' WHERE title = 'Post number 26'`
    );
    const asked: string[][] = [];
    lab.models.extractItemPage = ({ needed }) => {
      asked.push([...needed]);
      return Promise.resolve({
        fields: {
          authors: ["Ada Rowe"],
          date: null,
          // On the page, but not asked for.
          venue: "Post number 26",
          abstract: null,
          paperUrl: null,
        },
        usage: { input: 400, output: 60, cacheRead: 0 },
      });
    };

    lab.later();
    await lab.run();

    expect(asked).toEqual([["authors", "abstract", "paperUrl"]]);
    expect(await lab.card(26)).toMatchObject({
      venue: "Workshop on Probes",
      authors: ["Ada Rowe"],
    });
  });
});
