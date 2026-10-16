import { mkdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryCredentialStore } from "./credentials.js";
import type { ModelProvider } from "./model-provider.js";
import type { ScoutActivity } from "./scout-activity.js";
import type { RunSummary } from "./scouts.js";
import {
  closeCores,
  core,
  fixtureCopy,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// #609 (spec #563, ADR 0043 decisions 2 and 3): what a re-pointed Scout's
// first look does. Driven through the router on a temp vault; the pages, the
// feeds and the model are injected, and what is read back is the run row, the
// cards and the Accept rate the researcher sees.

const A = "https://lab.example/publications";
const B = "https://lab.example/moved";
const FILE = `name: Sleep Lab
source:
  kind: watched
  url: ${A}
cadence: weekly
lane: review
created: 2026-09-20T00:00:00Z
`;
const WEEK = 7 * 24 * 3_600_000;

const paper = (n: number) => ({
  title: `Paper number ${n} on sleep`,
  url: `https://lab.example/papers/${n}`,
});
const html = (...ns: number[]) =>
  `<html><body><h1>Publications</h1><ul>${ns
    .map((n) => `<li><a href="${paper(n).url}">${paper(n).title}</a></li>`)
    .join("")}</ul></body></html>`;
const feed = (...ns: number[]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>Lab</title>${ns
    .map(
      (n) =>
        `<item><title>${paper(n).title}</title><link>${paper(n).url}</link></item>`
    )
    .join("")}</channel></rss>`;

type Served = { body: string; type?: string };

async function opened() {
  const vault = await fixtureCopy("obsidian-vault");
  const path = join(vault, ".vitrine/scouts/lab.yaml");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, FILE);
  const pages: Record<string, Served> = {};
  let at = Date.parse("2026-10-05T12:00:00Z");
  let extractions = 0;
  // Answers with whichever numbered papers the page it was shown lists.
  const models: ModelProvider = {
    countTokens: ({ text }) => Promise.resolve(Math.ceil(text.length / 4)),
    extract: ({ page }) => {
      extractions++;
      return Promise.resolve({
        items: [1, 2, 3, 4, 5]
          .filter((n) => page.includes(paper(n).title))
          .map((n) => ({
            ...paper(n),
            authors: ["Ada Rowe"],
            date: null,
            venue: "Journal of Sleep",
            keywords: null,
            abstract: null,
          })),
        usage: { input: 1200, output: 300, cacheRead: 0 },
      });
    },
  };
  const c = await core({
    now: () => new Date(at),
    arxiv: {
      clock: virtualClock(),
      fetch: () => Promise.resolve(new Response("")),
    },
    watched: {
      timeoutMs: 1000,
      models,
      credentials: createMemoryCredentialStore({ anthropic: "sk-test" }),
      model: "claude-sonnet-5-5",
      fetch: (input) => {
        const served = pages[urlOf(input).pathname];
        return Promise.resolve(
          served === undefined
            ? new Response("", { status: 404 })
            : new Response(served.body, {
                headers: { "content-type": served.type ?? "text/html" },
              })
        );
      },
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const ok = async <T>(
    kind: "query" | "mutate",
    route: string,
    input?: unknown
  ) => {
    const r = await c[kind]<T>(route, input);
    expect(r.error).toBeUndefined();
    return r.result!.data;
  };
  const sql = <T>(statement: string) => {
    const handle = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"), {
      readOnly: true,
    });
    try {
      return handle.prepare(statement).all() as T;
    } finally {
      handle.close();
    }
  };
  return {
    pages,
    extractions: () => extractions,
    wait: () => (at += WEEK),
    pointAt: (url: string) =>
      ok("mutate", "scouts.save", {
        id: "lab",
        name: "Sleep Lab",
        watching: "watched",
        query: url,
        cadence: "weekly",
        assigned: [],
        lane: "review",
        searchBackTo: null,
      }),
    run: () => ok<RunSummary>("mutate", "scouts.runNow", { scoutId: "lab" }),
    cards: () =>
      ok<Array<{ id: number; title: string; retroactive: boolean }>>(
        "query",
        "scouts.queue"
      ),
    accept: (proposalId: number) =>
      ok("mutate", "scouts.accept", { proposalId }),
    rejectRun: (runId: number) => ok("mutate", "scouts.rejectRun", { runId }),
    rate: async () => {
      const activity = await ok<ScoutActivity>("query", "scouts.activity");
      const row = activity.rows.find(
        (r) => r.kind === "scout" && r.id === "lab"
      );
      if (row?.kind !== "scout") throw new Error("no row");
      return row.acceptRate;
    },
    /** Rewrites history the way a vault from before the column has it. */
    forgetPages: () => {
      const handle = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"));
      try {
        handle.exec("UPDATE scout_runs SET query = NULL");
      } finally {
        handle.close();
      }
    },
    retroactive: () =>
      sql<Array<{ retroactive: number }>>(
        "SELECT retroactive FROM scout_runs ORDER BY id"
      ).map((r) => r.retroactive === 1),
  };
}

describe("the first look at a new page", () => {
  it("proposes everything the page lists as Retroactive, and a reject this run on it leaves the Accept rate alone while one on an ordinary run counts", async () => {
    const lab = await opened();
    lab.pages["/publications"] = { body: html(1) };
    lab.pages["/moved"] = { body: html(2, 3) };
    const firstRun = await lab.run();
    await lab.accept((await lab.cards())[0]!.id);
    expect(firstRun.new).toBe(1);
    expect(await lab.rate()).toMatchObject({ accepted: 1, triaged: 1 });

    lab.wait();
    await lab.pointAt(B);
    const look = await lab.run();

    expect(look).toMatchObject({ outcome: "ok", new: 2 });
    expect((await lab.cards()).every((card) => card.retroactive)).toBe(true);
    await lab.rejectRun(look.runId);
    expect(await lab.rate()).toMatchObject({ accepted: 1, triaged: 1 });

    // The next run at B is an ordinary one: clearing it counts.
    lab.wait();
    lab.pages["/moved"] = { body: html(2, 3, 4) };
    const ordinary = await lab.run();
    expect(ordinary.new).toBe(1);
    await lab.rejectRun(ordinary.runId);
    expect(await lab.rate()).toMatchObject({ accepted: 1, triaged: 2 });
  });

  it("proposes only what is new from a page that overlaps the old one", async () => {
    const lab = await opened();
    lab.pages["/publications"] = { body: html(1, 2) };
    lab.pages["/moved"] = { body: html(2, 3, 4) };
    await lab.run();
    lab.wait();
    await lab.pointAt(B);

    const look = await lab.run();

    expect(look).toMatchObject({ fetched: 3, new: 2 });
    expect((await lab.cards()).map((card) => card.title).sort()).toEqual([
      paper(1).title,
      paper(2).title,
      paper(3).title,
      paper(4).title,
    ]);
  });

  it("reads byte-identical text at a new URL once, and at the same URL skips it", async () => {
    const lab = await opened();
    lab.pages["/publications"] = { body: html(1, 2) };
    lab.pages["/moved"] = { body: html(1, 2) };
    await lab.run();
    lab.wait();
    expect((await lab.run()).fetched).toBe(0);
    expect(lab.extractions()).toBe(1);

    await lab.pointAt(B);
    lab.wait();
    const look = await lab.run();

    expect(look.fetched).toBe(2);
    expect(lab.extractions()).toBe(2);
    lab.wait();
    expect((await lab.run()).fetched).toBe(0);
    expect(lab.extractions()).toBe(2);
  });

  it("resumes a page's runs when the Scout is pointed back at it: not a first look, not Retroactive", async () => {
    const lab = await opened();
    lab.pages["/publications"] = { body: html(1, 2) };
    lab.pages["/moved"] = { body: html(3) };
    await lab.run();
    await lab.pointAt(B);
    lab.wait();
    await lab.run();
    await lab.pointAt(A);
    lab.wait();

    const back = await lab.run();

    // A's last clean look is the baseline: its text is unchanged, so no read.
    expect(back).toMatchObject({ outcome: "ok", fetched: 0, new: 0 });
    expect(lab.extractions()).toBe(2);
    expect(lab.retroactive()).toEqual([true, true, false]);
  });

  it("treats a feed address the same way: its first look is Retroactive and proposes only the unseen", async () => {
    const lab = await opened();
    lab.pages["/publications"] = {
      body: feed(1, 2),
      type: "application/rss+xml",
    };
    lab.pages["/moved"] = { body: feed(2, 3), type: "application/rss+xml" };
    await lab.run();
    lab.wait();
    await lab.pointAt(B);

    const look = await lab.run();

    expect(look).toMatchObject({ fetched: 2, new: 1 });
    expect(lab.extractions()).toBe(0);
    expect(lab.retroactive()).toEqual([true, true]);
    lab.wait();
    await lab.pointAt(A);
    await lab.run();
    expect(lab.retroactive()).toEqual([true, true, false]);
  });

  it("stays a first look until a run has read the page: a mistyped address, then the right one", async () => {
    const lab = await opened();
    lab.pages["/publications"] = { body: html(1) };
    await lab.run();
    await lab.pointAt(B);
    lab.wait();
    expect((await lab.run()).outcome).not.toBe("ok");

    lab.pages["/moved"] = { body: html(2) };
    lab.wait();
    await lab.run();

    expect(lab.retroactive()).toEqual([true, true, true]);
  });

  it("takes a run from before the page was recorded as belonging, never as an edit", async () => {
    const lab = await opened();
    lab.pages["/publications"] = { body: html(1) };
    await lab.run();
    lab.forgetPages();
    lab.wait();

    const again = await lab.run();

    expect(again.fetched).toBe(0);
    expect(lab.retroactive()).toEqual([true, false]);
  });
});
