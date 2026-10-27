import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryCredentialStore } from "./credentials.js";
import { costUsd } from "./model-prices.js";
import {
  ModelError,
  type ExtractedItem,
  type ItemPageFields,
  type ModelProvider,
} from "./model-provider.js";
import type { Card, RunSummary } from "./scouts.js";
import {
  closeCores,
  core,
  fixtureCopy,
  fixtures,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// Item pages, the tracer (#885; spec #884; ADR 0055 decisions 2, 3 and 9):
// after a Watched Scout reads its listing, it reads the page of each new item
// on the listing's own host and fills the card's empty fields from what that
// page declares for machines, with no model call. The listing, its Item pages
// and the model's reading of the listing are recorded stand-ins, shaped like
// the anthropic.com team pages that prompted the ADR.

const NOW = new Date("2026-10-27T12:00:00Z");
const LISTING = "https://www.anthropic.com/research/team/alignment";
const BLURB =
  "Anthropic is an AI safety and research company that's working to build reliable, interpretable, and steerable AI systems.";

const fixture = (name: string) =>
  readFile(join(fixtures, "watched", "item-pages", name), "utf8");

const PAGES: Record<string, string> = {
  "/research/team/alignment": await fixture("listing.html"),
  "/research/agentic-misalignment": await fixture("agentic-misalignment.html"),
  "/constitution": await fixture("constitution.html"),
  "/research/sparse-probes": await fixture("sparse-probes.html"),
  "/research/reward-hacking": await fixture("reward-hacking.html"),
  "/research/plain-post": await fixture("plain-post.html"),
  "/research/already-dated": await fixture("already-dated.html"),
  "/research/byline": await fixture("byline.html"),
};

const SCOUT = `name: Alignment
source:
  kind: watched
  url: ${LISTING}
cadence: weekly
lane: review
created: 2026-10-20T00:00:00Z
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

/** What a model copies off the listing: titles and links, and the one date and byline the listing shows. */
const LISTED: ExtractedItem[] = [
  item({
    title: "Agentic Misalignment: How LLMs could be insider threats",
    url: "https://www.anthropic.com/research/agentic-misalignment",
  }),
  item({
    title: "Claude's new constitution",
    url: "https://www.anthropic.com/constitution",
  }),
  item({
    title: "Sparse Probes Find Planning Features",
    url: "https://www.anthropic.com/research/sparse-probes",
  }),
  item({
    title: "Natural Emergent Misalignment from Reward Hacking",
    url: "https://www.anthropic.com/research/reward-hacking",
  }),
  item({
    title: "A Plain Post With No Markup",
    url: "https://www.anthropic.com/research/plain-post",
  }),
  item({
    title: "A Card the Listing Already Dated",
    authors: ["Jane Listed"],
    date: "Jun 20, 2025",
    url: "https://www.anthropic.com/research/already-dated",
  }),
  item({
    title: "A Post on the Alignment Science Blog",
    url: "https://alignment.anthropic.com/2025/off-host/",
  }),
];

const usage = { input: 1200, output: 300, cacheRead: 0 };
const itemUsage = { input: 400, output: 60, cacheRead: 100 };

/** What the model is asked of one Item page: the reduced text and the fields still empty. */
type ItemPageCall = { page: string; needed: string[] };

async function opened(
  options: {
    pages?: Record<string, string>;
    listed?: () => ExtractedItem[];
    /** The model's copy of an Item page; nothing found by default. */
    itemPage?: (call: ItemPageCall) => Partial<ItemPageFields>;
  } = {}
) {
  const vault = await fixtureCopy("obsidian-vault");
  const path = join(vault, ".vitrine/scouts", "alignment.yaml");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, SCOUT);
  const pages = { ...(options.pages ?? PAGES) };
  const requests: URL[] = [];
  const calls = { extract: 0, itemPages: [] as ItemPageCall[] };
  const models: ModelProvider = {
    countTokens: ({ text }) => Promise.resolve(Math.ceil(text.length / 4)),
    extract: () => {
      calls.extract++;
      return Promise.resolve({
        items: (options.listed ?? (() => LISTED))(),
        usage,
      });
    },
    extractItemPage: ({ page, needed }) => {
      const call = { page, needed: [...needed] };
      calls.itemPages.push(call);
      return Promise.resolve({
        fields: {
          authors: null,
          date: null,
          venue: null,
          abstract: null,
          ...options.itemPage?.(call),
        },
        usage: itemUsage,
      });
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
      credentials: createMemoryCredentialStore({ anthropic: "sk-test" }),
      fetch: (input) => {
        const url = urlOf(input);
        requests.push(url);
        const body = pages[url.pathname];
        return Promise.resolve(
          body === undefined || url.pathname === "/robots.txt"
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
  return {
    c,
    pages,
    requests,
    calls,
    models,
    rows,
    /** Every page asked for, robots.txt aside, as a host and path. */
    pagesAsked: () =>
      requests
        .filter((url) => url.pathname !== "/robots.txt")
        .map((url) => `${url.host}${url.pathname}`),
    run: async () => {
      const r = await c.mutate<RunSummary>("scouts.runNow", {
        scoutId: "alignment",
      });
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    cards: async () => {
      const r = await c.query<Card[]>("scouts.queue", { sort: "newest" });
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
  };
}

const byTitle = (cards: Card[], title: string) =>
  cards.find((card) => card.title === title)!;

describe("a new item's Item page", () => {
  it("dates an anthropic.com card and gives it the summary the page publishes, never the site's blurb and never the lab as author", async () => {
    const lab = await opened();

    expect(await lab.run()).toMatchObject({ outcome: "ok", new: 7 });
    const cards = await lab.cards();

    expect(
      byTitle(cards, "Agentic Misalignment: How LLMs could be insider threats")
    ).toMatchObject({
      published: "2025-06-20",
      abstract:
        "We stress-tested 16 leading models in hypothetical corporate environments to identify risky agentic behaviors before they cause real harm.",
      // An `Organization` author, and the script payload's undocumented
      // `authors`, are both passed over.
      authors: [],
    });
    const constitution = byTitle(cards, "Claude's new constitution");
    expect(constitution).toMatchObject({
      published: "2026-01-22",
      // JSON-LD and OpenGraph both carry the listing's own `og:description`.
      abstract: "",
      authors: [],
    });
    expect(cards.map((card) => card.abstract)).not.toContain(BLURB);
    // Declared metadata is not model output: the listing was the one call.
    expect(lab.calls.extract).toBe(1);
  });

  it("fills authors from citation_author, or from a JSON-LD Person, and the DOI a page declares", async () => {
    const lab = await opened();

    await lab.run();
    const cards = await lab.cards();

    expect(
      byTitle(cards, "Sparse Probes Find Planning Features")
    ).toMatchObject({
      authors: ["Rowe, Ada", "Ito, Ben"],
      published: "2025-08-14",
      doi: "10.5555/sparse.probes.2025",
      // `citation_abstract` comes before OpenGraph.
      abstract:
        "We train sparse linear probes on residual activations and find features that anticipate tokens several steps ahead.",
    });
    expect(
      byTitle(cards, "Natural Emergent Misalignment from Reward Hacking")
    ).toMatchObject({
      authors: ["Monte MacDiarmid", "Evan Hubinger"],
      published: "2025-11-21",
      abstract:
        "We show that learning to reward hack in production coding environments generalises to broader misalignment.",
    });
  });

  it("dates a page that declares nothing else from its time element", async () => {
    const lab = await opened();

    await lab.run();

    expect(
      byTitle(await lab.cards(), "A Plain Post With No Markup")
    ).toMatchObject({ published: "2025-05-02", abstract: "", authors: [] });
  });

  it("leaves the card as the listing showed it when its Item page cannot be fetched, and counts the try", async () => {
    const served = { ...PAGES };
    delete served["/research/plain-post"];
    const lab = await opened({ pages: served });

    await lab.run();

    expect(
      byTitle(await lab.cards(), "A Plain Post With No Markup")
    ).toMatchObject({ published: "", abstract: "", authors: [] });
    expect(
      lab.rows(
        "SELECT item_page_tries FROM proposals WHERE title = 'A Plain Post With No Markup'"
      )
    ).toEqual([{ item_page_tries: 1 }]);
    expect(lab.rows("SELECT item_pages_read FROM scout_runs")).toEqual([
      { item_pages_read: 5 },
    ]);
  });

  it("fills only what the listing left empty", async () => {
    const lab = await opened();

    await lab.run();

    expect(
      byTitle(await lab.cards(), "A Card the Listing Already Dated")
    ).toMatchObject({
      published: "Jun 20, 2025",
      authors: ["Jane Listed"],
      abstract: "The page's own summary, which fills the empty abstract.",
    });
  });

  it("is read only for a link on the listing's host, and nothing an Item page links to is asked for", async () => {
    const lab = await opened();

    await lab.run();

    expect(lab.pagesAsked().sort()).toEqual(
      [
        "www.anthropic.com/research/team/alignment",
        "www.anthropic.com/research/agentic-misalignment",
        "www.anthropic.com/constitution",
        "www.anthropic.com/research/sparse-probes",
        "www.anthropic.com/research/reward-hacking",
        "www.anthropic.com/research/plain-post",
        "www.anthropic.com/research/already-dated",
      ].sort()
    );
    // The item on another host is still a card, as the listing showed it.
    expect(
      byTitle(await lab.cards(), "A Post on the Alignment Science Blog")
    ).toMatchObject({ published: "", abstract: "", authors: [] });
    // Each Item page is fetched with the listing's etiquette, robots.txt first.
    expect(
      lab.requests.filter((url) => url.pathname === "/robots.txt").length
    ).toBe(7);
  });

  it("ignores a leading www. when it compares hosts", async () => {
    const bare = "https://anthropic.com/research/plain-post";
    const lab = await opened({
      pages: {
        ...PAGES,
        "/research/team/alignment": PAGES["/research/team/alignment"]!.replace(
          "https://www.anthropic.com/research/plain-post",
          bare
        ),
      },
      listed: () => [item({ title: "A Plain Post With No Markup", url: bare })],
    });

    await lab.run();

    expect(lab.pagesAsked()).toContain("anthropic.com/research/plain-post");
    expect((await lab.cards())[0]).toMatchObject({ published: "2025-05-02" });
  });

  it("is read at most 25 times a run, in the listing's order, and the rest are owed", async () => {
    const many = Array.from({ length: 27 }, (_, n) => ({
      title: `Post number ${n + 1}`,
      path: `/research/post-${n + 1}`,
    }));
    const listing = `<html><body><main>${many
      .map(
        (p) =>
          `<article><a href="https://www.anthropic.com${p.path}">${p.title}</a></article>`
      )
      .join("")}</main></body></html>`;
    const pages: Record<string, string> = {
      "/research/team/alignment": listing,
    };
    for (const p of many) {
      pages[p.path] =
        `<html><head><meta property="article:published_time" content="2025-09-01T00:00:00Z"></head><body>${p.title}</body></html>`;
    }
    const lab = await opened({
      pages,
      listed: () =>
        many.map((p) =>
          item({ title: p.title, url: `https://www.anthropic.com${p.path}` })
        ),
    });

    await lab.run();

    const asked = lab.pagesAsked().filter((p) => p.includes("/post-"));
    expect(asked).toHaveLength(25);
    expect(asked).toEqual(
      many.slice(0, 25).map((p) => `www.anthropic.com${p.path}`)
    );
    expect(lab.rows("SELECT item_pages_read FROM scout_runs")).toEqual([
      { item_pages_read: 25 },
    ]);
    // Read pages owe nothing; the two past the ceiling are owed a read.
    expect(
      lab.rows<{ title: string; item_page_tries: number | null }>(
        "SELECT title, item_page_tries FROM proposals ORDER BY id"
      )
    ).toEqual(
      many.map((p, n) => ({
        title: p.title,
        item_page_tries: n < 25 ? null : 0,
      }))
    );
    const cards = await lab.cards();
    expect(byTitle(cards, "Post number 1").published).toBe("2025-09-01");
    expect(byTitle(cards, "Post number 27").published).toBe("");
  });

  it("is read once: an item seen on an earlier run is not read again", async () => {
    let listed = LISTED.slice(0, 2);
    const lab = await opened({ listed: () => listed });
    await lab.run();
    // The listing changes, so it is read again, and one item on it is new.
    lab.pages["/research/team/alignment"] = PAGES[
      "/research/team/alignment"
    ]!.replace("<h1>Alignment</h1>", "<h1>Alignment research</h1>");
    listed = LISTED.slice(0, 3);
    lab.requests.length = 0;

    await lab.run();

    expect(lab.pagesAsked().sort()).toEqual([
      "www.anthropic.com/research/sparse-probes",
      "www.anthropic.com/research/team/alignment",
    ]);
    expect(
      lab.rows("SELECT item_pages_read FROM scout_runs ORDER BY id")
    ).toEqual([{ item_pages_read: 2 }, { item_pages_read: 1 }]);
  });

  it("records the Item pages a run read", async () => {
    const lab = await opened();

    await lab.run();

    // Six on the listing's host; the seventh is elsewhere and is not counted.
    expect(lab.rows("SELECT item_pages_read FROM scout_runs")).toEqual([
      { item_pages_read: 6 },
    ]);
  });
});

// The Extraction for the gap (#886; ADR 0055 decisions 3 and 4): what an Item
// page did not declare is asked of the model, and every value it copies must
// occur on that page as the model was shown it, or it is dropped and counted
// while the rest of the card stands. The model here is a stand-in that copies
// whatever a test says it copied, so a value it "made up" is one the page
// does not have.

const AGENTIC = "Agentic Misalignment: How LLMs could be insider threats";
const BYLINE: ExtractedItem = item({
  title: "A Byline With No Markup",
  url: "https://www.anthropic.com/research/byline",
});

const onPage = (call: ItemPageCall, title: string) => call.page.includes(title);

describe("an Item page's Extraction", () => {
  it("fills authors copied from a citation block when the page declares none", async () => {
    const lab = await opened({
      itemPage: (call) =>
        onPage(call, AGENTIC)
          ? { authors: ["Lynch, Aengus", "Wright, Benjamin"] }
          : {},
    });

    await lab.run();

    expect(byTitle(await lab.cards(), AGENTIC)).toMatchObject({
      authors: ["Lynch, Aengus", "Wright, Benjamin"],
      // What the page declared still stands beside what was copied.
      published: "2025-06-20",
    });
  });

  it("drops a made-up author and counts it, and keeps the rest of the card", async () => {
    const lab = await opened({
      itemPage: (call) =>
        onPage(call, AGENTIC)
          ? { authors: ["Lynch, Aengus", "Chris Invented"] }
          : {},
    });

    await lab.run();

    expect(byTitle(await lab.cards(), AGENTIC)).toMatchObject({
      authors: ["Lynch, Aengus"],
      published: "2025-06-20",
      abstract:
        "We stress-tested 16 leading models in hypothetical corporate environments to identify risky agentic behaviors before they cause real harm.",
    });
    expect(lab.rows("SELECT item_values_dropped FROM scout_runs")).toEqual([
      { item_values_dropped: 1 },
    ]);
  });

  it("never replaces what the page declared, and ignores a field it was not asked for", async () => {
    // Asked for authors and venue only; it also copies a summary that is on
    // the page and a date that is not.
    const lab = await opened({
      itemPage: (call) =>
        onPage(call, AGENTIC)
          ? {
              authors: ["Lynch, Aengus"],
              date: "Jan 1, 2020",
              abstract:
                "Agentic Misalignment: How LLMs could be insider threats",
            }
          : {},
    });

    await lab.run();

    expect(byTitle(await lab.cards(), AGENTIC)).toMatchObject({
      authors: ["Lynch, Aengus"],
      published: "2025-06-20",
      abstract:
        "We stress-tested 16 leading models in hypothetical corporate environments to identify risky agentic behaviors before they cause real harm.",
    });
    // Neither unasked value is weighed, so neither is counted as dropped.
    expect(lab.rows("SELECT item_values_dropped FROM scout_runs")).toEqual([
      { item_values_dropped: 0 },
    ]);
  });

  it("drops the organisation the page declares as its author when the model copies it, though it is on the page", async () => {
    const lab = await opened({
      itemPage: (call) =>
        onPage(call, AGENTIC)
          ? { authors: ["Anthropic", "Lynch, Aengus"] }
          : {},
    });

    await lab.run();

    expect(byTitle(await lab.cards(), AGENTIC).authors).toEqual([
      "Lynch, Aengus",
    ]);
    expect(lab.rows("SELECT item_values_dropped FROM scout_runs")).toEqual([
      { item_values_dropped: 1 },
    ]);
  });

  it("never takes a name the page hid in a script, which the model was never shown", async () => {
    // The fixture's script payload names "Not An Author"; reduction strips it.
    const lab = await opened({
      itemPage: (call) =>
        onPage(call, AGENTIC) ? { authors: ["Not An Author"] } : {},
    });

    await lab.run();

    expect(byTitle(await lab.cards(), AGENTIC).authors).toEqual([]);
    expect(lab.rows("SELECT item_values_dropped FROM scout_runs")).toEqual([
      { item_values_dropped: 1 },
    ]);
  });

  it("checks a date as the page wrote it, then stores it as a day", async () => {
    const lab = await opened({
      listed: () => [BYLINE],
      itemPage: () => ({
        authors: ["Aengus Lynch", "Benjamin Wright"],
        date: "Jun 20, 2025",
        venue: "Transactions on Machine Learning Research",
        abstract:
          "We find that models trained to hide a goal still reveal it under light probing.",
      }),
    });

    await lab.run();

    expect((await lab.cards())[0]).toMatchObject({
      authors: ["Aengus Lynch", "Benjamin Wright"],
      published: "2025-06-20",
      venue: "Transactions on Machine Learning Research",
      // The page wraps the sentence across lines; whitespace is collapsed.
      abstract:
        "We find that models trained to hide a goal still reveal it under light probing.",
    });
    expect(lab.rows("SELECT item_values_dropped FROM scout_runs")).toEqual([
      { item_values_dropped: 0 },
    ]);
  });

  it("drops a date the page does not write, even one that means the same day", async () => {
    const lab = await opened({
      listed: () => [BYLINE],
      itemPage: () => ({ date: "2025-06-20", abstract: "A summary of mine." }),
    });

    await lab.run();

    expect((await lab.cards())[0]).toMatchObject({
      published: "",
      abstract: "",
    });
    expect(lab.rows("SELECT item_values_dropped FROM scout_runs")).toEqual([
      { item_values_dropped: 2 },
    ]);
  });

  it("keeps a date as copied when it does not read as a day", async () => {
    const page = PAGES["/research/byline"]!.replace(
      "Jun 20, 2025",
      "Summer 2025"
    );
    const lab = await opened({
      pages: { ...PAGES, "/research/byline": page },
      listed: () => [BYLINE],
      itemPage: () => ({ date: "Summer 2025" }),
    });

    await lab.run();

    expect((await lab.cards())[0]).toMatchObject({ published: "Summer 2025" });
  });

  it("keeps a date the calendar does not have as copied, never a day it is not", async () => {
    const page = PAGES["/research/byline"]!.replace(
      "Jun 20, 2025",
      "Feb 31, 2025"
    );
    const lab = await opened({
      pages: { ...PAGES, "/research/byline": page },
      listed: () => [BYLINE],
      itemPage: () => ({ date: "Feb 31, 2025" }),
    });

    await lab.run();

    expect((await lab.cards())[0]).toMatchObject({ published: "Feb 31, 2025" });
  });

  it("asks only for what is still empty, and makes no call for a page whose declared metadata left nothing empty", async () => {
    const lab = await opened();

    await lab.run();

    const asked = (title: string) =>
      lab.calls.itemPages
        .filter((call) => onPage(call, title))
        .map((call) => call.needed);
    // Declared people, date and summary: nothing to ask.
    expect(asked("Sparse Probes Find Planning Features")).toEqual([]);
    expect(asked("Natural Emergent Misalignment from Reward Hacking")).toEqual(
      []
    );
    // The listing gave the date and author, the page its summary.
    expect(asked("A Card the Listing Already Dated")).toEqual([]);
    // A date and summary declared, an Organization for its author.
    expect(asked(AGENTIC)).toEqual([["authors", "venue"]]);
    // Only a date declared; its summary was the site's blurb.
    expect(asked("Claude's new constitution")).toEqual([
      ["authors", "venue", "abstract"],
    ]);
    expect(asked("A Plain Post With No Markup")).toEqual([
      ["authors", "venue", "abstract"],
    ]);
    expect(lab.calls.itemPages).toHaveLength(3);
  });

  it("cuts a long Item page to its budget before the call, and a value past the cut is not on the page it was shown", async () => {
    const filler = "<p>A paragraph of the paper itself.</p>".repeat(1500);
    const long = PAGES["/research/byline"]!.replace(
      "</article>",
      `${filler}<p>Acknowledged: Late Name.</p></article>`
    );
    const lab = await opened({
      pages: { ...PAGES, "/research/byline": long },
      listed: () => [BYLINE],
      itemPage: () => ({ authors: ["Aengus Lynch", "Late Name"] }),
    });

    await lab.run();

    const shown = lab.calls.itemPages[0]!.page;
    // The stand-in counts a token as four characters; the budget is 8K.
    expect(Math.ceil(shown.length / 4)).toBeLessThanOrEqual(8000);
    expect(shown).toContain("By Aengus Lynch and Benjamin Wright");
    expect(shown).not.toContain("Late Name");
    expect((await lab.cards())[0]!.authors).toEqual(["Aengus Lynch"]);
  });

  it("sums the Item pages' tokens and cost into the run's", async () => {
    const lab = await opened();

    await lab.run();

    const [row] = lab.rows<{
      model: string;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cost_usd: number;
    }>(
      "SELECT model, input_tokens, output_tokens, cache_read_tokens, cost_usd FROM scout_runs"
    );
    // The listing's one call and three Item page calls.
    const spent = {
      input: usage.input + 3 * itemUsage.input,
      output: usage.output + 3 * itemUsage.output,
      cacheRead: usage.cacheRead + 3 * itemUsage.cacheRead,
    };
    expect(row).toMatchObject({
      input_tokens: spent.input,
      output_tokens: spent.output,
      cache_read_tokens: spent.cacheRead,
    });
    expect(row!.cost_usd).toBeCloseTo(costUsd(row!.model, spent)!, 10);
  });

  it("leaves the card as declared, and the page owed again, when the model cannot read it", async () => {
    const lab = await opened({ listed: () => [BYLINE, LISTED[0]!] });
    lab.models.extractItemPage = () =>
      Promise.reject(
        new ModelError("model", "the provider answered HTTP 529", itemUsage)
      );

    expect(await lab.run()).toMatchObject({ outcome: "ok", new: 2 });

    expect(byTitle(await lab.cards(), AGENTIC)).toMatchObject({
      published: "2025-06-20",
      authors: [],
    });
    expect(
      lab.rows("SELECT item_page_tries FROM proposals ORDER BY id")
    ).toEqual([{ item_page_tries: 1 }, { item_page_tries: 1 }]);
    expect(
      lab.rows("SELECT item_pages_read, input_tokens FROM scout_runs")
    ).toEqual([
      {
        item_pages_read: 0,
        // What the failed calls cost is still the run's.
        input_tokens: usage.input + 2 * itemUsage.input,
      },
    ]);
  });

  it("fails the run when the key is rejected on an Item page, with what it spent, and its cards come on the next run", async () => {
    const lab = await opened({ listed: () => [BYLINE] });
    const copy = lab.models.extractItemPage;
    lab.models.extractItemPage = () =>
      Promise.reject(new ModelError("credentials", "key rejected"));

    expect(await lab.run()).toMatchObject({ outcome: "failed" });
    expect(await lab.cards()).toEqual([]);
    expect(
      lab.rows("SELECT error_kind, error_message, input_tokens FROM scout_runs")
    ).toEqual([
      {
        error_kind: "credentials",
        error_message: "key rejected",
        input_tokens: usage.input,
      },
    ]);

    lab.models.extractItemPage = copy;
    await lab.run();

    expect((await lab.cards()).map((card) => card.title)).toEqual([
      "A Byline With No Markup",
    ]);
  });
});
