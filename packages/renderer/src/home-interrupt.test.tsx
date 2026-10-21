import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ActivityRow, Health, ScoutRow } from "core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// The interrupt (spec #728, ticket #730): a Scout whose newest run failed, or
// a Scout file that does not parse, is the one thing Home raises its voice
// for. Driven through App with the core faked at the router's contract, so
// what is asserted is what a person is told and which acts reach the core.

const watched = {
  indexing: null,
  watching: { ok: true },
  current: { ok: true },
};
const NO_REVIEW = {
  pending: 0,
  pastWindow: 0,
  deferred: 0,
  median: null,
  oldest: null,
};
const SENTENCE = "arXiv did not answer on the last check. Try again.";

const WRONG: Health = { voice: "wrong", kind: "network", sentence: SENTENCE };
const LOOKING: Health = { voice: "claim", warrant: null };
const PAUSED: Health = {
  voice: "not yet",
  sentence: "Paused — it is not looking.",
};
const NO_KEY: Health = {
  voice: "not yet",
  kind: "credentials",
  sentence: "No key is stored for this provider.",
};

const scout = (over: Partial<ScoutRow> = {}): ScoutRow => ({
  kind: "scout",
  id: "density-watch",
  name: "density-watch",
  source: { kind: "arxiv", query: "all:density", tags: null },
  cadence: "weekly",
  dueUnder: [],
  assigned: [],
  lane: "review",
  paused: false,
  lastWindow: null,
  lastRun: { finished: "2026-09-30T10:00:00.000Z", ago: "3 d ago" },
  health: WRONG,
  acceptRate: { kind: "nothing triaged" },
  review: NO_REVIEW,
  volume: {
    proposals: 6,
    held: 0,
    alsoFoundElsewhere: 0,
    belowCap: 0,
    muted: 0,
  },
  cost: { kind: "no model call" },
  ...over,
});

const healthOf = (rows: ActivityRow[]) => ({
  scouts: rows.flatMap((r) =>
    r.kind === "scout"
      ? [{ id: r.id, health: r.health, lastCostUsd: null }]
      : []
  ),
  unreadable: rows.flatMap((r) =>
    r.kind === "unreadable" ? [{ file: r.file, health: r.health }] : []
  ),
});

const open = (rows: ActivityRow[], more: Record<string, unknown> = {}) => {
  const broken = rows.filter((r) => r.health.voice === "wrong");
  const notLooking = rows.filter((r) => r.health.voice === "not yet");
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": watched,
    "vault.kinds": ["question"],
    "vault.tree": [{ path: "questions/a.md", kind: "question" }],
    "looseEnds.rows": { groups: [], problems: [] },
    "home.away": { since: null },
    "scouts.activity": { rows },
    "scouts.health": healthOf(rows),
    "scouts.fleet":
      broken.length > 0
        ? {
            claim: null,
            naming: broken.map((r) => (r.kind === "scout" ? r.name : r.file)),
          }
        : {
            claim: "2 scouts watching · all parsed cleanly",
            naming: notLooking.map((r) => (r.kind === "scout" ? r.name : "")),
          },
    ...more,
  });
};

const interrupt = () =>
  screen.findByRole("status", { name: "Scouts that are not working" });

describe("a broken Scout", () => {
  it("is shown with the core's sentence verbatim, what it last did and what it found", async () => {
    open([scout()]);
    const block = within(await interrupt());
    expect(block.getByText("density-watch")).toBeDefined();
    expect(block.getByText(SENTENCE)).toBeDefined();
    expect(block.getByText(/last checked 3 d ago/)).toBeDefined();
    expect(block.getByText(/found 6 in the last 30 days/)).toBeDefined();
  });

  it("is a polite status, ends with the line that it alone interrupts, and raises no alert", async () => {
    open([scout()]);
    const block = await interrupt();
    expect(block.textContent).toContain(
      "This is the only thing on Home that will interrupt you."
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(block.textContent).not.toMatch(/nothing is broken/i);
  });

  it("is gone when nothing is broken, and is not drawn for a healthy fleet", async () => {
    open([scout({ health: LOOKING })]);
    await screen.findByText(/scouts watching/);
    expect(
      screen.queryByRole("status", { name: "Scouts that are not working" })
    ).toBeNull();
  });

  it("is gone as soon as the next read finds it fixed", async () => {
    let rows: ActivityRow[] = [scout()];
    const { stream } = open([], {
      "scouts.activity": () => ({ rows }),
      "scouts.health": () => healthOf(rows),
    });
    await interrupt();
    rows = [scout({ health: LOOKING })];
    stream.push({ type: "scoutFinished", scoutId: "density-watch", runId: 1 });
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: "Scouts that are not working" })
      ).toBeNull()
    );
  });
});

describe("what is not broken", () => {
  it("leaves a paused Scout and one waiting on a key out of the block, and names them in the claim", async () => {
    open([
      scout({ id: "a", name: "alpha", health: LOOKING }),
      scout({ id: "p", name: "paused-one", paused: true, health: PAUSED }),
      scout({ id: "k", name: "keyless", health: NO_KEY }),
    ]);
    await screen.findByText(/scouts watching/);
    expect(
      screen.queryByRole("status", { name: "Scouts that are not working" })
    ).toBeNull();
  });

  it("shows only the broken one beside a paused one and one waiting on a key", async () => {
    open([
      scout({ id: "p", name: "paused-one", paused: true, health: PAUSED }),
      scout({ id: "k", name: "keyless", health: NO_KEY }),
      scout(),
    ]);
    const block = within(await interrupt());
    expect(block.getByText("density-watch")).toBeDefined();
    expect(block.queryByText("paused-one")).toBeNull();
    expect(block.queryByText("keyless")).toBeNull();
  });
});

describe("a Scout file that does not parse", () => {
  const file: ActivityRow = {
    kind: "unreadable",
    file: "mine.md",
    health: { voice: "wrong", kind: null, sentence: "mine.md does not parse." },
  };

  it("is shown by its file name with the core's sentence and only open", async () => {
    open([file]);
    const block = within(await interrupt());
    expect(block.getByText("mine.md")).toBeDefined();
    expect(block.getByText("mine.md does not parse.")).toBeDefined();
    const openLink = block.getByRole("link", { name: "mine.md: open" });
    expect(openLink.getAttribute("href")).toBe("#/scouts");
    expect(block.queryByRole("button")).toBeNull();
  });
});

describe("the acts", () => {
  it("run now asks the core to run that Scout and says what the run did", async () => {
    const asked: unknown[] = [];
    open([scout()], {
      "scouts.runNow": (input: unknown) => {
        asked.push(input);
        return { outcome: "ok", new: 2, held: 0, truncated: 0 };
      },
    });
    const block = within(await interrupt());
    fireEvent.click(
      block.getByRole("button", { name: "density-watch: run now" })
    );
    await block.findByText("2 new");
    expect(asked).toEqual([{ scoutId: "density-watch" }]);
  });

  it("pause leaves the line saying what happened, with undo that resumes it", async () => {
    const asked: unknown[] = [];
    let paused = false;
    const rows = () => [
      paused ? scout({ paused: true, health: PAUSED }) : scout(),
    ];
    open([], {
      "scouts.activity": () => ({ rows: rows() }),
      "scouts.health": () => healthOf(rows()),
      "scouts.setPaused": (input: { paused: boolean }) => {
        asked.push(input);
        paused = input.paused;
      },
    });
    const block = within(await interrupt());
    fireEvent.click(
      block.getByRole("button", { name: "density-watch: pause" })
    );
    await block.findByText(/^Paused\./);
    expect(block.queryByText(SENTENCE)).toBeNull();
    fireEvent.click(block.getByRole("button", { name: "density-watch: undo" }));
    // The block went and came back with the read, so it is found again.
    await screen.findByText(SENTENCE);
    expect(asked).toEqual([
      { scoutId: "density-watch", paused: true },
      { scoutId: "density-watch", paused: false },
    ]);
    expect(
      screen.queryByRole("button", { name: "density-watch: undo" })
    ).toBeNull();
  });

  it("says a refused run now as an alert naming the Scout", async () => {
    open([scout()], {
      "scouts.runNow": () => {
        throw new Error("That Scout is already running.");
      },
    });
    const block = within(await interrupt());
    fireEvent.click(
      block.getByRole("button", { name: "density-watch: run now" })
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "density-watch: That Scout is already running."
    );
    // The block itself stays polite.
    expect(
      screen.getByRole("status", { name: "Scouts that are not working" })
    ).toBeDefined();
  });

  it("keeps the line, with no undo, when a pause is refused", async () => {
    open([scout()], {
      "scouts.setPaused": () => {
        throw new Error("The Scout file could not be written.");
      },
    });
    const block = within(await interrupt());
    fireEvent.click(
      block.getByRole("button", { name: "density-watch: pause" })
    );
    await screen.findByRole("alert");
    expect(block.getByText(SENTENCE)).toBeDefined();
    expect(
      block.queryByRole("button", { name: "density-watch: undo" })
    ).toBeNull();
  });
});
