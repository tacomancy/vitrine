import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { createMemoryCredentialStore } from "./credentials.js";
import type {
  ExtractedItem,
  ItemPageFields,
  ModelProvider,
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

// The Paper link (#890; spec #884; ADR 0055 decision 10): when an Item page's
// own text names this work's paper, the card shows it beside the link back
// and an accepted stub carries it as `paper:`. It is copied by the Item page's
// Extraction and Verified like any value, and it is never followed, never the
// Source key and never a key the Held lookup reads — a wrong pick is a link
// to ignore, never a real card held out of the Queue.

const NOW = new Date("2026-10-27T12:00:00Z");
const LISTING = "https://www.anthropic.com/research/team/interpretability";
const TRACING = "Tracing the thoughts of a large language model";
const TRACING_URL =
  "https://www.anthropic.com/research/tracing-thoughts-language-model";
const BIOLOGY =
  "https://transformer-circuits.pub/2025/attribution-graphs/biology.html";
const ANNOUNCED = "Overnight replay, announced";
const ANNOUNCED_URL = "https://www.anthropic.com/research/overnight-replay";
// The arXiv fixture's first entry, which the announcement names as its paper.
const ARXIV_PAPER = "https://arxiv.org/abs/2609.01234";

const fixture = (...path: string[]) =>
  readFile(join(fixtures, ...path), "utf8");

const PAGES: Record<string, string> = {
  "/research/team/interpretability": await fixture(
    "watched",
    "item-pages",
    "interpretability-listing.html"
  ),
  "/research/tracing-thoughts-language-model": await fixture(
    "watched",
    "item-pages",
    "tracing-thoughts.html"
  ),
  "/research/overnight-replay": await fixture(
    "watched",
    "item-pages",
    "overnight-replay.html"
  ),
};
const ARXIV = await fixture("arxiv", "normal.xml");

const SCOUTS = {
  "lab.yaml": `name: Interpretability
source:
  kind: watched
  url: ${LISTING}
cadence: weekly
lane: review
created: 2026-10-20T00:00:00Z
`,
  "sleep.yaml": `name: Sleep and memory
cadence: daily
lane: review
created: 2026-09-20T00:00:00Z
filter:
  query: all:sleep
assigned: []
`,
};

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

const LISTED: ExtractedItem[] = [
  item({ title: TRACING, url: TRACING_URL }),
  item({ title: ANNOUNCED, url: ANNOUNCED_URL }),
];

const usage = { input: 1200, output: 300, cacheRead: 0 };

type ItemPageCall = { page: string; needed: string[] };

/** The model's copy of each Item page, keyed by a phrase its text holds. */
async function opened(
  answers: Record<string, Partial<ItemPageFields>> = {
    [TRACING]: { paperUrl: BIOLOGY },
    [ANNOUNCED]: { paperUrl: ARXIV_PAPER },
  }
) {
  const vault = await fixtureCopy("obsidian-vault");
  for (const [file, text] of Object.entries(SCOUTS)) {
    const path = join(vault, ".vitrine/scouts", file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  const requests: URL[] = [];
  const itemPages: ItemPageCall[] = [];
  const models: ModelProvider = {
    countTokens: ({ text }) => Promise.resolve(Math.ceil(text.length / 4)),
    extract: () => Promise.resolve({ items: LISTED, usage }),
    extractItemPage: ({ page, needed }) => {
      itemPages.push({ page, needed: [...needed] });
      const answer = Object.entries(answers).find(([phrase]) =>
        page.includes(phrase)
      )?.[1];
      return Promise.resolve({
        fields: {
          authors: null,
          date: null,
          venue: null,
          abstract: null,
          paperUrl: null,
          ...answer,
        },
        usage: { input: 400, output: 60, cacheRead: 0 },
      });
    },
  };
  const c = await core({
    now: () => NOW,
    arxiv: {
      clock: virtualClock(),
      fetch: () => Promise.resolve(new Response(ARXIV)),
    },
    watched: {
      timeoutMs: 1000,
      models,
      credentials: createMemoryCredentialStore({ anthropic: "sk-test" }),
      fetch: (input) => {
        const url = urlOf(input);
        requests.push(url);
        const body = PAGES[url.pathname];
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
    rows,
    itemPages,
    /** Every page the lab's fetch was asked for, robots.txt aside. */
    pagesAsked: () =>
      requests
        .filter((url) => url.pathname !== "/robots.txt")
        .map((url) => `${url.host}${url.pathname}`),
    run: async (scoutId = "lab") => {
      const r = await c.mutate<RunSummary>("scouts.runNow", { scoutId });
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    cards,
    card: async (title: string) =>
      (await cards()).find((card) => card.title === title)!,
    accept: async (proposalId: number) => {
      const r = await c.mutate<Accepted>("scouts.accept", { proposalId });
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    read: (path: string) => readFile(join(vault, path), "utf8"),
  };
}

describe("an Item page that names its own paper", () => {
  it("gives the card that paper as its Paper link, Verified against a page that also links works it cites", async () => {
    const lab = await opened();

    expect(await lab.run()).toMatchObject({ outcome: "ok", new: 2 });

    const tracing = await lab.card(TRACING);
    expect(tracing.paperUrl).toBe(BIOLOGY);
    // The link back is still the Item page, and the card is still the Item page's.
    expect(tracing.url).toBe(TRACING_URL);
    // The Paper link is asked for alongside what the page left empty.
    const asked = lab.itemPages.find((call) => call.page.includes(TRACING))!;
    expect(asked.needed).toContain("paperUrl");
    expect(asked.page).toContain(BIOLOGY);
    expect(
      lab.rows(
        "SELECT item_values_dropped FROM scout_runs WHERE scout_id = 'lab'"
      )
    ).toEqual([{ item_values_dropped: 0 }]);
  });

  it("drops a Paper link that is not on the page, and the rest of the card stands", async () => {
    const lab = await opened({
      [TRACING]: {
        paperUrl: "https://transformer-circuits.pub/2025/made-up.html",
      },
    });

    await lab.run();

    expect(await lab.card(TRACING)).toMatchObject({
      paperUrl: null,
      published: "2025-03-27",
    });
    expect(
      lab.rows(
        "SELECT item_values_dropped FROM scout_runs WHERE scout_id = 'lab'"
      )
    ).toEqual([{ item_values_dropped: 1 }]);
  });

  it("has no Paper link when the model finds none", async () => {
    const lab = await opened({});

    await lab.run();

    expect((await lab.card(TRACING)).paperUrl).toBeNull();
  });

  it("is never followed: no request is made for the Paper link or anything else the page links to", async () => {
    const lab = await opened();

    await lab.run();

    expect(lab.pagesAsked().sort()).toEqual(
      [
        "www.anthropic.com/research/team/interpretability",
        "www.anthropic.com/research/tracing-thoughts-language-model",
        "www.anthropic.com/research/overnight-replay",
      ].sort()
    );
  });
});

describe("accepting a card with a Paper link", () => {
  it("writes `paper:` after `url:` on the stub, and `url:` is still the Item page", async () => {
    const lab = await opened();
    await lab.run();

    const accepted = await lab.accept((await lab.card(TRACING)).id);
    const stub = await lab.read(accepted.path);

    const lines = stub.split("\n");
    const at = lines.indexOf(`url: ${TRACING_URL}`);
    expect(at).toBeGreaterThan(0);
    expect(lines[at + 1]).toBe(`paper: ${BIOLOGY}`);
    // Plain frontmatter, as Obsidian or any YAML reader takes it.
    const frontmatter = parse(stub.split("---\n")[1]!) as Record<
      string,
      unknown
    >;
    expect(frontmatter).toMatchObject({ url: TRACING_URL, paper: BIOLOGY });
  });

  it("writes no `paper:` when the card has none", async () => {
    const lab = await opened({});
    await lab.run();

    const accepted = await lab.accept((await lab.card(TRACING)).id);

    expect(await lab.read(accepted.path)).not.toMatch(/^paper:/m);
  });
});

describe("a Paper link is never an identity", () => {
  it("holds nothing: the paper itself, found by an arXiv Scout, is proposed though a stub names it as `paper:`", async () => {
    const lab = await opened();
    await lab.run();
    await lab.accept((await lab.card(ANNOUNCED)).id);
    await lab.c.indexed();

    await lab.run("sleep");

    expect(
      lab.rows(
        "SELECT state FROM proposals WHERE source_key = 'arxiv:2609.01234'"
      )
    ).toEqual([{ state: "pending" }]);
    expect((await lab.cards()).map((card) => card.url)).toContain(
      "http://arxiv.org/abs/2609.01234v1"
    );
  });

  it("merges nothing: a pending announcement and its paper's own card stay side by side in the Queue", async () => {
    const lab = await opened();
    await lab.run();

    await lab.run("sleep");

    const cards = await lab.cards();
    expect(cards.find((card) => card.title === ANNOUNCED)).toMatchObject({
      paperUrl: ARXIV_PAPER,
      url: ANNOUNCED_URL,
    });
    expect(
      cards.filter((card) => card.url === "http://arxiv.org/abs/2609.01234v1")
    ).toHaveLength(1);
    expect(
      lab
        .rows<{ source_key: string }>(
          "SELECT source_key FROM proposals ORDER BY source_key"
        )
        .map((r) => r.source_key)
    ).toContain("arxiv:2609.01234");
  });
});
