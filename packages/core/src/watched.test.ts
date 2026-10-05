import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CredentialFault,
  createMemoryCredentialStore,
  type CredentialStore,
} from "./credentials.js";
import {
  ModelError,
  type ExtractedItem,
  type Extraction,
  type ModelProvider,
} from "./model-provider.js";
import type { Accepted, Card, RunSummary } from "./scouts.js";
import {
  closeCores,
  core,
  fixtureCopy,
  fixtures,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// Beat 7's tracer (#464): a Scout that watches a page with no feed, written
// by hand as a file, is run with *Run now*; the page is fetched, reduced and
// read by a model, every card is checked against the page, and what is left
// is a Proposal accepted into a Source stub. The fetch, the model and the key
// are stand-ins injected at the core's edge; the page and the model's answers
// are recorded.

const NOW = new Date("2026-09-30T12:34:00Z");
const QUESTION = "rq2b7x9mk4";
const LAB = "https://lab.example/publications";

const fixture = (name: string) =>
  readFile(join(fixtures, "watched", name), "utf8");

const PAGE = await fixture("lab-page.html");

const SCOUT = `name: Sleep Lab
source:
  kind: watched
  url: ${LAB}
cadence: weekly
lane: review
created: 2026-09-20T00:00:00Z
assigned:
  - ${QUESTION}
`;

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

const ARXIV_LINK = "https://arxiv.org/abs/2609.01234v2?utm_source=lab";
const GOOD: ExtractedItem[] = [
  item({
    title: "Overnight Replay Consolidates Declarative Memory",
    authors: ["Ada Rowe", "Ben Ito"],
    date: "2026-09-12",
    abstract: "We record hippocampal replay across a night of sleep.",
    url: ARXIV_LINK,
  }),
  item({
    title: "Sleep Spindles Predict Next-Day Learning",
    authors: ["Cara Voss"],
    date: "2026-08-30",
    venue: "Journal of Sleep Research",
    url: "https://lab.example/papers/spindles/",
  }),
  item({
    title: "A Nap Is Not a Night",
    authors: ["Dev Patel"],
    date: "2026-07-01",
    url: "https://doi.org/10.1234/Nap.5",
  }),
];
const INVENTED = item({
  title: "Sleep Cures Everything",
  authors: ["Nobody"],
  url: "https://lab.example/papers/cures",
});

const usage = { input: 1200, output: 300, cacheRead: 0 };

type Page = { body: string; status?: number; type?: string };

async function opened(
  options: {
    scouts?: Record<string, string>;
    page?: () => Page;
    /** Served by path in place of `page`, for a page and its feed. */
    routes?: Record<string, Page>;
    robots?: string | null;
    model?: (page: string) => Extraction | Error | Promise<Extraction | Error>;
    key?: string | null;
    store?: CredentialStore;
    modelId?: string;
    timeoutMs?: number;
    fetch?: typeof fetch;
    arxiv?: string;
  } = {}
) {
  const vault = await fixtureCopy("obsidian-vault");
  for (const [file, text] of Object.entries(
    options.scouts ?? { "lab.yaml": SCOUT }
  )) {
    const path = join(vault, ".vitrine/scouts", file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  const requests: Array<{ url: URL; headers: Headers }> = [];
  const calls = { count: 0, extract: 0, pages: [] as string[] };
  let page: () => Page = options.page ?? (() => ({ body: "" }));
  const models: ModelProvider = {
    countTokens: ({ text }) => {
      calls.count++;
      return Promise.resolve(Math.ceil(text.length / 4));
    },
    extract: async ({ page: shown }) => {
      calls.extract++;
      calls.pages.push(shown);
      const answer = await (options.model ?? (() => ({ items: GOOD, usage })))(
        shown
      );
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  const c = await core({
    now: () => NOW,
    arxiv: {
      clock: virtualClock(),
      fetch: () => Promise.resolve(new Response(options.arxiv ?? "")),
    },
    watched: {
      timeoutMs: options.timeoutMs ?? 1000,
      models,
      credentials:
        options.store ??
        createMemoryCredentialStore(
          options.key === null ? {} : { anthropic: options.key ?? "sk-test" }
        ),
      ...(options.modelId === undefined ? {} : { model: options.modelId }),
      fetch:
        options.fetch ??
        ((input, init) => {
          const url = urlOf(input);
          requests.push({
            url,
            headers: new Headers(init?.headers),
          });
          if (url.pathname === "/robots.txt") {
            return Promise.resolve(
              options.robots === undefined || options.robots === null
                ? new Response("", { status: 404 })
                : new Response(options.robots)
            );
          }
          const served = options.routes?.[url.pathname] ?? page();
          return Promise.resolve(
            new Response(served.body, {
              status: served.status ?? 200,
              headers: { "content-type": served.type ?? "text/html" },
            })
          );
        }),
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
  return {
    vault,
    c,
    requests,
    calls,
    rows,
    serve: (next: () => Page) => {
      page = next;
    },
    run: async (scoutId = "lab") => {
      const r = await c.mutate<RunSummary>("scouts.runNow", { scoutId });
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    cards: async () => {
      const r = await c.query<Card[]>("scouts.queue");
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    accept: async (proposalId: number) => {
      const r = await c.mutate<Accepted>("scouts.accept", { proposalId });
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    lastRun: () =>
      rows<Record<string, unknown>>(
        "SELECT * FROM scout_runs ORDER BY id DESC LIMIT 1"
      )[0]!,
    read: (path: string) => readFile(join(vault, path), "utf8"),
  };
}

describe("a Scout that watches a page", () => {
  it("is read as found, run now, and its verified card is accepted into a Source stub", async () => {
    const lab = await opened({ page: () => ({ body: PAGE }) });

    expect((await lab.c.query("scouts.list")).result!.data).toMatchObject({
      scouts: [
        {
          id: "lab",
          name: "Sleep Lab",
          source: { kind: "watched", url: LAB },
          query: LAB,
        },
      ],
    });

    const run = await lab.run();
    expect(run).toMatchObject({ outcome: "ok", fetched: 3, new: 3 });

    const cards = await lab.cards();
    expect(cards.map((card) => card.title).sort()).toEqual([
      "A Nap Is Not a Night",
      "Overnight Replay Consolidates Declarative Memory",
      "Sleep Spindles Predict Next-Day Learning",
    ]);
    const card = cards.find((c) => c.title.startsWith("Overnight"))!;
    expect(card).toMatchObject({
      authors: ["Ada Rowe", "Ben Ito"],
      lane: "review",
      retroactive: true,
      scouts: [{ id: "lab", name: "Sleep Lab" }],
    });

    const accepted = await lab.accept(card.id);
    expect(accepted.held).toBe(false);
    const stub = await lab.read(accepted.path);
    expect(stub).toContain("kind: source-stub");
    expect(stub).toContain(
      "title: Overnight Replay Consolidates Declarative Memory"
    );
    expect(stub).toContain("origin_scout: lab");
  });
});

describe("verification", () => {
  it("drops a card whose title or link is not on the page, and counts it on the run", async () => {
    const lab = await opened({
      page: () => ({ body: PAGE }),
      model: () => ({
        items: [
          ...GOOD,
          INVENTED,
          // A real title with a link the page never had.
          item({
            title: "A Nap Is Not a Night",
            url: "https://lab.example/papers/nap-elsewhere",
          }),
        ],
        usage,
      }),
    });

    const run = await lab.run();

    expect(run).toMatchObject({ outcome: "ok", new: 3, unverified: 2 });
    expect((await lab.cards()).map((c) => c.title)).not.toContain(
      "Sleep Cures Everything"
    );
    expect(lab.lastRun()).toMatchObject({ unverified: 2 });
  });

  it("fails the run as an extraction when fewer than half the cards verify", async () => {
    const lab = await opened({
      page: () => ({ body: PAGE }),
      model: () => ({
        items: [GOOD[0]!, INVENTED, { ...INVENTED, title: "Another" }],
        usage,
      }),
    });

    const run = await lab.run();

    expect(run).toMatchObject({
      outcome: "failed",
      errorKind: "extraction",
      unverified: 2,
    });
    expect(await lab.cards()).toEqual([]);
  });

  it("says the listing was missed when nothing comes back but last time's papers are still there", async () => {
    let answer: Extraction = { items: GOOD, usage };
    const lab = await opened({
      page: () => ({ body: PAGE }),
      model: () => answer,
    });
    await lab.run();
    // The same papers, a page that changed only enough to be read again.
    lab.serve(() => ({
      body: PAGE.replace("<h2>Publications", "<h2>Our Publications"),
    }));
    answer = { items: [], usage };

    await lab.run();

    expect(lab.lastRun()).toMatchObject({
      outcome: "failed",
      error_kind: "extraction",
      error_message: "listing missed",
    });
  });

  it("says the structure changed when nothing comes back and the papers are gone", async () => {
    let answer: Extraction = { items: GOOD, usage };
    const lab = await opened({
      page: () => ({ body: PAGE }),
      model: () => answer,
    });
    await lab.run();
    lab.serve(() => ({ body: redesigned }));
    answer = { items: [], usage };

    await lab.run();

    expect(lab.lastRun()).toMatchObject({
      outcome: "failed",
      error_kind: "extraction",
      error_message: "structure change",
    });
  });
});

const redesigned = await fixture("lab-page-redesigned.html");

describe("what a run records", () => {
  it("records the model, tokens and cost at the day's prices", async () => {
    const lab = await opened({
      page: () => ({ body: PAGE }),
      modelId: "claude-sonnet-5",
    });

    await lab.run();

    expect(lab.lastRun()).toMatchObject({
      model: "claude-sonnet-5",
      input_tokens: 1200,
      output_tokens: 300,
      cache_read_tokens: 0,
      // 1200 × $2 + 300 × $10, per million.
      cost_usd: 0.0054,
      page_length: expect.any(Number) as number,
    });
    expect(lab.lastRun()["page_hash"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("records tokens and no dollar figure for a model the app has no price for", async () => {
    const lab = await opened({
      page: () => ({ body: PAGE }),
      modelId: "some-new-model",
    });

    await lab.run();

    expect(lab.lastRun()).toMatchObject({
      model: "some-new-model",
      input_tokens: 1200,
      cost_usd: null,
    });
  });

  it("makes no model call for a page that has not changed, and one for a page that has", async () => {
    const lab = await opened({ page: () => ({ body: PAGE }) });
    await lab.run();
    expect(lab.calls.extract).toBe(1);

    // Only the page's chrome moved: the reduced text is the same.
    lab.serve(() => ({ body: retimed }));
    const quiet = await lab.run();
    expect(quiet).toMatchObject({ outcome: "ok", new: 0 });
    expect(lab.calls.extract).toBe(1);

    lab.serve(() => ({
      body: PAGE.replace("<h2>Publications", "<h2>Our Publications"),
    }));
    await lab.run();
    expect(lab.calls.extract).toBe(2);
  });

  it("cuts a page over the token budget and says it did", async () => {
    const long = `${PAGE}<p>${"word ".repeat(250_000)}</p>`;
    const lab = await opened({ page: () => ({ body: long }) });

    await lab.run();

    expect(lab.lastRun()).toMatchObject({ page_capped: 1 });
    expect(lab.calls.pages[0]!.length).toBeLessThan(long.length);
  });
});

const retimed = await fixture("lab-page-retimed.html");

describe("the fetch", () => {
  it("identifies as Vitrine and reads robots.txt first", async () => {
    const lab = await opened({ page: () => ({ body: PAGE }) });

    await lab.run();

    expect(lab.requests.map((r) => r.url.pathname)).toEqual([
      "/robots.txt",
      "/publications",
    ]);
    for (const request of lab.requests) {
      expect(request.headers.get("user-agent")).toMatch(
        /^Vitrine\/\S+ \(\+https:\/\/tacomancy\.com\/vitrine\)$/
      );
    }
  });

  it("is an http failure, with its reason, when robots.txt disallows the page — and the model is never asked", async () => {
    const lab = await opened({
      page: () => ({ body: PAGE }),
      robots: await fixture("robots-disallow.txt"),
    });

    const run = await lab.run();

    expect(run).toMatchObject({ outcome: "failed", errorKind: "http" });
    expect(lab.lastRun()).toMatchObject({
      error_message: "disallowed by robots.txt",
    });
    expect(lab.requests.map((r) => r.url.pathname)).toEqual(["/robots.txt"]);
    expect(lab.calls.extract).toBe(0);
  });

  it("gives up on a page that does not answer in time, and does not retry", async () => {
    let asked = 0;
    const lab = await opened({
      timeoutMs: 30,
      fetch: (_input, init) => {
        asked++;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted"))
          );
        });
      },
    });

    const run = await lab.run();

    expect(run).toMatchObject({ outcome: "failed", errorKind: "network" });
    // Only robots.txt was asked for, once: a timeout is one attempt.
    expect(asked).toBe(1);
  });

  it("refuses a response over 2 MB", async () => {
    const lab = await opened({
      page: () => ({ body: "x".repeat(2 * 1024 * 1024 + 1) }),
    });

    const run = await lab.run();

    expect(run).toMatchObject({ outcome: "failed", errorKind: "http" });
    expect(lab.lastRun()).toMatchObject({
      error_message: "the page is over 2 MB",
    });
    expect(lab.calls.extract).toBe(0);
  });

  it("is an http failure for a page that answers with an error", async () => {
    const lab = await opened({ page: () => ({ body: "", status: 503 }) });

    expect(await lab.run()).toMatchObject({
      outcome: "failed",
      errorKind: "http",
    });
    expect(lab.lastRun()).toMatchObject({ error_message: "HTTP 503" });
  });
});

describe("a model that cannot answer", () => {
  it("records no key as a run that did nothing: no model call", async () => {
    const lab = await opened({ key: null });

    const run = await lab.run();

    expect(run).toMatchObject({ outcome: "failed", errorKind: "credentials" });
    expect(lab.lastRun()).toMatchObject({ error_message: "no key" });
    expect(lab.calls.count + lab.calls.extract).toBe(0);
  });

  it("records a Keychain that could not be read as a fault, never as no key", async () => {
    const lab = await opened({
      page: () => ({ body: PAGE }),
      store: {
        get: () => Promise.reject(new CredentialFault()),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
    });

    expect(await lab.run()).toMatchObject({ errorKind: "credentials" });
    expect(lab.lastRun().error_message).not.toBe("no key");
    expect(lab.calls.count + lab.calls.extract).toBe(0);
    const health = (
      await lab.c.query<Array<{ voice: string; sentence: string }>>(
        "scouts.health"
      )
    ).result!.data;
    expect(JSON.stringify(health)).toMatch(/Keychain/);
    expect(JSON.stringify(health)).toMatch(/"wrong"/);
  });

  it("records a key the provider refused, and a provider that failed, as stated failures", async () => {
    const refused = await opened({
      page: () => ({ body: PAGE }),
      model: () => new ModelError("credentials", "key rejected"),
    });
    expect(await refused.run()).toMatchObject({ errorKind: "credentials" });
    expect(refused.lastRun()).toMatchObject({ error_message: "key rejected" });

    const down = await opened({
      page: () => ({ body: PAGE }),
      model: () => new ModelError("model", "the provider answered HTTP 529"),
    });
    expect(await down.run()).toMatchObject({ errorKind: "model" });
    expect(await down.cards()).toEqual([]);
  });
});

describe("source_key", () => {
  it("is the arXiv id, else the DOI, else the normalised link", async () => {
    const { sourceKeyOf } = await import("./source-key.js");
    // The arXiv id wins over everything else on the link, version and query included.
    expect(sourceKeyOf("https://arxiv.org/abs/2609.01234v3?utm_source=x")).toBe(
      "arxiv:2609.01234"
    );
    expect(sourceKeyOf("http://export.arxiv.org/pdf/2609.01234v1.pdf")).toBe(
      "arxiv:2609.01234"
    );
    // Then a DOI, case-insensitive.
    expect(sourceKeyOf("https://doi.org/10.1234/Nap.5")).toBe(
      "doi:10.1234/nap.5"
    );
    // Else the link: scheme and host lower-cased, fragment dropped, slash and tracking keys removed.
    expect(
      sourceKeyOf(
        "HTTPS://Lab.Example/papers/spindles/?utm_campaign=a&id=4#top"
      )
    ).toBe("url:https://lab.example/papers/spindles?id=4");
    expect(sourceKeyOf("https://lab.example/papers/spindles")).toBe(
      "url:https://lab.example/papers/spindles"
    );
  });

  it("makes one card with two Appearances of a paper an arXiv Scout and a lab page both found", async () => {
    const arxivXml = await readFile(
      join(fixtures, "arxiv", "normal.xml"),
      "utf8"
    );
    const lab = await opened({
      page: () => ({ body: PAGE }),
      arxiv: arxivXml,
      scouts: {
        "lab.yaml": SCOUT,
        "sleep.yaml": `name: Sleep and memory
cadence: daily
lane: skim
created: 2026-09-20T00:00:00Z
filter:
  query: all:sleep
assigned: []
`,
      },
    });

    await lab.run("sleep");
    await lab.run("lab");

    const proposals = lab.rows<{ id: number; source_key: string }>(
      "SELECT id, source_key FROM proposals WHERE source_key = 'arxiv:2609.01234'"
    );
    expect(proposals).toHaveLength(1);
    expect(
      lab
        .rows<{ scout_id: string }>(
          `SELECT scout_id FROM appearances WHERE proposal_id = ${proposals[0]!.id} ORDER BY rowid`
        )
        .map((a) => a.scout_id)
    ).toEqual(["sleep", "lab"]);
  });
});

describe("the first run", () => {
  it("proposes everything as Retroactive, rejects as one batch, and proposes only the unseen after", async () => {
    let answer: Extraction = { items: GOOD, usage };
    const lab = await opened({
      page: () => ({ body: PAGE }),
      model: () => answer,
    });

    const first = await lab.run();
    expect(first).toMatchObject({ new: 3 });
    expect((await lab.cards()).every((c) => c.retroactive)).toBe(true);

    const rejected = await lab.c.mutate("scouts.rejectRun", {
      runId: first.runId,
    });
    expect(rejected.error).toBeUndefined();
    expect(await lab.cards()).toEqual([]);

    // A later run sees one more paper on a changed page, and proposes only it.
    const added = item({
      title: "Brand New Result",
      url: "https://lab.example/papers/new",
    });
    lab.serve(() => ({
      body: PAGE.replace(
        "</ul>",
        `<li><a href="/papers/new">Brand New Result</a></li></ul>`
      ),
    }));
    answer = { items: [...GOOD, added], usage };
    const later = await lab.run();

    expect(later).toMatchObject({ new: 1 });
    const cards = await lab.cards();
    expect(cards.map((c) => c.title)).toEqual(["Brand New Result"]);
    expect(cards[0]!.retroactive).toBe(false);
  });

  it("stops at the ceiling of 500 and says how many more there were", async () => {
    const many = Array.from({ length: 520 }, (_, n) =>
      item({
        title: `Paper number ${n}`,
        url: `https://lab.example/papers/${n}`,
      })
    );
    const body = `<ul>${many
      .map((m) => `<li><a href="${m.url}">${m.title}</a></li>`)
      .join("")}</ul>`;
    const lab = await opened({
      page: () => ({ body }),
      model: () => ({ items: many, usage }),
    });

    const run = await lab.run();

    expect(run).toMatchObject({ outcome: "ok", new: 500, truncated: 20 });
    expect(lab.lastRun()).toMatchObject({ truncated: 20 });
  });
});

const RSS = await fixture("lab-feed.rss.xml");
const ATOM = await fixture("lab-feed.atom.xml");
const FED_PAGE = await fixture("lab-page-with-feed.html");
const FEED_SENTENCE =
  "This page advertises a feed that could not be read, so nothing was checked.";

describe("a page that advertises a feed", () => {
  const withFeed = (feed: Page, over: Parameters<typeof opened>[0] = {}) =>
    opened({
      key: null,
      routes: { "/publications": { body: FED_PAGE }, "/feed.xml": feed },
      ...over,
    });

  it("is read from an RSS feed alone: cards, no model call, no key", async () => {
    const lab = await withFeed({ body: RSS, type: "application/rss+xml" });

    const run = await lab.run();

    expect(run).toMatchObject({ outcome: "ok", fetched: 2, new: 2 });
    expect(lab.calls.count + lab.calls.extract).toBe(0);
    const cards = await lab.cards();
    expect(cards.find((c) => c.title.startsWith("Overnight"))).toMatchObject({
      authors: ["Ada Rowe", "Ben Ito"],
      published: "2026-09-12",
      abstract: "We record hippocampal replay across a night of sleep.",
      url: "https://arxiv.org/abs/2609.01234v2",
    });
    expect(cards.map((c) => c.title)).toContain(
      "Sleep Spindles & Next-Day Learning"
    );
    // The feed is a second request to the same host with robots.txt read first.
    expect(lab.requests.map((r) => r.url.pathname)).toEqual([
      "/robots.txt",
      "/publications",
      "/robots.txt",
      "/feed.xml",
    ]);
    expect(lab.requests.every((r) => r.url.host === "lab.example")).toBe(true);
  });

  it("is read from an Atom feed alone", async () => {
    const lab = await withFeed({ body: ATOM, type: "application/atom+xml" });

    expect(await lab.run()).toMatchObject({ outcome: "ok", fetched: 2 });

    expect(lab.calls.count + lab.calls.extract).toBe(0);
    expect(
      (await lab.cards()).find((c) => c.title.startsWith("A Nap"))
    ).toMatchObject({
      url: "https://lab.example/papers/nap",
      abstract: "Naps & nights differ.",
    });
  });

  it("leaves the Scout's file byte-identical", async () => {
    const lab = await withFeed({ body: RSS });
    const before = await lab.read(".vitrine/scouts/lab.yaml");

    await lab.run();

    expect(await lab.read(".vitrine/scouts/lab.yaml")).toBe(before);
  });

  it("is a stated http failure when the feed cannot be fetched, and the model is not the fallback", async () => {
    const lab = await withFeed({ body: "", status: 500 }, { key: "sk-test" });

    const run = await lab.run();

    expect(run).toMatchObject({ outcome: "failed", errorKind: "http" });
    expect(lab.lastRun()).toMatchObject({ error_message: "feed unreadable" });
    expect(lab.calls.count + lab.calls.extract).toBe(0);
    const health = (
      await lab.c.query<{ scouts: Array<{ health: { sentence: string } }> }>(
        "scouts.health"
      )
    ).result!.data;
    expect(health.scouts[0]!.health.sentence).toBe(FEED_SENTENCE);
  });

  it("is a stated parse failure when the feed is not a feed", async () => {
    const lab = await withFeed(
      { body: "<html>nope</html>" },
      { key: "sk-test" }
    );

    expect(await lab.run()).toMatchObject({
      outcome: "failed",
      errorKind: "parse",
    });
    expect(lab.lastRun()).toMatchObject({ error_message: "feed unreadable" });
    expect(lab.calls.count + lab.calls.extract).toBe(0);
  });

  it("does not follow a feed on another host", async () => {
    const lab = await opened({
      key: "sk-test",
      page: () => ({
        body: FED_PAGE.replace(
          "/feed.xml",
          "https://elsewhere.example/feed.xml"
        ),
      }),
    });

    expect(await lab.run()).toMatchObject({
      outcome: "failed",
      errorKind: "http",
    });
    expect(lab.requests.every((r) => r.url.host === "lab.example")).toBe(true);
    expect(lab.calls.extract).toBe(0);
  });

  it("stops at the ceiling and says how many more", async () => {
    const entries = Array.from(
      { length: 503 },
      (_, i) =>
        `<item><title>Paper ${i}</title><link>https://lab.example/p/${i}</link></item>`
    ).join("");
    const lab = await withFeed({
      body: `<rss version="2.0"><channel>${entries}</channel></rss>`,
    });

    const run = await lab.run();

    expect(run).toMatchObject({ outcome: "ok", fetched: 503, truncated: 3 });
    expect(await lab.cards()).toHaveLength(500);
  });
});

describe("an address that is itself a feed", () => {
  it("is parsed directly with no second request and no key", async () => {
    const lab = await opened({
      key: null,
      page: () => ({ body: ATOM, type: "application/atom+xml" }),
    });

    expect(await lab.run()).toMatchObject({ outcome: "ok", fetched: 2 });

    expect(lab.requests.map((r) => r.url.pathname)).toEqual([
      "/robots.txt",
      "/publications",
    ]);
    expect(lab.calls.count + lab.calls.extract).toBe(0);
  });
});

// #468 (ADR 0040 d.1, d.2): a missing key is a row, and a stored one starts
// what was waiting on it.
describe("a Scout waiting on a key", () => {
  type Health = {
    scouts: Array<{
      id: string;
      health: {
        voice: string;
        sentence?: string;
        warrant?: { fragments: string[] } | null;
      };
    }>;
  };
  const healthOf = async (lab: Awaited<ReturnType<typeof opened>>) =>
    (await lab.c.query<Health>("scouts.health")).result!.data.scouts[0]!.health;
  const runCount = (lab: Awaited<ReturnType<typeof opened>>) =>
    lab.rows<{ n: number }>("SELECT COUNT(*) AS n FROM scout_runs")[0]!.n;

  it("says why it has not looked, in the not-yet voice, and is not asked again by the hour", async () => {
    const lab = await opened({ key: null, page: () => ({ body: PAGE }) });
    await lab.run();

    expect(await healthOf(lab)).toMatchObject({
      voice: "not yet",
      sentence: "No model key is stored, so this page has not been read yet.",
    });
    await lab.c.mutate("scouts.checkDue", {});
    expect(runCount(lab)).toBe(1);
    expect(lab.calls.count + lab.calls.extract).toBe(0);
    // *Run now* still asks.
    await lab.run();
    expect(runCount(lab)).toBe(2);
  });

  it("says a rejected key in the wrong voice, with its own sentence", async () => {
    const lab = await opened({
      page: () => ({ body: PAGE }),
      model: () => new ModelError("credentials", "key rejected"),
    });
    await lab.run();

    const health = await healthOf(lab);
    expect(health.voice).toBe("wrong");
    expect(health.sentence).toBe(
      "The model provider refused the stored key, so nothing was checked."
    );
    await lab.c.mutate("scouts.checkDue", {});
    expect(runCount(lab)).toBe(1);
  });

  it("runs at once when a key is stored, and the cards arrive", async () => {
    const lab = await opened({ key: null, page: () => ({ body: PAGE }) });
    await lab.run();

    const set = await lab.c.mutate("credentials.set", {
      provider: "anthropic",
      key: "sk-new",
    });
    expect(set.error).toBeUndefined();

    expect(runCount(lab)).toBe(2);
    expect(lab.lastRun()).toMatchObject({ outcome: "ok" });
    expect((await lab.cards()).length).toBe(GOOD.length);
  });

  it("runs when a test succeeds, and not when it fails", async () => {
    const store = createMemoryCredentialStore();
    const lab = await opened({ store, page: () => ({ body: PAGE }) });
    await lab.run();
    expect(runCount(lab)).toBe(1);

    // No key: the test says so and starts nothing.
    await lab.c.mutate("credentials.test", { provider: "anthropic" });
    expect(runCount(lab)).toBe(1);

    // A key written behind the procedures' back, as a hand edit of the
    // Keychain would: only a successful test notices it.
    await store.set("anthropic", "sk-test");
    await lab.c.mutate("credentials.test", { provider: "anthropic" });
    expect(runCount(lab)).toBe(2);
    expect(lab.lastRun()).toMatchObject({ outcome: "ok" });
  });

  it("leaves a paused Scout alone", async () => {
    const lab = await opened({
      key: null,
      scouts: {
        "lab.yaml": SCOUT,
        "other.yaml":
          SCOUT.replace("Sleep Lab", "Other Lab") + "paused: true\n",
      },
      page: () => ({ body: PAGE }),
    });
    await lab.run("lab");
    await lab.run("other");
    lab.serve(() => ({ body: "", status: 503 }));

    await lab.c.mutate("credentials.set", {
      provider: "anthropic",
      key: "sk-new",
    });

    const ran = lab.rows<{ scout_id: string }>(
      "SELECT scout_id FROM scout_runs ORDER BY id"
    );
    expect(ran.map((r) => r.scout_id)).toEqual(["lab", "other", "lab"]);
  });

  it("is named, with why, by credentials.waiting — a rejected key too", async () => {
    const lab = await opened({
      key: null,
      model: () => new ModelError("credentials", "key rejected"),
      scouts: {
        "lab.yaml": SCOUT,
        "fine.yaml": SCOUT.replace("Sleep Lab", "Fine Lab"),
      },
      page: () => ({ body: PAGE }),
    });
    await lab.run("lab");

    const waiting = async () =>
      (
        await lab.c.query<Array<{ id: string; name: string; message: string }>>(
          "credentials.waiting",
          { provider: "anthropic" }
        )
      ).result!.data;
    expect(await waiting()).toEqual([
      { id: "lab", name: "Sleep Lab", message: "no key" },
    ]);

    // A key the provider refuses leaves it waiting, with the other reason.
    lab.serve(() => ({ body: PAGE }));
    await lab.c.mutate("credentials.set", {
      provider: "anthropic",
      key: "sk-bad",
    });
    expect(await waiting()).toEqual([
      { id: "lab", name: "Sleep Lab", message: "key rejected" },
    ]);
  });

  it("keeps its no-key rows out of the Warrant: no last ran, no clean count", async () => {
    const lab = await opened({ key: null, page: () => ({ body: PAGE }) });
    await lab.run();
    await lab.run();
    expect(await healthOf(lab)).not.toHaveProperty("warrant");

    // The key arrives; the first clean run is the first run of the field.
    await lab.c.mutate("credentials.set", {
      provider: "anthropic",
      key: "sk-new",
    });
    await lab.c.mutate("scouts.runNow", { scoutId: "lab" });
    const health = await healthOf(lab);
    // Only runs that fetched count: one clean run is under the baseline, so
    // the rate is not quoted and the two no-key rows are not in the tally.
    const warrant = health.warrant?.fragments ?? [];
    expect(warrant.join(" ")).not.toMatch(/\(\d+ runs\)/);
  });
});
