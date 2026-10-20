import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { ScoutActivity, ScoutRow } from "core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// *Try over the last run's window* in a row's edit (#522; spec #511 stories 52
// and 53; ADR 0042 decision 5). The core is faked at the router's contract:
// what is asserted is what the row says from what the core answers, and what
// it asks the core to send.

const READ = { indexing: null, watching: { ok: true }, current: { ok: true } };
const NO_REVIEW = {
  pending: 0,
  pastWindow: 0,
  deferred: 0,
  median: null,
  oldest: null,
};
const WINDOW = {
  from: "2026-09-23T10:00:00.000Z",
  to: "2026-09-30T10:00:00.000Z",
  fetched: 214,
};

const scout = (over: Partial<ScoutRow> = {}): ScoutRow => ({
  kind: "scout",
  id: "sleep",
  name: "Sleep and memory",
  source: { kind: "arxiv", query: "all:sleep", tags: null },
  cadence: "weekly",
  dueUnder: [],
  assigned: [],
  lane: "review",
  paused: false,
  lastWindow: WINDOW,
  lastRun: { finished: "2026-09-30T10:00:00.000Z", ago: "2h ago" },
  health: {
    voice: "claim",
    warrant: {
      finished: "2026-09-30T10:00:00.000Z",
      fragments: ["newest run 2h ago", "parsed cleanly", "no baseline yet"],
    },
  },
  acceptRate: { kind: "nothing triaged" },
  review: NO_REVIEW,
  volume: {
    proposals: 0,
    held: 0,
    alsoFoundElsewhere: 0,
    belowCap: 0,
    muted: 0,
  },
  cost: { kind: "no model call" },
  ...over,
});

const fleet = (row: ScoutRow): ScoutActivity => ({
  rows: [row],
  fleet: {
    parsingCleanly: 0,
    notParsing: 0,
    notReached: 0,
    keyRejected: 0,
    noKey: 0,
  },
  review: NO_REVIEW,
  coverageGaps: {
    kind: "covered",
    warrant: { questions: 0, scouts: 0 },
    notLooking: [],
  },
  dropped: [],
});

const opened = async (row: ScoutRow, more: Record<string, unknown> = {}) => {
  window.location.hash = "#/scout-activity";
  renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": READ,
    "scouts.activity": () => fleet(row),
    ...more,
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Sleep and memory: edit" })
  );
  return within(
    await screen.findByRole("form", { name: "Edit Sleep and memory" })
  );
};

describe("trying an edited Query over the last run's window", () => {
  it("sends the edited Query for this Scout and says both figures", async () => {
    const asked: unknown[] = [];
    const panel = await opened(scout(), {
      "scouts.tryWindow": (input: unknown) => {
        asked.push(input);
        return { outcome: "found", would: 23, ...WINDOW };
      },
    });
    fireEvent.change(panel.getByLabelText("Query"), {
      target: { value: "all:sleep AND cat:q-bio" },
    });

    fireEvent.click(
      panel.getByRole("button", { name: "Try over the last run's window" })
    );

    const said = await panel.findByRole("status");
    expect(said.textContent).toContain("23");
    expect(said.textContent).toContain("214");
    expect(asked).toEqual([
      { scoutId: "sleep", query: "all:sleep AND cat:q-bio" },
    ]);
  });

  it("says a failed try in the Scout's own sentence, with no figures", async () => {
    const sentence =
      "arXiv answered with an error (HTTP 503), so nothing was checked.";
    const panel = await opened(scout(), {
      "scouts.tryWindow": { outcome: "failed", sentence },
    });

    fireEvent.click(
      panel.getByRole("button", { name: "Try over the last run's window" })
    );

    expect((await panel.findByRole("alert")).textContent).toBe(sentence);
    expect(panel.queryByRole("status")).toBeNull();
    expect(panel.queryByText(/214/)).toBeNull();
  });

  it("offers no try to a Scout that has not completed a run, and says why", async () => {
    const panel = await opened(scout({ lastWindow: null, lastRun: null }));

    expect(
      panel.queryByRole("button", { name: "Try over the last run's window" })
    ).toBeNull();
    expect(panel.getByText(/no completed run to try over/i)).toBeDefined();
  });

  it("never offers it, nor speaks of it, on a Watched Scout", async () => {
    const panel = await opened(
      scout({
        source: { kind: "watched", url: "https://example.test/p" },
        lastWindow: null,
      })
    );

    expect(
      panel.queryByRole("button", { name: "Try over the last run's window" })
    ).toBeNull();
    expect(panel.queryByText(/try over/i)).toBeNull();
  });

  it("forgets a result once the Query changes, since it was about the old text", async () => {
    const panel = await opened(scout(), {
      "scouts.tryWindow": {
        outcome: "found",
        would: 23,
        ...WINDOW,
      },
    });
    fireEvent.click(
      panel.getByRole("button", { name: "Try over the last run's window" })
    );
    await panel.findByRole("status");

    fireEvent.change(panel.getByLabelText("Query"), {
      target: { value: "all:sleep AND y" },
    });

    expect(panel.queryByRole("status")).toBeNull();
  });
});
