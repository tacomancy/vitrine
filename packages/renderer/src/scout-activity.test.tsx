import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type {
  Cost,
  CoverageGap,
  CoverageGaps,
  ScoutActivity,
  ActivityRow,
  ScoutRunCost,
} from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  empty,
  rateOver,
  renderApp,
  scrollsInto,
  vault,
  weeksOf,
} from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// Scout Activity's tracer (#513; spec #511; ADR 0042; ADR 0032): a Dashboard
// at its own Address that draws what `scouts.activity` says. A Scout's Voice,
// Warrant and fault sentence are the core's to word, so with the core faked
// what is asserted is what the renderer draws from what the core says.

const READ = { indexing: null, watching: { ok: true }, current: { ok: true } };
const NO_FLEET = {
  parsingCleanly: 0,
  notParsing: 0,
  notReached: 0,
  keyRejected: 0,
  noKey: 0,
};
const NO_REVIEW = { pending: 0, deferred: 0, median: null, oldest: null };
const COVERED: ScoutActivity["coverageGaps"] = {
  kind: "covered",
  warrant: { questions: 0, scouts: 0 },
  notLooking: [],
};
const NONE: ScoutActivity = {
  rows: [],
  fleet: NO_FLEET,
  review: NO_REVIEW,
  coverageGaps: COVERED,
};
/** The core's read of these rows: the rows as handed over, and the fleet's counts. */
const fleet = (
  rows: ActivityRow[],
  counts: Partial<typeof NO_FLEET> = {},
  review: ScoutActivity["review"] = NO_REVIEW,
  coverage: ScoutActivity["coverageGaps"] = COVERED
): ScoutActivity => ({
  rows,
  fleet: { ...NO_FLEET, ...counts },
  review,
  coverageGaps: coverage,
});

const answers = (
  activity: unknown,
  more: Record<string, unknown> = {}
): Record<string, unknown> => ({
  "vault.current": vault,
  "questions.list": empty,
  "vault.status": READ,
  "scouts.activity": activity,
  ...more,
});

const open = (activity: unknown, more: Record<string, unknown> = {}) => {
  window.location.hash = "#/scout-activity";
  return renderApp(answers(activity, more));
};

const page = () => screen.findByRole("region", { name: "Scout Activity" });

// Three Scouts of three different health and a file that will not parse, as
// the core hands them over: the words in `health` are the core's, copied from
// what the Queue's rail says for the same Scouts.
const BROKEN: ActivityRow = {
  kind: "scout",
  id: "broken",
  name: "Broken by arXiv",
  source: { kind: "arxiv", query: "all:broken" },
  cadence: "daily",
  dueUnder: [],
  assigned: [],
  lane: "review",
  paused: false,
  lastRun: { finished: "2026-09-30T09:00:00.000Z", ago: "3h ago" },
  health: {
    voice: "wrong",
    kind: "http",
    sentence:
      "arXiv answered with an error (HTTP 503), so nothing was checked.",
  },
  acceptRate: rateOver(3, 4),
  review: {
    pending: 3,
    deferred: 1,
    median: { at: "2026-09-27T12:00:00.000Z", ago: "3 days ago" },
    oldest: { at: "2026-09-25T12:00:00.000Z", ago: "5 days ago" },
  },
  volume: { proposals: 12, held: 0, alsoFoundElsewhere: 0 },
  cost: { kind: "no model call" },
};
const QUIET: ActivityRow = {
  kind: "scout",
  id: "quiet",
  name: "Quiet by design",
  source: { kind: "arxiv", query: "all:quiet" },
  cadence: "weekly",
  dueUnder: [],
  assigned: [],
  lane: "review",
  paused: false,
  lastRun: { finished: "2026-09-30T10:00:00.000Z", ago: "2h ago" },
  health: {
    voice: "claim",
    warrant: {
      finished: "2026-09-30T10:00:00.000Z",
      fragments: [
        "newest run 2h ago",
        "parsed cleanly",
        "usually ~4 a week (6 runs)",
      ],
    },
  },
  acceptRate: { kind: "nothing triaged" },
  review: NO_REVIEW,
  volume: { proposals: 0, held: 0, alsoFoundElsewhere: 0 },
  cost: { kind: "no model call" },
};
const RESTING: ActivityRow = {
  kind: "scout",
  id: "resting",
  name: "Resting",
  source: { kind: "watched", url: "https://lab.example/publications" },
  cadence: "monthly",
  dueUnder: [],
  assigned: [],
  lane: "skim",
  paused: true,
  lastRun: null,
  health: { voice: "not yet", sentence: "Paused — it is not looking." },
  acceptRate: {
    kind: "unavailable",
    reason: "Most of this Scout's papers arrive without authors or venue.",
  },
  review: { ...NO_REVIEW, deferred: 2 },
  volume: { proposals: 5, held: 2, alsoFoundElsewhere: 1 },
  cost: { kind: "cost", perRun: 0.0312, runs: 3, unpriced: 0 },
};
const TORN: ActivityRow = {
  kind: "unreadable",
  file: "torn.yaml",
  health: {
    voice: "wrong",
    kind: null,
    sentence: "This file could not be read: line 2 is not valid YAML.",
  },
};

/** A cell's words: a figure of several parts is read as its parts, one to a line. */
const cellWords = (cell: HTMLElement) => {
  const parts = within(cell).queryAllByRole("listitem");
  return parts.length === 0
    ? cell.textContent
    : parts.map((p) => p.textContent);
};

/** The Scouts' rows, header row left out. */
const tableRows = async () =>
  within(await screen.findByRole("table", { name: "Scouts" }))
    .getAllByRole("row")
    .slice(1);

/** A row's In Review cell, the last: the stack's parts, one to a line, and below them the link that opens that stack in the Queue. */
const reviewCell = (row: HTMLElement) => within(row).getAllByRole("cell")[6]!;
const reviewParts = (row: HTMLElement) =>
  within(reviewCell(row))
    .queryAllByRole("listitem")
    .map((part) => part.textContent);

const HEADER_NOTE = "Skim is a feed and has no depth";

describe("Scout Activity — Review depth and age", () => {
  it("states a Scout's stack in neutral facts, the ages beside the pending figure and what is deferred apart after them", async () => {
    open(fleet([BROKEN]));

    const [row] = await tableRows();

    expect(reviewParts(row!)).toEqual([
      "3 pending",
      "median 3 days ago",
      "oldest 5 days ago",
      "1 deferred",
    ]);
  });

  it("lets a Scout whose last run was clean claim nothing pending in the Queue's own words, never as 0", async () => {
    open(fleet([QUIET]));

    const [row] = await tableRows();

    expect(reviewParts(row!)).toEqual(["Nothing pending."]);
  });

  it("says nothing of the stack for a Scout that has not looked or whose check failed, leaving the Voice beside its name to speak", async () => {
    open(
      fleet([
        { ...BROKEN, review: NO_REVIEW },
        { ...RESTING, review: NO_REVIEW },
      ])
    );

    const rows = await tableRows();

    // An empty cell, not a 0 and not *nothing pending*: that would pass a
    // broken Scout for a quiet field.
    expect(rows.map(reviewParts)).toEqual([[], []]);
    expect(rows[0]!.textContent).toContain("HTTP 503");
    expect(rows[1]!.textContent).toContain("Paused");
  });

  it("still counts what is deferred when nothing is pending, whatever the Voice", async () => {
    open(fleet([RESTING, { ...QUIET, review: { ...NO_REVIEW, deferred: 4 } }]));

    const rows = await tableRows();

    expect(rows.map(reviewParts)).toEqual([
      ["2 deferred"],
      ["Nothing pending.", "4 deferred"],
    ]);
  });

  it("keeps the link to a Scout's stack in the same cell, below the figures, and on a Scout with none", async () => {
    open(fleet([BROKEN, { ...RESTING, review: NO_REVIEW }]));

    const [broken, resting] = await tableRows();

    for (const [row, name] of [
      [broken!, "Broken by arXiv"],
      [resting!, "Resting"],
    ] as const) {
      expect(
        within(reviewCell(row)).getByRole("link", {
          name: `${name}: open its stack in the Queue`,
        }).textContent
      ).toBe("queue");
    }
  });

  it("heads the fleet with the same facts, deferred apart, and names Skim a feed with no depth", async () => {
    open(
      fleet(
        [BROKEN],
        {},
        {
          pending: 3,
          deferred: 1,
          median: { at: "2026-09-27T12:00:00.000Z", ago: "3 days ago" },
          oldest: { at: "2026-09-25T12:00:00.000Z", ago: "5 days ago" },
        }
      )
    );

    expect((await screen.findByLabelText("Review depth")).textContent).toBe(
      `Review: 3 pending · median 3 days ago · oldest 5 days ago · 1 deferred · ${HEADER_NOTE}`
    );
  });

  it("heads a fleet with nothing pending in words, not as a 0 and not as a claim, and still counts what is deferred", async () => {
    open(fleet([QUIET], {}, { ...NO_REVIEW, deferred: 2 }));

    expect((await screen.findByLabelText("Review depth")).textContent).toBe(
      `Review: none pending · 2 deferred · ${HEADER_NOTE}`
    );
  });

  it("draws no Review line for a vault with no Scouts, where there is no stack to describe", async () => {
    open(NONE);

    // Only once the read has answered is the absence a fact about the page.
    await screen.findByText("no scouts yet");

    expect(screen.queryByLabelText("Review depth")).toBeNull();
  });
});

describe("Scout Activity", () => {
  it("opens at its Address, with the Sidebar entry among the Dashboards lit", async () => {
    open(NONE);

    const view = await page();

    expect(view.querySelector("h1")?.textContent).toBe("Scout Activity");
    expect(screen.getByRole("link", { current: "page" }).textContent).toBe(
      "Scout Activity"
    );
  });

  it("is reached from the Sidebar", async () => {
    window.location.hash = "#/inbox";
    renderApp(answers(NONE));
    await screen.findByRole("region", { name: "Question Inbox" });

    fireEvent.click(screen.getByRole("link", { name: "Scout Activity" }));

    expect(await page()).toBeDefined();
    expect(window.location.hash).toBe("#/scout-activity");
  });
});

describe("the table", () => {
  it("draws a row for each Scout: its name, what it watches, how often it looks, and when it last ran", async () => {
    open(fleet([BROKEN, QUIET, RESTING]));

    const rows = await tableRows();

    expect(rows).toHaveLength(3);
    expect(
      rows.map((row) => [
        within(row).getByRole("rowheader").textContent,
        ...within(row).getAllByRole("cell").map(cellWords),
      ])
    ).toEqual([
      [
        expect.stringContaining("Broken by arXiv"),
        "arXiv · all:broken",
        "daily",
        "3h ago",
        "75% · 4 triaged",
        ["12 / 30d"],
        ["no model call"],
        ["3 pending", "median 3 days ago", "oldest 5 days ago", "1 deferred"],
      ],
      [
        expect.stringContaining("Quiet by design"),
        "arXiv · all:quiet",
        "weekly",
        "2h ago",
        "nothing triaged yet",
        ["0 / 30d"],
        ["no model call"],
        ["Nothing pending."],
      ],
      // A Scout that has never run says so, and a page is named by its address.
      [
        expect.stringContaining("Resting"),
        "https://lab.example/publications",
        "monthly",
        "not yet",
        "Most of this Scout's papers arrive without authors or venue.",
        ["5 / 30d", "2 already in your vault", "1 also found elsewhere"],
        ["$0.03", "3 runs"],
        ["2 deferred"],
      ],
    ]);
  });
});

describe("a row's cost", () => {
  const costed = (cost: Cost) => ({ ...QUIET, cost });
  const costCell = async () => {
    const [row] = await tableRows();
    return cellWords(within(row!).getAllByRole("cell")[5]!);
  };

  it("says unpriced, never a figure, for a model that has no price, and how many runs that is", async () => {
    open(fleet([costed({ kind: "unpriced", runs: 2 })]));

    expect(await costCell()).toEqual(["unpriced", "2 runs"]);
  });

  it("names the runs a mean rests on and how many were left out as unpriced", async () => {
    open(fleet([costed({ kind: "cost", perRun: 0.5, runs: 2, unpriced: 1 })]));

    expect(await costCell()).toEqual(["$0.50", "2 runs", "1 unpriced"]);
  });

  it("says a mean of one run in the singular, and a sum under a cent to the figure that shows it", async () => {
    open(
      fleet([costed({ kind: "cost", perRun: 0.0054, runs: 1, unpriced: 0 })])
    );

    expect(await costCell()).toEqual(["$0.0054", "1 run"]);
  });
});

describe("the runs behind a row", () => {
  const RUNS: ScoutRunCost[] = [
    {
      runId: 9,
      finished: "2026-09-29T09:00:00.000Z",
      ago: "1 day ago",
      model: "claude-sonnet-5-5",
      tokens: { input: 1200, output: 300, cacheRead: 0 },
      costUsd: 0.0054,
    },
    {
      runId: 8,
      finished: "2026-09-28T09:00:00.000Z",
      ago: "2 days ago",
      model: "odd-model",
      tokens: { input: 50, output: 5, cacheRead: 40 },
      costUsd: null,
    },
  ];
  // A Scout whose cost has runs behind it: one that made no model call has
  // none to list.
  const COSTLY: ActivityRow = {
    ...QUIET,
    cost: { kind: "cost", perRun: 0.0057, runs: 2, unpriced: 0 },
  };
  const opener = () =>
    screen.findByRole("button", { name: "Quiet by design: each run" });

  it("opens from the row, listing each run's model, tokens and cost as the core ordered them, and says unpriced where there is no price", async () => {
    const asked = vi.fn((input: unknown) => {
      void input;
      return RUNS;
    });
    open(fleet([COSTLY]), { "scouts.runCosts": asked });

    // Behind the row: nothing is read, and nothing drawn, until it is opened.
    const button = await opener();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(asked).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("list", { name: "Quiet by design runs" })
    ).toBeNull();

    fireEvent.click(button);

    const list = await screen.findByRole("list", {
      name: "Quiet by design runs",
    });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    ).toEqual([
      "1 day ago · claude-sonnet-5-5 · 1,200 in · 300 out · $0.0054",
      "2 days ago · odd-model · 50 in · 5 out · 40 cached · unpriced",
    ]);
    expect(asked).toHaveBeenCalledWith({ scoutId: "quiet" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("is not offered for a Scout that made no model call: the figure already says so", async () => {
    open(fleet([QUIET]));
    await tableRows();

    expect(screen.queryByRole("button", { name: /each run/ })).toBeNull();
  });

  it("closes again from the same control", async () => {
    open(fleet([COSTLY]), { "scouts.runCosts": RUNS });

    fireEvent.click(await opener());
    await screen.findByRole("list", { name: "Quiet by design runs" });
    fireEvent.click(await opener());

    expect(
      screen.queryByRole("list", { name: "Quiet by design runs" })
    ).toBeNull();
  });

  it("says so, plainly, when no run in the thirty days called a model", async () => {
    open(fleet([COSTLY]), { "scouts.runCosts": [] });

    fireEvent.click(await opener());

    expect(
      await screen.findByText("No run in the last thirty days called a model.")
    ).toBeDefined();
  });

  it("says why on a polite line when the runs cannot be read, and not that there were none", async () => {
    open(fleet([COSTLY]), {
      "scouts.runCosts": () => {
        throw new Error("No vault is open.");
      },
    });

    fireEvent.click(await opener());

    expect(await screen.findByText(/No vault is open\./)).toBeDefined();
    expect(
      screen.queryByText("No run in the last thirty days called a model.")
    ).toBeNull();
  });
});

describe("a long Query", () => {
  it("is cut by the column, not by the app: the whole of it stays on the cell", async () => {
    const query =
      `(cat:q-bio.NC OR cat:cs.LG) AND ${"all:sleep ".repeat(20)}`.trim();
    open({
      ...fleet([{ ...QUIET, source: { kind: "arxiv", query } }]),
    });

    const [row] = await tableRows();
    const watching = within(row!).getAllByRole("cell")[0]!;

    expect(watching.getAttribute("title")).toBe(`arXiv · ${query}`);
    expect(watching.textContent).toBe(`arXiv · ${query}`);
  });
});

describe("each Scout's Voice", () => {
  /** Each Voice drawn under a node: which Voice it is, and every word of it. */
  const voicesIn = (node: HTMLElement) =>
    [...node.querySelectorAll("[data-voice]")].map((voice) => [
      voice.getAttribute("data-voice"),
      voice.textContent,
    ]);

  it("says each Scout's Voice and Warrant in the words the Queue's rail speaks for the same health, and a file that will not parse in the wrong Voice", async () => {
    open(fleet([BROKEN, QUIET, RESTING, TORN]));
    const table = await screen.findByRole("table", { name: "Scouts" });

    // The rail draws these same words from the same `Health` through the same
    // component (`scout-form.test.tsx` pins them there), and the core hands
    // both surfaces one derivation (`scout-activity.test.ts` pins that), so
    // the literals are the whole contract: a failure with its one sentence, a
    // quiet field as a claim with its Warrant, a Scout that is not looking
    // saying so, and the torn file by its name in the wrong Voice.
    expect(voicesIn(table)).toEqual([
      [
        "wrong",
        "⚠arXiv answered with an error (HTTP 503), so nothing was checked.",
      ],
      [
        "claim",
        "newest run 2h ago · parsed cleanly · usually ~4 a week (6 runs)",
      ],
      ["not yet", "Paused — it is not looking."],
      ["wrong", "⚠This file could not be read: line 2 is not valid YAML."],
    ]);
  });
});

describe("a check finishing", () => {
  it("reads the fleet again, so a Scout that has just broken does not go on reading as well", async () => {
    let rows: ActivityRow[] = [QUIET];
    const { stream } = open(() => fleet(rows));
    const [before] = await tableRows();
    expect(before!.textContent).toContain("parsed cleanly");

    rows = [{ ...QUIET, health: BROKEN.health }];
    stream.push({ type: "scoutFinished", scoutId: "quiet", runId: 4 });

    await vi.waitFor(async () => {
      const [after] = await tableRows();
      expect(after!.textContent).toContain(
        "arXiv answered with an error (HTTP 503)"
      );
    });
  });
});

describe("a vault with no Scouts", () => {
  it("says not yet in the first slot and offers to make one, drawing no table", async () => {
    open(NONE);
    const view = await page();

    const slot = (await within(view).findByText("no scouts yet")).closest("p")!;

    // A fragment, not a claim: no full stop, and no Warrant, since nothing is
    // asserted about the world (ADR 0032 decisions 1 and 2).
    expect(slot.textContent).toBe("◐no scouts yetnew scout");
    expect(view.textContent).not.toContain("read in full");
    expect(
      within(slot).getByRole("button", { name: "new scout" })
    ).toBeDefined();
    expect(within(view).queryByRole("table")).toBeNull();
  });

  it("opens the Queue's new-Scout form when asked for one", async () => {
    open(NONE, {
      "scouts.list": { scouts: [], unreadable: [] },
      "scouts.queue": [],
      "scouts.groups": [],
      "scouts.fleet": { claim: null, naming: [] },
      "scouts.health": { scouts: [], unreadable: [] },
    });

    fireEvent.click(await screen.findByRole("button", { name: "new scout" }));

    const form = await screen.findByRole("form", { name: "New Scout" });
    expect(window.location.hash).toBe("#/scouts");
    // Nothing is Assigned: only *brief a scout* starts a Scout on a Question,
    // and the click that opened this one is not an id.
    expect(
      within(form)
        .queryAllByRole("checkbox")
        .filter((box) => (box as HTMLInputElement).checked)
    ).toEqual([]);
  });

  it("is not drawn for a fleet that holds only a file that will not parse: that file is a row", async () => {
    open(fleet([TORN]));

    const [row] = await tableRows();

    expect(within(row!).getByRole("rowheader").textContent).toContain(
      "torn.yaml"
    );
    expect(
      within(row!).getByRole("img", { name: "not working" })
    ).toBeDefined();
    expect(screen.queryByText("no scouts yet")).toBeNull();
    expect(screen.queryByRole("button", { name: "new scout" })).toBeNull();
  });

  it("spans every column after its name, so a column added to the table never leaves that row ragged", async () => {
    open(fleet([TORN, QUIET]));

    const rows = await tableRows();
    const columns = within(
      screen.getByRole("table", { name: "Scouts" })
    ).getAllByRole("columnheader").length;

    const [torn, readable] = rows;
    const spanned = (row: HTMLElement) =>
      within(row)
        .getAllByRole("cell")
        .reduce((sum, cell) => sum + (cell as HTMLTableCellElement).colSpan, 1);
    expect(spanned(torn!)).toBe(columns);
    expect(spanned(readable!)).toBe(columns);
  });
});

describe("a read that has not answered, or has failed", () => {
  it("says not read yet while the answer is on its way, and nothing about an empty fleet", async () => {
    open(new Promise(() => undefined));
    const view = await page();

    expect(await within(view).findByText("not read yet")).toBeDefined();
    expect(view.textContent).not.toContain("no scouts yet");
    expect(
      within(view).queryByRole("button", { name: "new scout" })
    ).toBeNull();
  });

  it("says not known, with the reason on a polite footer line, and never reads as an empty fleet", async () => {
    open(() => {
      throw new Error("No vault is open.");
    });
    const view = await page();

    expect(await within(view).findByText("not known")).toBeDefined();
    // A state the app is in, stated quietly: a status line, never an alert
    // (ADR 0033 decisions 1 and 2).
    const footer = within(view).getByRole("contentinfo");
    expect(within(footer).getByRole("status").textContent).toBe(
      "‖ not read — No vault is open."
    );
    expect(screen.queryByRole("alert")).toBeNull();
    // A failed read is not an empty fleet: nothing here says there are no
    // Scouts, and nothing offers to make the first one.
    expect(view.textContent).not.toContain("no scouts yet");
    expect(
      within(view).queryByRole("button", { name: "new scout" })
    ).toBeNull();
    expect(within(view).queryByRole("table")).toBeNull();
  });
});

const names = async () =>
  (await tableRows()).map(
    (row) =>
      within(row).getByRole("rowheader").querySelector("span > span")!
        .textContent
  );

describe("the order of the table", () => {
  it("draws the rows in the order the core hands over, which is by need", async () => {
    open(fleet([BROKEN, RESTING, QUIET]));

    expect(await names()).toEqual([
      "Broken by arXiv",
      "Resting",
      "Quiet by design",
    ]);
  });

  it("sorts by a column when its header is clicked, and reverses it when it is clicked again", async () => {
    open(fleet([BROKEN, RESTING, QUIET]));
    await tableRows();

    fireEvent.click(screen.getByRole("button", { name: "Scout" }));
    expect(await names()).toEqual([
      "Broken by arXiv",
      "Quiet by design",
      "Resting",
    ]);
    expect(
      screen
        .getByRole("columnheader", { name: "Scout" })
        .getAttribute("aria-sort")
    ).toBe("ascending");

    fireEvent.click(screen.getByRole("button", { name: "Scout" }));
    expect(await names()).toEqual([
      "Resting",
      "Quiet by design",
      "Broken by arXiv",
    ]);
    expect(
      screen
        .getByRole("columnheader", { name: "Scout" })
        .getAttribute("aria-sort")
    ).toBe("descending");
  });

  it("sorts cadence by how often it looks, not alphabetically, and last run by when", async () => {
    open(fleet([RESTING, QUIET, BROKEN]));
    await tableRows();

    fireEvent.click(screen.getByRole("button", { name: "Cadence" }));
    expect(await names()).toEqual([
      "Broken by arXiv",
      "Quiet by design",
      "Resting",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Last run" }));
    // Oldest first; a Scout that never ran is not a time, so it is last.
    expect(await names()).toEqual([
      "Broken by arXiv",
      "Quiet by design",
      "Resting",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Last run" }));
    expect(await names()).toEqual([
      "Quiet by design",
      "Broken by arXiv",
      "Resting",
    ]);
  });

  it("sorts by what a Scout proposed, and by what a run costs, with the Scouts that have no cost figure last either way", async () => {
    const costly: ActivityRow = {
      ...BROKEN,
      id: "costly",
      name: "Costly",
      cost: { kind: "cost", perRun: 0.5, runs: 2, unpriced: 0 },
    };
    open(fleet([BROKEN, QUIET, RESTING, costly]));
    await tableRows();

    fireEvent.click(screen.getByRole("button", { name: "Proposed" }));
    expect(await names()).toEqual([
      "Quiet by design",
      "Resting",
      "Broken by arXiv",
      "Costly",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Cost / run" }));
    expect(await names()).toEqual([
      "Resting",
      "Costly",
      "Broken by arXiv",
      "Quiet by design",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Cost / run" }));
    expect(await names()).toEqual([
      "Costly",
      "Resting",
      "Broken by arXiv",
      "Quiet by design",
    ]);
  });

  it("keeps a file that will not parse in the table whichever column is sorted", async () => {
    open(fleet([TORN, QUIET]));
    await tableRows();

    fireEvent.click(screen.getByRole("button", { name: "Cadence" }));

    expect(await tableRows()).toHaveLength(2);
  });
});

describe("the fleet's source health", () => {
  const summary = () => screen.queryByLabelText("Source health");

  it("counts faults only, in the core's counts, and says nothing of a count that is none", async () => {
    open(
      fleet([BROKEN, QUIET, RESTING], {
        parsingCleanly: 10,
        notParsing: 1,
        notReached: 2,
        keyRejected: 1,
        noKey: 1,
      })
    );
    await tableRows();

    expect(summary()!.textContent).toBe(
      "10 parsing cleanly · 1 not parsing · 2 not reached · 1 key rejected · 1 no key"
    );
  });

  it("reads a fleet of ten quiet Scouts as 10 parsing cleanly, and never counts them as quiet", async () => {
    open(fleet([QUIET], { parsingCleanly: 10 }));
    await tableRows();

    expect(summary()!.textContent).toBe("10 parsing cleanly");
    expect(
      screen.queryByText(/quiet/i, {
        selector: "[aria-label='Source health'] *",
      })
    ).toBeNull();
  });

  it("is not drawn when there is nothing to count", async () => {
    open(fleet([RESTING]));
    await tableRows();

    expect(summary()).toBeNull();
  });
});

describe("the keyboard", () => {
  const list = () => screen.getByRole("group", { name: "Scout rows" });
  const active = () => {
    const id = list().getAttribute("aria-activedescendant");
    return id === null ? null : document.getElementById(id);
  };

  it("moves a choice with j and k, published as the list's active descendant, and stops at the ends", async () => {
    open(fleet([BROKEN, RESTING, QUIET]));
    const rows = await tableRows();
    expect(active()).toBeNull();

    fireEvent.keyDown(list(), { key: "j" });
    expect(active()).toBe(rows[0]);
    fireEvent.keyDown(list(), { key: "j" });
    expect(active()).toBe(rows[1]);
    fireEvent.keyDown(list(), { key: "j" });
    fireEvent.keyDown(list(), { key: "j" });
    expect(active()).toBe(rows[2]);
    fireEvent.keyDown(list(), { key: "k" });
    expect(active()).toBe(rows[1]);
    fireEvent.keyDown(list(), { key: "k" });
    fireEvent.keyDown(list(), { key: "k" });
    expect(active()).toBe(rows[0]);
  });

  it("scrolls the chosen row into view the least it can", async () => {
    open(fleet([BROKEN, RESTING, QUIET]));
    const rows = await tableRows();
    const scrolled = scrollsInto();

    fireEvent.keyDown(list(), { key: "j" });
    fireEvent.keyDown(list(), { key: "j" });

    expect(scrolled.at(-1)).toEqual({ row: rows[1], block: "nearest" });
  });

  it("follows the same row when the table is re-sorted", async () => {
    open(fleet([BROKEN, RESTING, QUIET]));
    await tableRows();
    fireEvent.keyDown(list(), { key: "j" });
    expect(active()!.textContent).toContain("Broken by arXiv");

    fireEvent.click(screen.getByRole("button", { name: "Scout" }));
    fireEvent.click(screen.getByRole("button", { name: "Scout" }));

    expect(active()!.textContent).toContain("Broken by arXiv");
  });
});

describe("a row's link", () => {
  it("opens the Queue on that Scout's stack", async () => {
    open(fleet([QUIET]), {
      "scouts.list": {
        scouts: [
          { id: "quiet", name: "Quiet by design", assigned: [], paused: false },
        ],
        unreadable: [],
      },
      "scouts.queue": [],
      "scouts.groups": [{ id: "quiet", runId: null, runPending: 0, held: [] }],
      "scouts.fleet": { claim: null, naming: [] },
      "scouts.health": { scouts: [], unreadable: [] },
    });
    const [row] = await tableRows();

    fireEvent.click(
      within(row!).getByRole("link", { name: /Quiet by design.*Queue/ })
    );

    expect(window.location.hash).toBe("#/scouts?scout=quiet");
    const rail = await screen.findByRole("list", { name: "Scouts" });
    expect(
      (
        await within(rail).findByRole("button", { name: /Quiet by design/ })
      ).getAttribute("aria-current")
    ).toBe("true");
  });

  it("is not drawn for a file that will not parse, which has no stack", async () => {
    open(fleet([TORN]));
    const [row] = await tableRows();

    expect(within(row!).queryByRole("link")).toBeNull();
  });

  it("paints no row for how it is doing: a failing Scout's row carries the same class as a quiet one's", async () => {
    open(fleet([BROKEN, QUIET]));
    const rows = await tableRows();

    expect(rows[0]!.className).toBe(rows[1]!.className);
    expect(rows[0]!.getAttribute("style")).toBeNull();
  });
});

describe("opening a row", () => {
  const TWELVE_WEEKS: ActivityRow = {
    ...BROKEN,
    acceptRate: rateOver(
      30,
      48,
      weeksOf({
        9: { triaged: 4, rate: null },
        10: { triaged: 5, rate: 0.8 },
        11: { triaged: 7, rate: 0.5 },
      })
    ),
  };
  const line = () =>
    screen.queryByRole("group", { name: "Accept rate by week" });
  const opener = (name: string) =>
    screen.findByRole("button", {
      name: new RegExp(`${name}.*accept rate`, "i"),
    });

  it("draws no row pre-expanded", async () => {
    open(fleet([TWELVE_WEEKS]));
    await screen.findByRole("table", { name: "Scouts" });

    expect(line()).toBeNull();
  });

  it("draws the Scout's weekly line with its headline when its row is clicked, and closes again", async () => {
    open(fleet([TWELVE_WEEKS]));

    const [row] = await tableRows();
    fireEvent.click(within(row!).getByText("Broken by arXiv"));

    expect(
      within(line()!)
        .getAllByRole("img")
        .map((p) => p.getAttribute("aria-label"))
    ).toEqual([
      "week of 1 Jul: 80% of 5 triaged",
      "week of 8 Jul: 50% of 7 triaged",
    ]);
    expect(screen.getByText("63% over 12 weeks · 48 triaged")).toBeDefined();

    fireEvent.click(within(row!).getByText("Broken by arXiv"));
    expect(line()).toBeNull();
  });

  it("opens from the accept rate's own button too, which says whether the row is open", async () => {
    open(fleet([TWELVE_WEEKS]));

    const button = await opener("Broken by arXiv");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);

    // One click is one toggle: the click reaches the row as well as the button.
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(line()).not.toBeNull();
  });

  it("says why there is no line for a young Scout", async () => {
    open(
      fleet([
        {
          ...TWELVE_WEEKS,
          acceptRate: rateOver(
            2,
            3,
            weeksOf({ 11: { triaged: 3, rate: null } })
          ),
        },
      ])
    );

    fireEvent.click(await opener("Broken by arXiv"));

    expect(
      screen.getByText(
        "No week has 5 or more triaged items yet, so there is no line."
      )
    ).toBeDefined();
  });

  it("says why for a Scout whose rate cannot be said, and for one nobody has judged", async () => {
    open(fleet([QUIET, RESTING]));

    fireEvent.click(await opener("Quiet by design"));
    fireEvent.click(await opener("Resting"));

    expect(screen.getByText("Nothing triaged yet.")).toBeDefined();
    expect(
      screen.getAllByText(
        "Most of this Scout's papers arrive without authors or venue."
      )
    ).toHaveLength(2);
  });

  it("opens the chosen row with Enter", async () => {
    open(fleet([TWELVE_WEEKS]));
    const group = await screen.findByRole("group", { name: "Scout rows" });
    group.focus();
    fireEvent.keyDown(group, { key: "j" });

    fireEvent.keyDown(group, { key: "Enter" });

    expect(line()).not.toBeNull();
  });

  it("keeps a row open when the table is re-sorted", async () => {
    open(fleet([TWELVE_WEEKS, QUIET]));
    fireEvent.click(await opener("Broken by arXiv"));

    fireEvent.click(screen.getByRole("button", { name: "Scout" }));
    fireEvent.click(screen.getByRole("button", { name: "Scout" }));

    expect(line()).not.toBeNull();
  });

  it("offers nothing to open on a file that will not parse", async () => {
    open(fleet([TORN]));
    await screen.findByRole("table", { name: "Scouts" });

    const [row] = await tableRows();
    fireEvent.click(within(row!).getByText("torn.yaml"));

    expect(screen.queryByRole("button", { name: /accept rate/i })).toBeNull();
    expect(line()).toBeNull();
  });
});

describe("coverage gaps", () => {
  const gap = (
    question: string,
    more: Partial<CoverageGap> = {}
  ): CoverageGap => ({
    path: `q/${question}.md`,
    question,
    assign: `id-${question}`,
    age: "12 days ago",
    notLooking: [],
    ...more,
  });
  const gaps = (shown: CoverageGap[], notShown = 0): CoverageGaps => ({
    kind: "gaps",
    shown,
    notShown,
  });
  const block = () => screen.findByRole("region", { name: "Coverage gaps" });
  const withGaps = (coverage: CoverageGaps, more = {}) =>
    open(fleet([QUIET], {}, NO_REVIEW, coverage), more);

  it("lists each open Question nothing is looking for, with its age and the Scouts that are Assigned but not looking", async () => {
    withGaps(
      gaps([
        gap("Nobody has this one?"),
        gap("A paused Scout has this one?", {
          notLooking: [{ id: "r", name: "Resting", reason: "paused" }],
        }),
      ])
    );

    const region = await block();

    expect(within(region).getAllByRole("listitem")).toHaveLength(2);
    expect(region.textContent).toContain("Nobody has this one?");
    expect(region.textContent).toContain("12 days ago");
    expect(region.textContent).toContain("Assigned: Resting (paused)");
  });

  it("is read before the rows, beneath the fleet's facts", async () => {
    withGaps(gaps([gap("One?")]));

    const region = await block();
    const table = await screen.findByRole("table", { name: "Scouts" });

    expect(
      region.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("says how many are not shown when the list is cut, and gives no total", async () => {
    withGaps(gaps([gap("One?")], 4));

    const region = await block();

    expect(region.textContent).toContain("4 more not shown");
    // Neither a total nor the sum of what is shown and what is not (1 + 4).
    expect(region.textContent).not.toMatch(/total|\b5\b/i);
  });

  it("says nothing of a cut when nothing was cut", async () => {
    withGaps(gaps([gap("One?")]));

    expect((await block()).textContent).not.toContain("not shown");
  });

  it("offers no act on a Question with no id, and says why", async () => {
    withGaps(gaps([gap("Anonymous?", { assign: null })]));

    const region = await block();

    expect(within(region).queryByRole("button")).toBeNull();
    expect(region.textContent).toContain("no id, so no Scout can be Assigned");
  });

  it("opens the new-Scout form with that Question Assigned and the form's other defaults unchanged", async () => {
    withGaps(gaps([gap("Nobody has this one?"), gap("Nor this one?")]), {
      "questions.list": {
        ...empty,
        questions: [
          {
            id: "id-Nobody has this one?",
            question: "Nobody has this one?",
            status: "open",
            path: "a.md",
          },
          {
            id: "id-Nor this one?",
            question: "Nor this one?",
            status: "open",
            path: "b.md",
          },
        ],
      },
      "scouts.list": { scouts: [], unreadable: [] },
      "scouts.queue": [],
      "scouts.groups": [],
      "scouts.fleet": { claim: null, naming: [] },
      "scouts.health": { scouts: [], unreadable: [] },
    });

    fireEvent.click(
      await screen.findByRole("button", {
        name: "brief a scout: Nobody has this one?",
      })
    );

    const form = await screen.findByRole("form", { name: "New Scout" });
    expect(window.location.hash).toBe("#/scouts");
    // The form lists Questions once the Queue has read them.
    await within(form).findByRole("checkbox", { name: /Nor this one/ });
    const checked = within(form)
      .getAllByRole("checkbox")
      .map((box) => [
        box.parentElement?.textContent,
        (box as HTMLInputElement).checked,
      ]);
    expect(checked).toEqual([
      [expect.stringContaining("Nobody has this one?"), true],
      [expect.stringContaining("Nor this one?"), false],
    ]);
    expect(within(form).getByLabelText<HTMLInputElement>(/^name/i).value).toBe(
      ""
    );
    expect(
      within(form).getByLabelText<HTMLSelectElement>(/cadence/i).value
    ).toBe("daily");
    expect(
      within(form).getByLabelText<HTMLSelectElement>(/starting lane/i).value
    ).toBe("review");
  });

  it("with no gaps is a claim that names its Warrant and any Scout not looking", async () => {
    withGaps({
      kind: "covered",
      warrant: { questions: 7, scouts: 5 },
      notLooking: [{ id: "r", name: "Resting", reason: "paused" }],
    });

    const region = await block();

    expect(region.textContent).toContain(
      "Every open question has a Scout looking: 7 questions, 5 Scouts."
    );
    expect(region.textContent).toContain("Resting (paused) is not looking.");
    expect(within(region).queryByRole("button")).toBeNull();
  });

  it("claims no Scout is looking at a Map with no open Question", async () => {
    withGaps({
      kind: "covered",
      warrant: { questions: 0, scouts: 2 },
      notLooking: [],
    });

    const region = await block();

    expect(region.textContent).toContain("no open questions");
    expect(region.textContent).not.toContain("Every open question");
  });

  it("is not drawn when the read failed: there is nothing it checked to claim", async () => {
    open(() => {
      throw new Error("the index is locked");
    });

    expect(await within(await page()).findByText("not known")).toBeDefined();

    expect(screen.queryByRole("region", { name: "Coverage gaps" })).toBeNull();
  });
});
