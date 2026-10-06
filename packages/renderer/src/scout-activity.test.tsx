import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { ActivityRow, ScoutActivity } from "core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// Scout Activity's tracer (#513; spec #511; ADR 0042; ADR 0032): a Dashboard
// at its own Address that draws what `scouts.activity` says and words nothing
// itself. The core is faked, so what is asserted is what the renderer draws
// from what the core says.

const READ = { indexing: null, watching: { ok: true }, current: { ok: true } };
const NONE: ScoutActivity = { rows: [] };

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
};
const RESTING: ActivityRow = {
  kind: "scout",
  id: "resting",
  name: "Resting",
  source: { kind: "watched", url: "https://lab.example/publications" },
  cadence: "monthly",
  lastRun: null,
  health: { voice: "not yet", sentence: "Paused — it is not looking." },
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
    expect(window.location.hash).toBe("#/scout-activity");
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
    open({ rows: [BROKEN, QUIET, RESTING] });

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
      ],
      [
        expect.stringContaining("Quiet by design"),
        "arXiv · all:quiet",
        "weekly",
        "2h ago",
      ],
      // A Scout that has never run says so, and a page is named by its address.
      [
        expect.stringContaining("Resting"),
        "https://lab.example/publications",
        "monthly",
        "not yet",
      ],
    ]);
  });
});

describe("a long Query", () => {
  it("is cut by the column, not by the app: the whole of it stays on the cell", async () => {
    const query =
      `(cat:q-bio.NC OR cat:cs.LG) AND ${"all:sleep ".repeat(20)}`.trim();
    open({
      rows: [{ ...QUIET, source: { kind: "arxiv", query } } as ActivityRow],
    });

    const [row] = await tableRows();
    const watching = within(row!).getAllByRole("cell")[0]!;

    expect(watching.getAttribute("title")).toBe(`arXiv · ${query}`);
    expect(watching.textContent).toBe(`arXiv · ${query}`);
  });
});

describe("each Scout's Voice", () => {
  /**
   * What the Queue's rail says of these same Scouts, drawn from the same
   * health the core handed Scout Activity: the rail is the other surface that
   * words a Scout's Voice, and the two must agree to the letter.
   */
  async function railSays(rows: ActivityRow[]) {
    const scouts = rows.flatMap((row) =>
      row.kind === "scout"
        ? [
            {
              id: row.id,
              name: row.name,
              source: { kind: "arxiv" },
              query: "all:x",
              cadence: row.cadence,
              assigned: [],
              lane: "review",
              paused: false,
              created: "2026-09-20T00:00:00.000Z",
              searchBackTo: null,
            },
          ]
        : []
    );
    window.location.hash = "#/scouts";
    renderApp({
      "vault.current": vault,
      "questions.list": empty,
      "vault.status": READ,
      "scouts.list": {
        scouts,
        unreadable: rows.flatMap((row) =>
          row.kind === "unreadable"
            ? [
                {
                  file: row.file,
                  sentence:
                    row.health.voice === "claim" ? "" : row.health.sentence,
                },
              ]
            : []
        ),
      },
      "scouts.queue": [],
      "scouts.groups": scouts.map(({ id }) => ({
        id,
        runId: null,
        runPending: 0,
        held: [],
      })),
      "scouts.fleet": { claim: null, naming: [] },
      "scouts.health": {
        scouts: rows.flatMap((row) =>
          row.kind === "scout" ? [{ id: row.id, health: row.health }] : []
        ),
        unreadable: [],
      },
    });
    const rail = await screen.findByRole("list", { name: "Scouts" });
    await within(rail).findByText(/Paused — it is not looking\./);
    const said = voicesIn(rail);
    cleanup();
    return said;
  }

  /** Each Voice drawn under a node, which Voice it is and every word of it. */
  const voicesIn = (node: HTMLElement) =>
    [...node.querySelectorAll("[data-voice]")].map((voice) => [
      voice.getAttribute("data-voice"),
      voice.textContent,
    ]);

  it("says each Scout's Voice and Warrant exactly as the Queue's rail words it, and a file that will not parse in the wrong Voice", async () => {
    const rows = [BROKEN, QUIET, RESTING, TORN];
    const rail = await railSays(rows);

    open({ rows });
    const table = await screen.findByRole("table", { name: "Scouts" });

    expect(voicesIn(table)).toEqual(rail);
    // And what both say is the core's: a failure with its one sentence, a
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
    open({ rows: [TORN] });

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
