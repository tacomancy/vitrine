import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { ActivityRow, ScoutActivity } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, scrollsInto, vault } from "./fake-core";

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
const NONE: ScoutActivity = { rows: [], fleet: NO_FLEET };
/** The core's read of these rows: the rows as handed over, and the fleet's counts. */
const fleet = (
  rows: ActivityRow[],
  counts: Partial<typeof NO_FLEET> = {}
): ScoutActivity => ({ rows, fleet: { ...NO_FLEET, ...counts } });

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
  lastRun: { finished: "2026-09-30T09:00:00.000Z", ago: "3h ago" },
  health: {
    voice: "wrong",
    kind: "http",
    sentence:
      "arXiv answered with an error (HTTP 503), so nothing was checked.",
  },
  acceptRate: { kind: "rate", accepted: 3, triaged: 4, rate: 0.75 },
};
const QUIET: ActivityRow = {
  kind: "scout",
  id: "quiet",
  name: "Quiet by design",
  source: { kind: "arxiv", query: "all:quiet" },
  cadence: "weekly",
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
};
const RESTING: ActivityRow = {
  kind: "scout",
  id: "resting",
  name: "Resting",
  source: { kind: "watched", url: "https://lab.example/publications" },
  cadence: "monthly",
  lastRun: null,
  health: { voice: "not yet", sentence: "Paused — it is not looking." },
  acceptRate: {
    kind: "unavailable",
    reason: "Most of this Scout's papers arrive without authors or venue.",
  },
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

/** The Scouts' rows, header row left out. */
const tableRows = async () =>
  within(await screen.findByRole("table", { name: "Scouts" }))
    .getAllByRole("row")
    .slice(1);

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
        ...within(row)
          .getAllByRole("cell")
          .map((cell) => cell.textContent),
      ])
    ).toEqual([
      [
        expect.stringContaining("Broken by arXiv"),
        "arXiv · all:broken",
        "daily",
        "3h ago",
        "75% · 4 triaged",
        "queue",
      ],
      [
        expect.stringContaining("Quiet by design"),
        "arXiv · all:quiet",
        "weekly",
        "2h ago",
        "nothing triaged yet",
        "queue",
      ],
      // A Scout that has never run says so, and a page is named by its address.
      [
        expect.stringContaining("Resting"),
        "https://lab.example/publications",
        "monthly",
        "not yet",
        "Most of this Scout's papers arrive without authors or venue.",
        "queue",
      ],
    ]);
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

    expect(
      await screen.findByRole("form", { name: "New Scout" })
    ).toBeDefined();
    expect(window.location.hash).toBe("#/scouts");
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
