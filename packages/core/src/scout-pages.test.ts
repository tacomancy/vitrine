import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryCredentialStore } from "./credentials.js";
import type { ModelProvider } from "./model-provider.js";
import type { ScoutActivity, ScoutRow } from "./scout-activity.js";
import type { Scout, UnreadableScout } from "./scout-file.js";
import type { LooseEndRow, LooseEnds } from "./loose-ends.js";
import type { Health } from "./scout-health.js";
import type { RunSummary } from "./scouts.js";
import {
  copiesNothing,
  closeCores,
  core,
  fixtureCopy,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// #910 (spec #909, ADR 0056): one Watched Scout reads several pages, each on
// its own run, Due on its own, with its own health. Driven through the router
// on a temp vault: the Scout file is written by hand (the form is #911), the
// pages and the model are injected, and what is read back is what a surface
// is handed.

const RESEARCH = "https://lab.example/research";
const NEWS = "https://lab.example/news";
const BLOG = "https://lab.example/blog";

const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;

const fileWith = (source: string) => `name: Lab
# kept by every read
source:
  kind: watched
${source}
cadence: weekly
lane: review
created: 2026-09-20T00:00:00Z
`;
const urls = (...pages: string[]) =>
  `  urls:\n${pages.map((p) => `    - ${p}`).join("\n")}`;

const paper = (n: number) => ({
  title: `Paper number ${n} on sleep`,
  url: `https://lab.example/papers/${n}`,
});
const html = (...ns: number[]) =>
  `<html><body><h1>Publications</h1><ul>${ns
    .map((n) => `<li><a href="${paper(n).url}">${paper(n).title}</a></li>`)
    .join("")}</ul></body></html>`;
const feed = (...ns: number[]) => ({
  body: `<?xml version="1.0"?><rss version="2.0"><channel><title>Lab</title>${ns
    .map(
      (n) =>
        `<item><title>${paper(n).title}</title><link>${paper(n).url}</link></item>`
    )
    .join("")}</channel></rss>`,
  type: "application/rss+xml",
});

type Served = { body: string; type?: string };

async function opened(file: string, { key = true } = {}) {
  const vault = await fixtureCopy("obsidian-vault");
  const path = join(vault, ".vitrine/scouts/lab.yaml");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, file);
  const pages: Record<string, Served> = {};
  const fetched: Record<string, number> = {};
  let at = Date.parse("2026-10-05T12:00:00Z");
  const models: ModelProvider = {
    extractItemPage: copiesNothing,
    countTokens: ({ text }) => Promise.resolve(Math.ceil(text.length / 4)),
    extract: ({ page }) =>
      Promise.resolve({
        items: [1, 2, 3, 4, 5, 6, 7, 8, 9]
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
      }),
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
      credentials: createMemoryCredentialStore(
        key ? { anthropic: "sk-test" } : {}
      ),
      model: "claude-sonnet-5-5",
      fetch: (input) => {
        const path = urlOf(input).pathname;
        fetched[path] = (fetched[path] ?? 0) + 1;
        const served = path.startsWith("/papers/")
          ? { body: "<html><body></body></html>", type: undefined }
          : pages[path];
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
  const row = async () => {
    const activity = await ok<ScoutActivity>("query", "scouts.activity");
    const found = activity.rows.find(
      (r): r is ScoutRow => r.kind === "scout" && r.id === "lab"
    );
    if (found === undefined) throw new Error("no row");
    return found;
  };
  return {
    vault,
    path,
    pages,
    fetched,
    wait: (ms: number) => (at += ms),
    rewrite: (text: string) => writeFile(path, text),
    run: () => ok<RunSummary>("mutate", "scouts.runNow", { scoutId: "lab" }),
    runPage: (page: string) =>
      ok<RunSummary>("mutate", "scouts.runNow", { scoutId: "lab", page }),
    // The fixture vault has rows of its own; these are the Scout's.
    looseEnds: async () =>
      (await ok<LooseEnds>("query", "looseEnds.rows")).groups
        .flatMap((g): LooseEndRow[] => g.rows)
        .filter((r) => r.subject === "lab"),
    checkDue: () => ok<string[]>("mutate", "scouts.checkDue"),
    list: () =>
      ok<{ scouts: Scout[]; unreadable: UnreadableScout[] }>(
        "query",
        "scouts.list"
      ),
    activity: () => ok<ScoutActivity>("query", "scouts.activity"),
    mutate: (route: string, input: unknown) => c.mutate(route, input),
    ok,
    row,
    health: async () =>
      (
        await ok<{ scouts: Array<{ id: string; health: Health }> }>(
          "query",
          "scouts.health"
        )
      ).scouts.find((s) => s.id === "lab")!.health,
    waiting: () =>
      ok<Array<{ id: string }>>("query", "credentials.waiting", {
        provider: "anthropic",
      }),
    cards: () =>
      ok<Array<{ id: number; title: string; retroactive: boolean }>>(
        "query",
        "scouts.queue"
      ),
    batches: () =>
      ok<Array<{ runId: number; proposalIds: number[] }>>(
        "query",
        "scouts.batches"
      ),
    runs: () =>
      sql<
        Array<{
          id: number;
          query: string;
          check_id: number | null;
          retroactive: number;
          outcome: string;
          finished: string;
        }>
      >(
        "SELECT id, query, check_id, retroactive, outcome, finished FROM scout_runs ORDER BY id"
      ),
  };
}

describe("a Scout file with several pages", () => {
  it("reads `urls:` as its pages in file order, and `url:` as one page", async () => {
    const lab = await opened(fileWith(urls(RESEARCH, NEWS)));
    expect((await lab.list()).scouts[0]!.source).toEqual({
      kind: "watched",
      urls: [RESEARCH, NEWS],
    });

    await lab.rewrite(fileWith(`  url: ${RESEARCH}`));
    expect((await lab.list()).scouts[0]!.source).toEqual({
      kind: "watched",
      urls: [RESEARCH],
    });
  });

  it.each([
    [
      "both keys",
      `  url: ${RESEARCH}\n${urls(NEWS)}`,
      "source has both url and urls, and a Scout has one of them",
    ],
    ["an empty list", "  urls: []", "source.urls lists no page"],
    [
      "a list that is not one",
      `  urls: ${RESEARCH}`,
      "source.urls is not a list of web addresses",
    ],
    [
      "an entry that is not a web address",
      urls(RESEARCH, "lab.example/news"),
      "source.urls has an entry that is not a web address",
    ],
    [
      "a duplicate once trimmed",
      `  urls:\n    - ${RESEARCH}\n    - "${RESEARCH} "`,
      `source.urls lists ${RESEARCH} twice`,
    ],
  ])(
    "is a file that cannot be read with %s, saying which",
    async (_, source, problem) => {
      const lab = await opened(fileWith(source));
      expect(await lab.list()).toMatchObject({
        scouts: [],
        unreadable: [
          {
            file: "lab.yaml",
            sentence: `This file could not be read: ${problem}.`,
          },
        ],
      });
    }
  );

  it("is never rewritten by a read or a check", async () => {
    const lab = await opened(fileWith(urls(RESEARCH, NEWS)));
    lab.pages["/research"] = { body: html(1) };
    lab.pages["/news"] = feed(2);
    const before = await readFile(lab.path, "utf8");
    await lab.run();
    await lab.activity();
    expect(await readFile(lab.path, "utf8")).toBe(before);
  });
});

describe("a save of a Scout whose file lists its pages", () => {
  const save = (query: string) => ({
    id: "lab",
    name: "Lab",
    watching: "watched",
    query,
    cadence: "daily",
    assigned: [],
    lane: "review",
    searchBackTo: null,
  });

  it("keeps every page and the file's comments when the row saves what it shows", async () => {
    const lab = await opened(fileWith(urls(RESEARCH, NEWS)));

    expect(
      (await lab.mutate("scouts.save", save(RESEARCH))).error
    ).toBeUndefined();

    const text = await readFile(lab.path, "utf8");
    expect(text).toContain(urls(RESEARCH, NEWS));
    expect(text).toContain("# kept by every read");
    expect((await lab.list()).scouts[0]).toMatchObject({
      cadence: "daily",
      source: { urls: [RESEARCH, NEWS] },
    });
  });

  it("refuses a changed address while the form shows only one of several pages, writing nothing", async () => {
    const lab = await opened(fileWith(urls(RESEARCH, NEWS)));
    const before = await readFile(lab.path, "utf8");

    const refused = await lab.mutate("scouts.save", save(BLOG));

    expect(refused.error?.message).toBe(
      "This Scout reads several pages, and the form does not list them yet. Edit its file to change them."
    );
    expect(await readFile(lab.path, "utf8")).toBe(before);
  });

  it("writes a one-page `urls:` file's page in place, never a second key", async () => {
    const lab = await opened(fileWith(urls(RESEARCH)));

    expect((await lab.mutate("scouts.save", save(BLOG))).error).toBeUndefined();

    expect((await lab.list()).scouts[0]!.source).toEqual({
      kind: "watched",
      urls: [BLOG],
    });
  });
});

describe("a check of several pages", () => {
  it("runs every page on Run now, one row per page in file order, sharing a check id", async () => {
    const lab = await opened(fileWith(urls(RESEARCH, NEWS)));
    lab.pages["/research"] = { body: html(1) };
    lab.pages["/news"] = feed(2, 3);

    const first = await lab.run();
    lab.wait(HOUR);
    await lab.run();

    expect(first).toMatchObject({ outcome: "ok", fetched: 3, new: 3 });
    const runs = lab.runs();
    expect(runs.map((r) => r.query)).toEqual([RESEARCH, NEWS, RESEARCH, NEWS]);
    expect(runs[0]!.check_id).not.toBeNull();
    expect(runs[1]!.check_id).toBe(runs[0]!.check_id);
    expect(runs[2]!.check_id).toBe(runs[3]!.check_id);
    expect(runs[2]!.check_id).not.toBe(runs[0]!.check_id);
  });

  it("is Due page by page: a page added by hand is read at the next check and the others are not fetched early", async () => {
    const lab = await opened(fileWith(urls(RESEARCH, NEWS)));
    lab.pages["/research"] = { body: html(1) };
    lab.pages["/news"] = feed(2);
    lab.pages["/blog"] = { body: html(3) };
    await lab.run();
    lab.wait(HOUR);
    await lab.rewrite(fileWith(urls(RESEARCH, NEWS, BLOG)));

    expect(await lab.checkDue()).toEqual(["lab"]);
    expect(
      lab
        .runs()
        .slice(2)
        .map((r) => r.query)
    ).toEqual([BLOG]);
    expect(lab.fetched).toMatchObject({
      "/research": 1,
      "/news": 1,
      "/blog": 1,
    });

    // A week after the first check, its two pages are due and the blog,
    // read an hour later, is not.
    lab.wait(WEEK - HOUR);
    expect(await lab.checkDue()).toEqual(["lab"]);
    const latest = lab.runs().slice(3);
    expect(latest.map((r) => r.query)).toEqual([RESEARCH, NEWS]);
    expect(latest[0]!.check_id).toBe(latest[1]!.check_id);
    expect(lab.fetched["/blog"]).toBe(1);
  });

  it("makes an added page's first look Retroactive, and not the other pages' finds in the same check", async () => {
    const lab = await opened(fileWith(urls(RESEARCH)));
    lab.pages["/research"] = { body: html(1, 2) };
    await lab.run();
    lab.wait(WEEK);
    lab.pages["/research"] = { body: html(1, 2, 4) };
    // The blog lists one paper the Scout already holds and one it does not.
    lab.pages["/blog"] = { body: html(2, 3) };
    await lab.rewrite(fileWith(urls(RESEARCH, BLOG)));

    await lab.run();

    expect(lab.runs().map((r) => [r.query, r.retroactive])).toEqual([
      [RESEARCH, 1],
      [RESEARCH, 0],
      [BLOG, 1],
    ]);
    const cards = await lab.cards();
    const byTitle = (n: number) =>
      cards.find((c) => c.title === paper(n).title)!;
    expect(byTitle(4).retroactive).toBe(false);
    expect(byTitle(3).retroactive).toBe(true);
    // What the Scout held from the research page is neither proposed again
    // nor in the blog's batch, and its Item page is not read again.
    expect(cards.filter((c) => c.title === paper(2).title)).toHaveLength(1);
    const blogRun = lab.runs()[2]!.id;
    const batch = (await lab.batches()).find((b) => b.runId === blogRun)!;
    expect(batch.proposalIds).toEqual([byTitle(3).id]);
    expect(lab.fetched["/papers/2"]).toBe(1);
  });

  it("keeps a removed page's finds with the Scout, and resumes its runs when it is added back", async () => {
    const lab = await opened(fileWith(urls(RESEARCH, BLOG)));
    lab.pages["/research"] = { body: html(1) };
    lab.pages["/blog"] = { body: html(2) };
    await lab.run();
    await lab.rewrite(fileWith(urls(RESEARCH)));

    const removed = await lab.row();
    expect(removed.source).toMatchObject({
      kind: "watched",
      pages: [{ url: RESEARCH }],
    });
    expect(removed.volume.proposals).toBe(2);
    expect((await lab.cards()).map((c) => c.title).sort()).toEqual([
      paper(1).title,
      paper(2).title,
    ]);

    lab.wait(WEEK);
    await lab.rewrite(fileWith(urls(RESEARCH, BLOG)));
    expect((await lab.row()).source).toMatchObject({
      pages: [{ url: RESEARCH }, { url: BLOG, health: { voice: "claim" } }],
    });
    await lab.run();
    expect(lab.runs().map((r) => [r.query, r.retroactive])).toEqual([
      [RESEARCH, 1],
      [BLOG, 1],
      [RESEARCH, 0],
      [BLOG, 0],
    ]);
  });
});

describe("reject this run on a Scout of several pages", () => {
  it("counts and rejects what every page of the newest check found, and leaves an added page's Retroactive batch to its own", async () => {
    const lab = await opened(fileWith(urls(RESEARCH, NEWS)));
    lab.pages["/research"] = { body: html(1) };
    lab.pages["/news"] = feed(2);
    await lab.run();
    lab.wait(WEEK);
    lab.pages["/research"] = { body: html(1, 3) };
    lab.pages["/news"] = feed(2, 4);
    lab.pages["/blog"] = { body: html(5) };
    await lab.rewrite(fileWith(urls(RESEARCH, NEWS, BLOG)));
    await lab.run();

    const group = (
      await lab.ok<Array<{ id: string; runId: number; runPending: number }>>(
        "query",
        "scouts.groups"
      )
    ).find((g) => g.id === "lab")!;
    expect(group.runPending).toBe(2);
    expect(
      await lab.ok<{ rejected: number }>("mutate", "scouts.rejectRun", {
        runId: group.runId,
      })
    ).toEqual({ rejected: 2 });

    const pending = (await lab.cards()).map((c) => c.title).sort();
    expect(pending).toEqual([1, 2, 5].map((n) => paper(n).title).sort());
  });
});

describe("the weekly line of a Scout of several pages", () => {
  it("does not take the runs of its pages, one after another, for a page that changed; an added page does change it", async () => {
    const lab = await opened(fileWith(urls(RESEARCH, NEWS)));
    lab.pages["/research"] = { body: html(1) };
    lab.pages["/news"] = feed(2);
    lab.pages["/blog"] = { body: html(3) };
    await lab.run();
    lab.wait(WEEK);
    await lab.run();
    // The research page's card, whose authors and venue the rate needs.
    const card = (await lab.cards()).find((c) => c.title === paper(1).title)!;
    expect(
      (await lab.mutate("scouts.accept", { proposalId: card.id })).error
    ).toBeUndefined();

    expect((await lab.row()).acceptRate).toMatchObject({
      kind: "rate",
      pageChange: null,
    });

    lab.wait(HOUR);
    await lab.rewrite(fileWith(urls(RESEARCH, NEWS, BLOG)));
    await lab.checkDue();
    const added = lab.runs().at(-1)!;
    expect(added.query).toBe(BLOG);
    expect((await lab.row()).acceptRate).toMatchObject({
      pageChange: { at: added.finished },
    });
  });
});

describe("the health of a Scout of several pages", () => {
  it("is its worst page's Voice, naming the page that is not well in that page's own sentence", async () => {
    const lab = await opened(fileWith(urls(RESEARCH, NEWS)));
    lab.pages["/research"] = { body: html(1) };
    // The news page answers 404.
    await lab.run();

    const sentence =
      "The page answered with an error (HTTP 404) or was too large to read, so nothing was checked.";
    expect(await lab.health()).toEqual({
      voice: "wrong",
      kind: "http",
      sentence: `${NEWS}: ${sentence}`,
    });
    expect((await lab.row()).source).toEqual({
      kind: "watched",
      pages: [
        { url: RESEARCH, health: { voice: "claim", warrant: null } },
        { url: NEWS, health: { voice: "wrong", kind: "http", sentence } },
      ],
    });
  });

  it("takes wrong over not yet, and names every page that is not well", async () => {
    const lab = await opened(fileWith(urls(RESEARCH, NEWS)));
    lab.pages["/research"] = { body: html(1) };
    await lab.run();
    await lab.rewrite(fileWith(urls(RESEARCH, NEWS, BLOG)));

    const health = await lab.health();
    expect(health).toMatchObject({ voice: "wrong", kind: "http" });
    expect(health.voice === "wrong" && health.sentence).toBe(
      `${NEWS}: The page answered with an error (HTTP 404) or was too large to read, so nothing was checked. ` +
        `${BLOG}: Not yet — this page has not been read; first check due now.`
    );
  });

  it("says a page added to a Scout that has read others is unread, never that it changed", async () => {
    const lab = await opened(fileWith(urls(RESEARCH)));
    lab.pages["/research"] = { body: html(1) };
    await lab.run();
    await lab.rewrite(fileWith(urls(RESEARCH, NEWS)));
    lab.wait(HOUR);
    // Its first look fails: a fault of its own, not an edit of a page.
    await lab.run();

    const news = (await lab.row()).source;
    expect(news).toMatchObject({
      pages: [
        { url: RESEARCH },
        {
          url: NEWS,
          health: {
            voice: "wrong",
            sentence:
              "The page answered with an error (HTTP 404) or was too large to read, so nothing was checked.",
          },
        },
      ],
    });
  });

  // The invariant the per-page health exists for (ADR 0056 decision 5): read
  // across the Scout, the busy page's finds would make the quiet one look
  // like it is still finding, and a page gone silent would be hidden.
  it("draws a page that parses cleanly and has gone quiet as a Quiet field on that page, beside a page that keeps finding", async () => {
    const lab = await opened(fileWith(urls(RESEARCH, NEWS)));
    lab.pages["/research"] = { body: html(1, 2) };
    const listed = [10];
    lab.pages["/news"] = feed(...listed);
    await lab.run();
    for (let week = 1; week <= 3; week++) {
      lab.wait(WEEK);
      listed.push(10 + week);
      lab.pages["/news"] = feed(...listed);
      await lab.run();
    }

    const row = await lab.row();
    expect(row.health).toEqual({ voice: "claim", warrant: null });
    const [research, news] =
      row.source.kind === "watched" ? row.source.pages : [];
    expect(news!.health).toEqual({ voice: "claim", warrant: null });
    expect(research!.health).toMatchObject({
      voice: "claim",
      warrant: {
        fragments: [
          "newest run just now",
          "parsed cleanly",
          expect.any(String),
        ],
      },
    });
  });

  it("counts a Scout with one broken page as broken in the fleet's source health, never as parsing cleanly", async () => {
    const lab = await opened(fileWith(urls(RESEARCH, NEWS)));
    lab.pages["/research"] = { body: html(1) };
    await lab.run();

    expect((await lab.activity()).fleet).toMatchObject({
      parsingCleanly: 0,
      notReached: 1,
    });
  });

  it("is waiting on a key, for Settings and coverage, when a page needs one and none is stored", async () => {
    const lab = await opened(fileWith(urls(NEWS, RESEARCH)), { key: false });
    lab.pages["/news"] = feed(1);
    lab.pages["/research"] = { body: html(2) };
    await lab.run();

    expect(await lab.health()).toMatchObject({
      voice: "not yet",
      kind: "credentials",
    });
    expect(await lab.waiting()).toEqual([
      expect.objectContaining({ id: "lab" }),
    ]);
  });

  it("starts only the page that was waiting when a key is stored, so its siblings are not read again unasked", async () => {
    const lab = await opened(fileWith(urls(NEWS, RESEARCH)), { key: false });
    lab.pages["/news"] = feed(1);
    lab.pages["/research"] = { body: html(2) };
    await lab.run();

    expect(
      (
        await lab.mutate("credentials.set", {
          provider: "anthropic",
          key: "sk-new",
        })
      ).error
    ).toBeUndefined();

    expect(
      lab
        .runs()
        .slice(2)
        .map((r) => [r.query, r.outcome])
    ).toEqual([[RESEARCH, "ok"]]);
    expect(lab.fetched["/news"]).toBe(1);
    expect(await lab.waiting()).toEqual([]);
  });

  it("reads a one-page Scout's health exactly as before", async () => {
    const lab = await opened(fileWith(`  url: ${RESEARCH}`));
    lab.pages["/research"] = { body: html(1) };
    await lab.run();
    lab.wait(WEEK);
    await lab.run();

    const row = await lab.row();
    expect(row.health).toMatchObject({
      voice: "claim",
      warrant: {
        fragments: ["newest run just now", "parsed cleanly", "no baseline yet"],
      },
    });
    expect(row.source).toEqual({
      kind: "watched",
      pages: [{ url: RESEARCH, health: row.health }],
    });
  });
});

// #913 (ADR 0056 decision 6): every surface that names a broken Scout names
// the broken page, and mending it touches only that page.
describe("rows about a broken page of a Scout of several pages", () => {
  const HTTP_404 =
    "The page answered with an error (HTTP 404) or was too large to read, so nothing was checked.";

  it("are one Loose Ends row per broken page, naming the Scout and the page in the page's own sentence", async () => {
    const lab = await opened(fileWith(urls(RESEARCH, NEWS, BLOG)));
    lab.pages["/research"] = { body: html(1) };
    // News and blog answer 404.
    await lab.run();

    expect(await lab.looseEnds()).toEqual([
      {
        kind: "failed-scout",
        subject: "lab",
        path: ".vitrine/scouts/lab.yaml",
        title: "Lab",
        page: NEWS,
        errorKind: "http",
        sentence: HTTP_404,
      },
      {
        kind: "failed-scout",
        subject: "lab",
        path: ".vitrine/scouts/lab.yaml",
        title: "Lab",
        page: BLOG,
        errorKind: "http",
        sentence: HTTP_404,
      },
    ]);
  });

  it("judge structure change detected per page, so only the page that once yielded items says it", async () => {
    const lab = await opened(fileWith(urls(RESEARCH, NEWS)));
    lab.pages["/research"] = { body: html(1) };
    lab.pages["/news"] = { body: html() };
    await lab.run();
    // The research page drops what it listed; the news page has never listed anything.
    lab.pages["/research"] = { body: html() };
    lab.wait(WEEK);
    await lab.run();

    const rows = await lab.looseEnds();
    expect(rows.map((r) => [r.kind, "page" in r ? r.page : null])).toEqual([
      ["structure-change", RESEARCH],
      ["failed-scout", NEWS],
    ]);
    expect(rows[0]).toMatchObject({ address: RESEARCH });
  });

  it("run now on a page's row reads that page only, as a check of one page", async () => {
    const lab = await opened(fileWith(urls(RESEARCH, NEWS)));
    lab.pages["/research"] = { body: html(1) };
    await lab.run();
    lab.pages["/news"] = feed(2);
    lab.wait(HOUR);

    const summary = await lab.runPage(NEWS);

    expect(summary).toMatchObject({ outcome: "ok", new: 1 });
    expect(lab.fetched["/research"]).toBe(1);
    const runs = lab.runs();
    expect(runs.map((r) => r.query)).toEqual([RESEARCH, NEWS, NEWS]);
    expect(runs[2]!.check_id).not.toBe(runs[0]!.check_id);
    expect(await lab.looseEnds()).toEqual([]);
  });

  it("refuses run now on a page the Scout no longer reads, reading nothing", async () => {
    const lab = await opened(fileWith(urls(RESEARCH, NEWS)));

    const refused = await lab.mutate("scouts.runNow", {
      scoutId: "lab",
      page: BLOG,
    });

    expect(refused.error?.message).toBe("Lab no longer reads that page.");
    expect(lab.runs()).toEqual([]);
  });

  it("offer the Scout's key once, however many of its pages wait on it", async () => {
    const lab = await opened(fileWith(urls(RESEARCH, NEWS)), { key: false });
    lab.pages["/research"] = { body: html(1) };
    lab.pages["/news"] = { body: html(2) };
    await lab.run();

    expect(await lab.looseEnds()).toEqual([
      expect.objectContaining({
        kind: "blocked-on-credentials",
        subject: "lab",
        voice: "not yet",
      }),
    ]);
  });

  it("read as before for a one-page Scout, naming no page", async () => {
    const lab = await opened(fileWith(`  url: ${RESEARCH}`));
    await lab.run();

    expect(await lab.looseEnds()).toEqual([
      expect.objectContaining({
        kind: "failed-scout",
        page: null,
        sentence: HTTP_404,
      }),
    ]);
  });
});
