import { cleanup, screen, within } from "@testing-library/react";
import type { ActivityRow, Health, ScoutActivity } from "core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

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
): ActivityRow => ({
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
});

const open = (rows: ActivityRow[]) => {
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
