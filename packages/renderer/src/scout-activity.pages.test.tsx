import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type {
  ActivityRow,
  Health,
  PageAcceptRate,
  ScoutActivity,
  ScoutCheckCost,
  ScoutRow,
} from "core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { empty, rateOver, renderApp, vault, weeksOf } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// #910 (spec #909, ADR 0056 decision 5): a Scout of several pages lists every
// page under *Watching*, in file order, each with its own Voice line beneath
// it, whether or not anything is wrong; the row header carries the Scout's
// Voice. The words are the core's, so what is asserted is what the renderer
// draws from what it is handed.

const RESEARCH = "https://lab.example/research";
const NEWS = "https://lab.example/news";
const BLOG = "https://lab.example/blog";

const QUIET: Health = {
  voice: "claim",
  warrant: {
    finished: "2026-10-05T12:00:00.000Z",
    fragments: [
      "newest run just now",
      "parsed cleanly",
      "usually ~2 a week (4 runs)",
    ],
  },
};
const FINDING: Health = { voice: "claim", warrant: null };
const BROKEN: Health = {
  voice: "wrong",
  kind: "http",
  sentence:
    "The page answered with an error (HTTP 404) or was too large to read, so nothing was checked.",
};

const row = (
  pages: Array<{ url: string; health: Health }>,
  health: Health
): ScoutRow => ({
  kind: "scout",
  id: "lab",
  name: "Lab",
  source: { kind: "watched", pages },
  cadence: "weekly",
  dueUnder: [],
  assigned: [],
  lane: "review",
  paused: false,
  lastWindow: null,
  lastRun: { finished: "2026-10-05T12:00:00.000Z", ago: "just now" },
  health,
  acceptRate: { kind: "nothing triaged" },
  review: {
    pending: 0,
    pastWindow: 0,
    deferred: 0,
    median: null,
    oldest: null,
  },
  volume: {
    proposals: 0,
    held: 0,
    alsoFoundElsewhere: 0,
    belowCap: 0,
    muted: 0,
  },
  cost: { kind: "no model call" },
  pageCosts: [],
});

const open = (rows: ActivityRow[], more: Record<string, unknown> = {}) => {
  const activity: ScoutActivity = {
    rows,
    fleet: {
      parsingCleanly: 0,
      notParsing: 0,
      notReached: 0,
      keyRejected: 0,
      noKey: 0,
    },
    review: {
      pending: 0,
      pastWindow: 0,
      deferred: 0,
      median: null,
      oldest: null,
    },
    coverageGaps: {
      kind: "covered",
      warrant: { questions: 0, scouts: 0 },
      notLooking: [],
    },
    dropped: [],
  };
  window.location.hash = "#/scout-management";
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": {
      indexing: null,
      watching: { ok: true },
      current: { ok: true },
    },
    "scouts.activity": activity,
    ...more,
  });
};

const watchingCell = async () => {
  const table = await screen.findByRole("table", { name: "Scouts" });
  const [first] = within(table).getAllByRole("row").slice(1);
  return within(first!).getAllByRole("cell")[0]!;
};

describe("a Scout of several pages on the Scouts screen", () => {
  it("lists every page in file order under Watching, each with its own Voice line beneath it, a quiet one among busy ones", async () => {
    open([
      row(
        [
          { url: RESEARCH, health: QUIET },
          { url: NEWS, health: FINDING },
          { url: BLOG, health: FINDING },
        ],
        FINDING
      ),
    ]);

    const pages = within(await watchingCell()).getByRole("list", {
      name: "Lab: pages",
    });
    const items = within(pages).getAllByRole("listitem");

    expect(items.map((item) => item.firstChild?.textContent)).toEqual([
      RESEARCH,
      NEWS,
      BLOG,
    ]);
    expect(items[0]!.textContent).toContain(
      "newest run just now · parsed cleanly · usually ~2 a week (4 runs)"
    );
  });

  it("draws a broken page's own sentence beneath it, and the Scout's Voice, naming the page, in the row header", async () => {
    const scout: Health = {
      ...BROKEN,
      sentence: `${NEWS}: ${BROKEN.sentence}`,
    };
    open([
      row(
        [
          { url: RESEARCH, health: FINDING },
          { url: NEWS, health: BROKEN },
        ],
        scout
      ),
    ]);

    const items = within(await watchingCell()).getAllByRole("listitem");
    expect(items[1]!.textContent).toBe(`${NEWS}⚠${BROKEN.sentence}`);
    expect(screen.getByRole("rowheader").textContent).toContain(scout.sentence);
  });

  it("draws a one-page Scout's Watching as its address alone, as before", async () => {
    open([row([{ url: RESEARCH, health: QUIET }], QUIET)]);

    const cell = await watchingCell();
    expect(within(cell).queryByRole("list")).toBeNull();
    expect(cell.textContent).toBe(RESEARCH);
  });
});

// #915 (ADR 0056 decision 9): cost per run is per check; *each run* lists
// checks with their pages beneath, and the opened row gives each page's mean.
describe("cost per run for a Scout of several pages", () => {
  const costed = (pageCosts: ScoutRow["pageCosts"]): ActivityRow => ({
    ...row(
      [
        { url: RESEARCH, health: FINDING },
        { url: NEWS, health: FINDING },
        { url: BLOG, health: FINDING },
      ],
      FINDING
    ),
    cost: { kind: "cost", perRun: 0.32, runs: 1, unpriced: 1 },
    pageCosts,
  });
  const PAGE_COSTS = [
    {
      page: RESEARCH,
      cost: { kind: "cost", perRun: 0.02, runs: 1, unpriced: 0 },
    },
    { page: NEWS, cost: { kind: "cost", perRun: 0.3, runs: 1, unpriced: 0 } },
    { page: BLOG, cost: { kind: "no model call" } },
  ] as const;

  const run = (
    runId: number,
    page: string | null,
    costUsd: number | null,
    model = "claude-sonnet-5-5"
  ) => ({
    runId,
    page,
    finished: "2026-10-04T12:00:00.000Z",
    ago: "1 day ago",
    model,
    tokens: { input: 1200, output: 300, cacheRead: 0 },
    costUsd,
  });
  const CHECKS: ScoutCheckCost[] = [
    {
      checkId: 7,
      finished: "2026-10-04T12:00:00.000Z",
      ago: "1 day ago",
      costUsd: 0.32,
      runs: [
        run(7, RESEARCH, 0.02),
        run(8, NEWS, 0.3),
        run(9, BLOG, null, "odd-model"),
      ],
    },
    {
      checkId: 3,
      finished: "2026-09-27T12:00:00.000Z",
      ago: "8 days ago",
      costUsd: 0.05,
      runs: [{ ...run(3, RESEARCH, 0.05), ago: "8 days ago" }],
    },
  ];

  it("lists each check under each run with its sum, and its pages' runs beneath it; a check of one run names its page on one line", async () => {
    open([costed([...PAGE_COSTS])], { "scouts.runCosts": CHECKS });

    fireEvent.click(
      await screen.findByRole("button", { name: "Lab: each run" })
    );
    const list = await screen.findByRole("list", { name: "Lab runs" });
    const checks = within(list)
      .getAllByRole("listitem")
      .filter((item) => item.parentElement === list);
    expect(checks).toHaveLength(2);

    const pages = within(checks[0]!).getByRole("list", {
      name: "Lab: the check 1 day ago, by page",
    });
    expect(checks[0]!.firstChild?.textContent).toBe("1 day ago");
    expect(checks[0]!.textContent).toContain("1 day ago · $0.32");
    expect(
      within(pages)
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    ).toEqual([
      `${RESEARCH} · claude-sonnet-5-5 · 1,200 in · 300 out · $0.02`,
      `${NEWS} · claude-sonnet-5-5 · 1,200 in · 300 out · $0.30`,
      `${BLOG} · odd-model · 1,200 in · 300 out · unpriced`,
    ]);
    // A check that called a model at one page only still says which page.
    expect(checks[1]!.textContent).toBe(
      `8 days ago · ${RESEARCH} · claude-sonnet-5-5 · 1,200 in · 300 out · $0.05`
    );
  });

  it("gives each page's mean in the opened row, in file order, as plain text", async () => {
    open([costed([...PAGE_COSTS])]);

    fireEvent.click(
      await screen.findByRole("button", { name: /^Lab: accept rate/ })
    );
    const list = await screen.findByRole("list", {
      name: "Lab: cost per run, by page",
    });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    ).toEqual([
      `${RESEARCH} · $0.02 · 1 run`,
      `${NEWS} · $0.30 · 1 run`,
      `${BLOG} · no model call`,
    ]);
  });

  it("draws no per-page list for a one-page Scout, whose figure is already its page's", async () => {
    open([
      {
        ...row([{ url: RESEARCH, health: FINDING }], FINDING),
        pageCosts: [{ page: RESEARCH, cost: { kind: "no model call" } }],
      },
    ]);

    fireEvent.click(
      await screen.findByRole("button", { name: /^Lab: accept rate/ })
    );
    await screen.findByRole("button", {
      name: /^Lab: accept rate/,
      expanded: true,
    });
    expect(
      screen.queryByRole("list", { name: "Lab: cost per run, by page" })
    ).toBeNull();
  });
});

// #914 (ADR 0056 decision 8): the opened row breaks the Scout's one Accept
// rate down by page, so removing a page can be decided on evidence. A plain
// list: no colour, mark or order of merit.
describe("the opened row of a Scout of several pages", () => {
  const judged = (
    acceptByPage: Array<{ url: string; rate: PageAcceptRate }> | undefined
  ): ScoutRow => ({
    ...row(
      [
        { url: RESEARCH, health: FINDING },
        { url: NEWS, health: FINDING },
        { url: BLOG, health: FINDING },
      ],
      FINDING
    ),
    acceptRate: rateOver(3, 4, weeksOf({ 11: { triaged: 4, rate: 0.75 } })),
    ...(acceptByPage === undefined ? {} : { acceptByPage }),
  });
  const openRow = async () =>
    fireEvent.click(
      await screen.findByRole("button", { name: /Lab: accept rate/ })
    );

  it("lists each page's rate in file order, in the words of the row's own column, a withheld one by its reason", async () => {
    open([
      judged([
        {
          url: RESEARCH,
          rate: { kind: "rate", accepted: 2, triaged: 3, rate: 2 / 3 },
        },
        {
          url: NEWS,
          rate: {
            kind: "unavailable",
            reason: "Most of this page's papers arrive without authors.",
          },
        },
        { url: BLOG, rate: { kind: "nothing triaged" } },
      ]),
    ]);
    await openRow();

    const list = screen.getByRole("list", { name: "Lab: accept rate by page" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    ).toEqual([
      `${RESEARCH} 67% · 3 triaged`,
      `${NEWS} Most of this page's papers arrive without authors.`,
      `${BLOG} nothing triaged yet`,
    ]);
  });

  it("marks no page out from another", async () => {
    open([
      judged([
        {
          url: RESEARCH,
          rate: { kind: "rate", accepted: 3, triaged: 3, rate: 1 },
        },
        {
          url: NEWS,
          rate: { kind: "rate", accepted: 0, triaged: 5, rate: 0 },
        },
      ]),
    ]);
    await openRow();

    const items = within(
      screen.getByRole("list", { name: "Lab: accept rate by page" })
    ).getAllByRole("listitem");
    expect(items.map((item) => item.className)).toEqual([
      items[0]!.className,
      items[0]!.className,
    ]);
    for (const item of items) {
      expect(item.getAttribute("style")).toBeNull();
      expect(item.querySelector("svg, img, [role=img]")).toBeNull();
    }
  });

  it("lists nothing while nothing is triaged, which every page would only repeat", async () => {
    open([
      {
        ...judged([
          { url: RESEARCH, rate: { kind: "nothing triaged" } },
          { url: NEWS, rate: { kind: "nothing triaged" } },
        ]),
        acceptRate: { kind: "nothing triaged" },
      },
    ]);
    await openRow();

    expect(screen.getByText("Nothing triaged yet.")).toBeDefined();
    expect(
      screen.queryByRole("list", { name: "Lab: accept rate by page" })
    ).toBeNull();
  });

  it("lists nothing for a one-page Scout, whose headline is its page's", async () => {
    open([judged(undefined)]);
    await openRow();

    expect(screen.getByText("75% over 12 weeks · 4 triaged")).toBeDefined();
    expect(
      screen.queryByRole("list", { name: "Lab: accept rate by page" })
    ).toBeNull();
  });
});
