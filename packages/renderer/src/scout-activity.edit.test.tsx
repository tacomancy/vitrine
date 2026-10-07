import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { ActivityRow, Health, ScoutActivity } from "core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// Acting on a row of Scout Activity (#520; spec #511 stories 48–58; ADR 0042
// decision 5): edit the Query and the Assigned Questions, change the cadence,
// pause and resume, and never leave the row. The core is faked at the router's
// contract, so what is asserted is what a row draws from what the core says
// and what it asks the core to write.

type ScoutRow = Extract<ActivityRow, { kind: "scout" }>;

const READ = { indexing: null, watching: { ok: true }, current: { ok: true } };
const NO_REVIEW = { pending: 0, deferred: 0, median: null, oldest: null };
const NO_FLEET = {
  parsingCleanly: 0,
  notParsing: 0,
  notReached: 0,
  keyRejected: 0,
  noKey: 0,
};

const LOOKING: Health = {
  voice: "claim",
  warrant: {
    finished: "2026-09-30T10:00:00.000Z",
    fragments: ["newest run 2h ago", "parsed cleanly", "no baseline yet"],
  },
};
const PAUSED: Health = {
  voice: "not yet",
  sentence: "Paused — it is not looking.",
};

/** One Scout as the core hands it over; a test names only what it is about. */
const scout = (over: Partial<ScoutRow> = {}): ScoutRow => ({
  kind: "scout",
  id: "sleep",
  name: "Sleep and memory",
  source: { kind: "arxiv", query: "all:sleep" },
  cadence: "weekly",
  dueUnder: [],
  assigned: [],
  lane: "review",
  paused: false,
  lastRun: { finished: "2026-09-30T10:00:00.000Z", ago: "2h ago" },
  health: LOOKING,
  acceptRate: { kind: "nothing triaged" },
  review: NO_REVIEW,
  volume: { proposals: 0, held: 0, alsoFoundElsewhere: 0 },
  cost: { kind: "no model call" },
  ...over,
});

const fleet = (rows: ActivityRow[]): ScoutActivity => ({
  rows,
  fleet: NO_FLEET,
  review: NO_REVIEW,
});

const open = (activity: unknown, more: Record<string, unknown> = {}) => {
  window.location.hash = "#/scout-activity";
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": READ,
    "scouts.activity": activity,
    ...more,
  });
};

/** The Scouts' rows, header row left out. */
const tableRows = async () =>
  within(await screen.findByRole("table", { name: "Scouts" }))
    .getAllByRole("row")
    .slice(1);

describe("pausing and resuming from the row", () => {
  it("pauses the Scout, and the row's Voice and its button follow the core's next answer", async () => {
    const asked: unknown[] = [];
    let paused = false;
    open(() => fleet([scout({ paused, health: paused ? PAUSED : LOOKING })]), {
      "scouts.setPaused": (input: unknown) => {
        asked.push(input);
        paused = true;
      },
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Sleep and memory: pause" })
    );

    expect(
      await screen.findByRole("button", { name: "Sleep and memory: resume" })
    ).toBeDefined();
    expect(asked).toEqual([{ scoutId: "sleep", paused: true }]);
    const [row] = await tableRows();
    expect(row!.textContent).toContain("Paused — it is not looking.");
  });
});

describe("a row says what happened", () => {
  it("says a pause on the row it was about, in a polite line directly beneath it", async () => {
    open(() => fleet([scout(), scout({ id: "other", name: "Other" })]), {
      "scouts.setPaused": () => undefined,
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Sleep and memory: pause" })
    );

    const note = await screen.findByRole("status");
    expect(note.textContent).toBe(
      "Paused. It will not run until you resume it."
    );
    // Under its own row, not under the other's and not in the footer.
    const rows = await tableRows();
    expect(rows[0]!.textContent).toContain("Sleep and memory");
    expect(rows[1]!.contains(note)).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says a resume in the same line", async () => {
    let paused = true;
    open(() => fleet([scout({ paused, health: paused ? PAUSED : LOOKING })]), {
      "scouts.setPaused": () => {
        paused = false;
      },
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Sleep and memory: resume" })
    );

    expect((await screen.findByRole("status")).textContent).toBe(
      "Resumed. It runs again when it is due."
    );
  });

  // The user is waiting on this act, so a refusal of it is an alert, on the
  // row it was about (ADR 0033 decision 1), and the row is as it was.
  it("says a pause the core refused as an alert, and leaves the button as it was", async () => {
    open(() => fleet([scout()]), {
      "scouts.setPaused": () => {
        throw new Error("There is no Scout named sleep.");
      },
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Sleep and memory: pause" })
    );

    expect((await screen.findByRole("alert")).textContent).toBe(
      "There is no Scout named sleep."
    );
    expect(
      screen.getByRole("button", { name: "Sleep and memory: pause" })
    ).toBeDefined();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

// The core sorts every read by need (ADR 0042 decision 8), so a Scout that has
// just been paused is, on the next read, one that is not looking and belongs
// above those that are. The row an act was on must not be moved by it (spec
// #511 story 58): the order the researcher was looking at holds until they ask
// for another.
describe("the order of the table after an act", () => {
  const BROKEN = scout({
    id: "broken",
    name: "Broken",
    health: {
      voice: "wrong",
      kind: "http",
      sentence:
        "arXiv answered with an error (HTTP 503), so nothing was checked.",
    },
  });
  const NEED = { wrong: 0, "not yet": 1, claim: 2 } as const;
  /** What the core answers: by need, as `scouts.activity` does. */
  const byNeed = (rows: ScoutRow[]) =>
    [...rows].sort((a, b) => NEED[a.health.voice] - NEED[b.health.voice]);

  const names = async () =>
    (await tableRows()).flatMap((row) => {
      const header = within(row).queryByRole("rowheader");
      return header === null
        ? []
        : [header.querySelector("span > span")!.textContent];
    });

  /** Three Scouts, the core's order for them, and a pause that changes it. */
  const withAPause = () => {
    let rows = [
      BROKEN,
      scout({ id: "a", name: "Alpha" }),
      scout({ id: "b", name: "Beta" }),
    ];
    open(() => fleet(byNeed(rows)), {
      "scouts.setPaused": ({ scoutId }: { scoutId: string }) => {
        rows = rows.map((row) =>
          row.id === scoutId ? { ...row, paused: true, health: PAUSED } : row
        );
      },
    });
    return () => byNeed(rows).map((row) => row.id);
  };

  it("keeps a paused Scout's row where it was, though the core would now put it higher", async () => {
    const coreOrder = withAPause();
    expect(await names()).toEqual(["Broken", "Alpha", "Beta"]);

    fireEvent.click(await screen.findByRole("button", { name: "Beta: pause" }));
    await screen.findByRole("button", { name: "Beta: resume" });

    // Not a test of nothing: the core's own answer has Beta above Alpha now.
    expect(coreOrder()).toEqual(["broken", "b", "a"]);
    expect(await names()).toEqual(["Broken", "Alpha", "Beta"]);
  });

  it("still sorts by a column the researcher asks for afterwards", async () => {
    withAPause();
    fireEvent.click(await screen.findByRole("button", { name: "Beta: pause" }));
    await screen.findByRole("button", { name: "Beta: resume" });

    fireEvent.click(screen.getByRole("button", { name: "Scout" }));

    expect(await names()).toEqual(["Alpha", "Beta", "Broken"]);
  });
});

describe("the cadence menu", () => {
  const trigger = (cadence = "weekly") =>
    screen.findByRole("button", {
      name: `Sleep and memory: cadence, ${cadence}`,
    });
  const items = () =>
    within(
      screen.getByRole("menu", { name: "Sleep and memory: cadence" })
    ).getAllByRole("menuitemradio");

  it("opens as a menu of the three cadences, with the Scout's own checked, and the cell still says the cadence", async () => {
    open(() => fleet([scout({ cadence: "weekly" })]));
    const [row] = await tableRows();
    expect(within(row!).getAllByRole("cell")[1]!.textContent).toBe("weekly");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(await trigger());

    expect(items().map((item) => item.textContent)).toEqual([
      "daily",
      "weekly",
      "monthly",
    ]);
    expect(items().map((item) => item.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect((await trigger()).getAttribute("aria-expanded")).toBe("true");
  });

  it("says, beside the choices that would make the Scout due at the next check, that they would, before any is chosen", async () => {
    open(() =>
      fleet([scout({ cadence: "monthly", dueUnder: ["daily", "weekly"] })])
    );

    fireEvent.click(await trigger("monthly"));

    expect(items().map((item) => item.textContent)).toEqual([
      "daily · due at the next check",
      "weekly · due at the next check",
      "monthly",
    ]);
  });

  it("says nothing of due where no choice would make it so", async () => {
    open(() => fleet([scout({ cadence: "weekly", dueUnder: [] })]));

    fireEvent.click(await trigger());

    expect(items().every((item) => !item.textContent!.includes("due"))).toBe(
      true
    );
  });

  it("closes again from the same word", async () => {
    open(() => fleet([scout()]));
    fireEvent.click(await trigger());

    fireEvent.click(await trigger());

    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("choosing a cadence", () => {
  const choose = async (cadence: string, from = "weekly") => {
    fireEvent.click(
      await screen.findByRole("button", {
        name: `Sleep and memory: cadence, ${from}`,
      })
    );
    fireEvent.click(
      within(
        screen.getByRole("menu", { name: "Sleep and memory: cadence" })
      ).getByRole("menuitemradio", { name: new RegExp(`^${cadence}`) })
    );
  };

  it("writes that cadence and no other key, says so on the row, closes the menu, and the cell follows the core", async () => {
    const asked: unknown[] = [];
    let cadence = "weekly";
    open(() => fleet([scout({ cadence: cadence as ScoutRow["cadence"] })]), {
      "scouts.setCadence": (input: { cadence: string }) => {
        asked.push(input);
        cadence = input.cadence;
        return { dueAtNextCheck: false };
      },
    });

    await choose("monthly");

    expect((await screen.findByRole("status")).textContent).toBe(
      "Cadence is now monthly."
    );
    expect(asked).toEqual([{ scoutId: "sleep", cadence: "monthly" }]);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(
      await screen.findByRole("button", {
        name: "Sleep and memory: cadence, monthly",
      })
    ).toBeDefined();
  });

  it("names that the Scout is due at the next check when the write says a shorter cadence made it so", async () => {
    open(() => fleet([scout({ cadence: "weekly", dueUnder: ["daily"] })]), {
      "scouts.setCadence": () => ({ dueAtNextCheck: true }),
    });

    await choose("daily");

    expect((await screen.findByRole("status")).textContent).toBe(
      "Cadence is now daily. It is due at the next check."
    );
  });

  it("writes nothing for the cadence the Scout already has, and closes the menu", async () => {
    const asked: unknown[] = [];
    open(() => fleet([scout({ cadence: "weekly" })]), {
      "scouts.setCadence": (input: unknown) => {
        asked.push(input);
        return { dueAtNextCheck: false };
      },
    });

    await choose("weekly");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(asked).toEqual([]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says a change the core refused as an alert on the row, and the cadence stays what it was", async () => {
    open(() => fleet([scout({ cadence: "weekly" })]), {
      "scouts.setCadence": () => {
        throw new Error("There is no Scout named sleep.");
      },
    });

    await choose("daily");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "There is no Scout named sleep."
    );
    expect(
      screen.getByRole("button", { name: "Sleep and memory: cadence, weekly" })
    ).toBeDefined();
  });
});
