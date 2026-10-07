import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { ActivityRow, Health, ScoutActivity } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, question, renderApp, vault } from "./fake-core";

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
  // Not what these tests are about: a block that claims, so it has no rows of
  // its own to find among the table's.
  coverageGaps: {
    kind: "covered",
    warrant: { questions: 0, scouts: 0 },
    notLooking: [],
  },
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

describe("a Scout that arrives after an act", () => {
  it("follows the rows the researcher was looking at, and does not lead them", async () => {
    const NEW = scout({
      id: "new",
      name: "Newcomer",
      health: {
        voice: "wrong",
        kind: "http",
        sentence:
          "arXiv answered with an error (HTTP 503), so nothing was checked.",
      },
    });
    let rows = [
      scout({ id: "a", name: "Alpha" }),
      scout({ id: "b", name: "Beta" }),
    ];
    open(() => fleet(rows), {
      "scouts.setPaused": () => {
        // The core's answer to the next read has a broken Scout first.
        rows = [NEW, ...rows];
      },
    });
    const names = async () =>
      (await tableRows()).flatMap((row) => {
        const header = within(row).queryByRole("rowheader");
        return header === null
          ? []
          : [header.querySelector("span > span")!.textContent];
      });
    expect(await names()).toEqual(["Alpha", "Beta"]);

    fireEvent.click(
      await screen.findByRole("button", { name: "Alpha: pause" })
    );
    await screen.findByText("Paused. It will not run until you resume it.");

    expect(await names()).toEqual(["Alpha", "Beta", "Newcomer"]);
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
    // The word says what it opened, as the edit and the rate say theirs.
    expect((await trigger()).getAttribute("aria-controls")).toBe(
      screen.getByRole("menu").closest("tr")!.id
    );
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

    expect(items().every((item) => !item.textContent.includes("due"))).toBe(
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

// The researcher's Questions as the core lists them. A Scout is Assigned to the
// open ones (spec #447 story 5), and one it is already Assigned to stays on
// the list when it has closed, so the picker never rewrites the file behind
// them.
const REPLAY = question("Does replay consolidate?", "2026-09-01", {
  id: "q-replay",
});
const SPINDLES = question("Do spindles carry it?", "2026-09-02", {
  id: "q-spindles",
});
const SETTLED = question("Was it settled?", "2026-08-01", {
  id: "q-settled",
  status: "answered",
});
const QUESTIONS = { ...empty, questions: [REPLAY, SPINDLES, SETTLED] };

describe("editing a Query and its Assigned Questions in the row", () => {
  const form = () =>
    screen.findByRole("form", { name: "Edit Sleep and memory" });
  const edit = async () =>
    fireEvent.click(
      await screen.findByRole("button", { name: "Sleep and memory: edit" })
    );

  it("starts shut on every row, and opens on edit", async () => {
    open(() => fleet([scout(), scout({ id: "other", name: "Other" })]), {
      "questions.list": QUESTIONS,
    });
    await screen.findByRole("button", { name: "Sleep and memory: edit" });
    expect(screen.queryByRole("form")).toBeNull();

    await edit();

    expect(await form()).toBeDefined();
    expect(screen.getAllByRole("form")).toHaveLength(1);
    expect(
      screen
        .getByRole("button", { name: "Sleep and memory: edit" })
        .getAttribute("aria-expanded")
    ).toBe("true");
  });

  it("holds the Scout's own Query, and the Questions it may be Assigned to with its own checked", async () => {
    open(() => fleet([scout({ assigned: ["q-replay"] })]), {
      "questions.list": QUESTIONS,
    });

    await edit();

    const panel = within(await form());
    expect(panel.getByLabelText<HTMLTextAreaElement>("Query").value).toBe(
      "all:sleep"
    );
    // Open Questions are offered; one that is closed and not Assigned is not.
    const boxes = await panel.findAllByRole("checkbox");
    expect(
      boxes.map((box) => [
        (box.closest("label") as HTMLElement).textContent.trim(),
        (box as HTMLInputElement).checked,
      ])
    ).toEqual([
      [expect.stringContaining("Does replay consolidate?"), true],
      [expect.stringContaining("Do spindles carry it?"), false],
    ]);
  });

  it("closes on the same word, and on Cancel, and on Escape, writing nothing", async () => {
    const writes: unknown[] = [];
    open(() => fleet([scout()]), {
      "questions.list": QUESTIONS,
      "scouts.save": (input: unknown) => {
        writes.push(input);
        return { id: "sleep", run: null };
      },
    });

    await edit();
    await edit();
    expect(screen.queryByRole("form")).toBeNull();

    await edit();
    fireEvent.click(
      within(await form()).getByRole("button", { name: "Cancel" })
    );
    expect(screen.queryByRole("form")).toBeNull();

    await edit();
    fireEvent.keyDown(within(await form()).getByLabelText("Query"), {
      key: "Escape",
    });
    expect(screen.queryByRole("form")).toBeNull();
    expect(writes).toEqual([]);
  });
});

describe("saving an edit from the row", () => {
  /** What the core hands back from `scouts.save`: the id, and the run an edited Query set going. */
  const saved = (run: object | null) => ({ id: "sleep", run });
  const RAN = {
    runId: 7,
    outcome: "ok",
    errorKind: null,
    fetched: 4,
    new: 3,
    held: 1,
    unverified: 0,
    truncated: 0,
  };

  /** The row's edit open, the Query retyped, and Save pressed. */
  const edited = async (
    row: Partial<ScoutRow>,
    answer: unknown,
    query = "all:sleep AND all:rem"
  ) => {
    const asked: unknown[] = [];
    open(() => fleet([scout(row)]), {
      "questions.list": QUESTIONS,
      "scouts.save": (input: unknown) => {
        asked.push(input);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Sleep and memory: edit" })
    );
    const panel = within(
      await screen.findByRole("form", { name: "Edit Sleep and memory" })
    );
    await panel.findAllByRole("checkbox");
    fireEvent.change(panel.getByLabelText("Query"), {
      target: { value: query },
    });
    return { asked, panel };
  };

  it("asks for the whole of what the Queue's form would write, from what the row carries, and nothing else", async () => {
    const { asked, panel } = await edited(
      { cadence: "monthly", lane: "skim", assigned: ["q-replay"] },
      saved(RAN)
    );
    fireEvent.click(
      await panel.findByRole("checkbox", { name: /Do spindles carry it/ })
    );

    fireEvent.click(panel.getByRole("button", { name: "Save" }));

    await screen.findByRole("status");
    expect(asked).toEqual([
      {
        id: "sleep",
        name: "Sleep and memory",
        watching: "arxiv",
        query: "all:sleep AND all:rem",
        cadence: "monthly",
        assigned: ["q-replay", "q-spindles"],
        lane: "skim",
        searchBackTo: null,
      },
    ]);
  });

  it("says that the Scout ran at once, with what it found, and closes", async () => {
    const { panel } = await edited({}, saved(RAN));

    fireEvent.click(panel.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "Saved. It ran at once: 3 new · 1 already in your vault."
    );
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("says a run that failed in the Queue's words, and leaves the why to the Voice beside the name", async () => {
    const { panel } = await edited(
      {},
      saved({ ...RAN, outcome: "failed", errorKind: "network", new: 0 })
    );

    fireEvent.click(panel.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "Saved. It ran at once. This run failed: network."
    );
  });

  it("says plainly that it saved and ran nothing when the Query did not change", async () => {
    const { panel } = await edited({}, saved(null), "all:sleep");

    fireEvent.click(panel.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("status")).textContent).toBe("Saved.");
  });

  it("says that a paused Scout was saved and did not run", async () => {
    const { panel } = await edited(
      { paused: true, health: PAUSED },
      saved(null)
    );

    fireEvent.click(panel.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "Saved. It is paused, so it did not run."
    );
  });

  // *Did not run* is a thing said about an edited Query; a paused Scout whose
  // Questions alone were saved had nothing to run for.
  it("does not say a paused Scout did not run when only its Questions were saved", async () => {
    const { panel } = await edited(
      { paused: true, health: PAUSED },
      saved(null),
      "all:sleep"
    );

    fireEvent.click(panel.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("status")).textContent).toBe("Saved.");
  });

  it("keeps the form open with the typing, and says why as an alert, when the core refuses", async () => {
    const { panel } = await edited(
      {},
      new Error("A Scout needs a name and a Query.")
    );

    fireEvent.click(panel.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "A Scout needs a name and a Query."
    );
    expect(panel.getByLabelText<HTMLTextAreaElement>("Query").value).toBe(
      "all:sleep AND all:rem"
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("will not save a Query with nothing in it", async () => {
    const { asked, panel } = await edited({}, saved(null), "   ");

    const save = panel.getByRole<HTMLButtonElement>("button", { name: "Save" });
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(asked).toEqual([]);
  });

  // The picker is drawn once the Questions are read, but what a Scout is
  // Assigned to is its own and goes back as it was whatever the list did.
  it("keeps what the Scout is Assigned to when the Questions could not be read", async () => {
    const asked: unknown[] = [];
    open(() => fleet([scout({ assigned: ["q-replay"] })]), {
      "questions.list": () => {
        throw new Error("The index is not ready.");
      },
      "scouts.save": (input: unknown) => {
        asked.push(input);
        return saved(null);
      },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Sleep and memory: edit" })
    );
    const panel = within(
      await screen.findByRole("form", { name: "Edit Sleep and memory" })
    );

    expect((await panel.findByRole("status")).textContent).toBe(
      "‖ not read — The index is not ready."
    );
    expect(panel.queryByRole("checkbox")).toBeNull();
    fireEvent.click(panel.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved.");
    expect(asked).toMatchObject([{ assigned: ["q-replay"] }]);
  });
});

// A page's address is the one thing the row leaves to the form (ADR 0042
// decision 5): changing it invalidates what the Scout's history rests on, which
// is a deliberate act and its own decision. What it shares with an arXiv Scout
// — the Questions it is Assigned to — is edited in the row all the same.
describe("a Scout that watches a page", () => {
  const LAB = "https://lab.example/publications";
  const PAGE = scout({
    id: "lab",
    name: "Lab publications",
    source: { kind: "watched", url: LAB },
    cadence: "monthly",
    lane: "skim",
    assigned: ["q-replay"],
  });
  const panel = async () => {
    fireEvent.click(
      await screen.findByRole("button", { name: "Lab publications: edit" })
    );
    return within(
      await screen.findByRole("form", { name: "Edit Lab publications" })
    );
  };

  it("offers no address field, and says the form is where it changes", async () => {
    open(() => fleet([PAGE]), { "questions.list": QUESTIONS });

    const edit = await panel();

    expect(edit.queryByLabelText("Query")).toBeNull();
    expect(edit.queryByLabelText("Address")).toBeNull();
    expect(edit.getByText("Its address is changed on the form.")).toBeDefined();
    // What it shares with every Scout is still the row's to edit.
    expect(await edit.findAllByRole("checkbox")).toHaveLength(2);
  });

  it("saves its Assigned Questions through the same write, with the address it has", async () => {
    const asked: unknown[] = [];
    open(() => fleet([PAGE]), {
      "questions.list": QUESTIONS,
      "scouts.save": (input: unknown) => {
        asked.push(input);
        return { id: "lab", run: null };
      },
    });
    const edit = await panel();
    fireEvent.click(
      await edit.findByRole("checkbox", { name: /Do spindles carry it/ })
    );

    fireEvent.click(edit.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("status")).textContent).toBe("Saved.");
    expect(asked).toEqual([
      {
        id: "lab",
        name: "Lab publications",
        watching: "watched",
        query: LAB,
        cadence: "monthly",
        assigned: ["q-replay", "q-spindles"],
        lane: "skim",
        searchBackTo: null,
      },
    ]);
  });

  it("takes the researcher to this Scout's form in the Queue when they ask for it", async () => {
    open(() => fleet([PAGE]), {
      "questions.list": QUESTIONS,
      "scouts.list": {
        scouts: [
          {
            id: "lab",
            name: "Lab publications",
            source: { kind: "watched", url: LAB },
            query: LAB,
            cadence: "monthly",
            assigned: ["q-replay"],
            lane: "skim",
            paused: false,
            created: "2026-09-20T00:00:00.000Z",
            searchBackTo: null,
          },
        ],
        unreadable: [],
      },
      "scouts.queue": [],
      "scouts.groups": [{ id: "lab", runId: null, runPending: 0, held: [] }],
      "scouts.health": {
        scouts: [{ id: "lab", health: LOOKING }],
        unreadable: [],
      },
      "scouts.fleet": { claim: null, naming: [] },
    });
    const edit = await panel();

    fireEvent.click(edit.getByRole("button", { name: "open the form" }));

    expect(window.location.hash).toBe("#/scouts?scout=lab");
    // The Queue's form, which is the one with an Address in it.
    expect(await screen.findByLabelText("Address")).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>("Address").value).toBe(LAB);
  });
});

// Tuning is as quick as triaging (story 77): the table's keys choose a row and
// the row's own act is one more key. They are the same keys j and k already
// are: heard from the table, never from a field being typed in or a menu
// being moved through, which have keys of their own.
describe("the keys for a row's acts", () => {
  const list = () => screen.getByRole("group", { name: "Scout rows" });
  const press = (key: string) => fireEvent.keyDown(list(), { key });
  /** The table with its first row chosen. */
  const chosen = async (rows: ActivityRow[], more = {}) => {
    open(() => fleet(rows), { "questions.list": QUESTIONS, ...more });
    await tableRows();
    press("j");
  };

  it("opens the chosen row's edit on e, with the keyboard in the Query", async () => {
    await chosen([scout()]);

    press("e");

    const panel = await screen.findByRole("form", {
      name: "Edit Sleep and memory",
    });
    expect(document.activeElement).toBe(within(panel).getByLabelText("Query"));
  });

  it("opens the chosen row's cadence menu on c, with the keyboard on the cadence it has", async () => {
    await chosen([scout({ cadence: "weekly" })]);

    press("c");

    await screen.findByRole("menu", { name: "Sleep and memory: cadence" });
    expect(document.activeElement?.textContent).toBe("weekly");
  });

  it("pauses the chosen row on p and resumes it on the next", async () => {
    const asked: unknown[] = [];
    let paused = false;
    open(() => fleet([scout({ paused, health: paused ? PAUSED : LOOKING })]), {
      "scouts.setPaused": (input: { paused: boolean }) => {
        asked.push(input);
        paused = input.paused;
      },
    });
    await tableRows();
    press("j");

    press("p");
    await screen.findByRole("button", { name: "Sleep and memory: resume" });
    press("p");
    await screen.findByRole("button", { name: "Sleep and memory: pause" });

    expect(asked).toEqual([
      { scoutId: "sleep", paused: true },
      { scoutId: "sleep", paused: false },
    ]);
  });

  it("acts on the row that is chosen and not on the first", async () => {
    const asked: unknown[] = [];
    await chosen([scout(), scout({ id: "other", name: "Other" })], {
      "scouts.setPaused": (input: unknown) => void asked.push(input),
    });
    press("j");

    press("p");

    await screen.findByText("Paused. It will not run until you resume it.");
    expect(asked).toEqual([{ scoutId: "other", paused: true }]);
  });

  it("does nothing while no row is chosen", async () => {
    const asked: unknown[] = [];
    open(() => fleet([scout()]), {
      "questions.list": QUESTIONS,
      "scouts.setPaused": (input: unknown) => void asked.push(input),
    });
    await tableRows();

    press("e");
    press("c");
    press("p");

    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(asked).toEqual([]);
  });

  it("does nothing for a file that will not parse, which has no Scout to act on", async () => {
    await chosen([
      {
        kind: "unreadable",
        file: "torn.yaml",
        health: {
          voice: "wrong",
          kind: null,
          sentence: "This file could not be read: line 2 is not valid YAML.",
        },
      },
    ]);

    press("e");
    press("c");
    press("p");

    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("leaves a key typed in the edit form to the form", async () => {
    const asked: unknown[] = [];
    await chosen([scout()], {
      "scouts.setPaused": (input: unknown) => void asked.push(input),
    });
    press("e");
    const query = await screen.findByLabelText("Query");

    fireEvent.keyDown(query, { key: "p" });
    fireEvent.keyDown(query, { key: "c" });
    fireEvent.keyDown(query, { key: "j" });

    expect(asked).toEqual([]);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("the edit form's own keys and focus", () => {
  const list = () => screen.getByRole("group", { name: "Scout rows" });
  const opened = async (more: Record<string, unknown> = {}) => {
    open(() => fleet([scout()]), { "questions.list": QUESTIONS, ...more });
    await tableRows();
    fireEvent.keyDown(list(), { key: "j" });
    fireEvent.keyDown(list(), { key: "e" });
    const form = await screen.findByRole("form", {
      name: "Edit Sleep and memory",
    });
    await within(form).findAllByRole("checkbox");
    return within(form);
  };
  const editButton = () =>
    screen.getByRole("button", { name: "Sleep and memory: edit" });

  it("leaves a key pressed on the form's own buttons to the form", async () => {
    const asked: unknown[] = [];
    const panel = await opened({
      "scouts.setPaused": (input: unknown) => void asked.push(input),
    });

    fireEvent.keyDown(panel.getByRole("button", { name: "Cancel" }), {
      key: "p",
    });
    fireEvent.keyDown(panel.getByRole("button", { name: "Save" }), {
      key: "c",
    });

    expect(asked).toEqual([]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("gives the keyboard back to the word that opened it on Cancel", async () => {
    const panel = await opened();

    fireEvent.click(panel.getByRole("button", { name: "Cancel" }));

    expect(document.activeElement).toBe(editButton());
  });

  it("gives the keyboard back to the word that opened it on Escape", async () => {
    const panel = await opened();

    fireEvent.keyDown(panel.getByLabelText("Query"), { key: "Escape" });

    expect(document.activeElement).toBe(editButton());
  });

  it("gives the keyboard back to the word that opened it after a save", async () => {
    const panel = await opened({
      "scouts.save": () => ({ id: "sleep", run: null }),
    });

    fireEvent.click(panel.getByRole("button", { name: "Save" }));

    await screen.findByText("Saved.");
    expect(document.activeElement).toBe(editButton());
  });

  it("sends one save while the first is on its way, whichever way it is asked for", async () => {
    const asked: unknown[] = [];
    let land!: (answer: unknown) => void;
    const panel = await opened({
      "scouts.save": (input: unknown) => {
        asked.push(input);
        return new Promise((resolve) => (land = resolve));
      },
    });
    const save = panel.getByRole<HTMLButtonElement>("button", { name: "Save" });

    fireEvent.click(save);
    await vi.waitFor(() => expect(save.disabled).toBe(true));
    fireEvent.submit(
      screen.getByRole("form", { name: "Edit Sleep and memory" })
    );
    fireEvent.submit(
      screen.getByRole("form", { name: "Edit Sleep and memory" })
    );
    // A send reaches the core a tick after it is asked for, so a second one
    // has to be given the chance to arrive before there is none to find.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(asked).toHaveLength(1);
    land({ id: "sleep", run: null });
    await screen.findByText("Saved.");
  });

  it("offers no Question that has no id to write into the file", async () => {
    const panel = await opened({
      "questions.list": {
        ...empty,
        questions: [REPLAY, { ...SPINDLES, id: undefined }],
      },
    });

    expect(
      panel
        .getAllByRole("checkbox")
        .map((box) => box.closest("label")!.textContent)
    ).toEqual([expect.stringContaining("Does replay consolidate?")]);
  });
});

describe("the cadence menu's own keys", () => {
  const list = () => screen.getByRole("group", { name: "Scout rows" });
  const active = () => {
    const id = list().getAttribute("aria-activedescendant");
    return id === null ? null : document.getElementById(id);
  };
  const items = () =>
    within(
      screen.getByRole("menu", { name: "Sleep and memory: cadence" })
    ).getAllByRole("menuitemradio");

  it("moves between the choices with the arrows, wrapping, and leaves the table's choice where it was", async () => {
    open(() =>
      fleet([scout({ cadence: "weekly" }), scout({ id: "o", name: "O" })])
    );
    const [first] = await tableRows();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Sleep and memory: cadence, weekly",
      })
    );
    expect(active()).toBe(first);
    const [daily, weekly, monthly] = items();
    expect(document.activeElement).toBe(weekly);

    // The table's choice is read after every key: a run of keys that happened to
    // net out to nothing would otherwise pass for one the table never heard.
    const moves: Array<[HTMLElement, string, HTMLElement]> = [
      [weekly!, "ArrowDown", monthly!],
      [monthly!, "ArrowDown", daily!],
      [daily!, "ArrowUp", monthly!],
      [monthly!, "Home", daily!],
      [daily!, "End", monthly!],
    ];
    for (const [from, key, to] of moves) {
      fireEvent.keyDown(from, { key });
      expect(document.activeElement).toBe(to);
      expect(active()).toBe(first);
    }
    // And the table's own letters are the menu's no more than its arrows are.
    fireEvent.keyDown(monthly!, { key: "j" });
    expect(active()).toBe(first);
  });

  it("closes on Escape and puts the keyboard back on the word that opened it", async () => {
    open(() => fleet([scout({ cadence: "weekly" })]));
    const trigger = await screen.findByRole("button", {
      name: "Sleep and memory: cadence, weekly",
    });
    fireEvent.click(trigger);

    fireEvent.keyDown(items()[1]!, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("puts the keyboard back on the word after a choice, too", async () => {
    open(() => fleet([scout({ cadence: "weekly" })]), {
      "scouts.setCadence": () => ({ dueAtNextCheck: false }),
    });
    const trigger = await screen.findByRole("button", {
      name: "Sleep and memory: cadence, weekly",
    });
    fireEvent.click(trigger);

    fireEvent.click(items()[0]!);

    expect(document.activeElement).toBe(trigger);
  });
});

describe("a key held down", () => {
  it("is one act and not one at every repeat, since each would write the file again", async () => {
    const asked: unknown[] = [];
    open(() => fleet([scout()]), {
      "scouts.setPaused": (input: unknown) => void asked.push(input),
    });
    await tableRows();
    const list = screen.getByRole("group", { name: "Scout rows" });
    fireEvent.keyDown(list, { key: "j" });

    fireEvent.keyDown(list, { key: "p" });
    fireEvent.keyDown(list, { key: "p", repeat: true });
    fireEvent.keyDown(list, { key: "p", repeat: true });

    await screen.findByText("Paused. It will not run until you resume it.");
    expect(asked).toEqual([{ scoutId: "sleep", paused: true }]);
  });
});

describe("a row's own buttons", () => {
  it("are their own acts: none of them also opens the accept-rate line the row opens on a click", async () => {
    open(() => fleet([scout()]), {
      "questions.list": QUESTIONS,
      "scouts.setPaused": () => undefined,
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Sleep and memory: edit" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Sleep and memory: cadence, weekly" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Sleep and memory: pause" })
    );

    await screen.findByText("Paused. It will not run until you resume it.");
    expect(
      screen
        .getByRole("button", { name: /Sleep and memory: accept rate/ })
        .getAttribute("aria-expanded")
    ).toBe("false");
  });
});

// Whatever the act, and whatever the core would now say, the row it was on is
// where the researcher saw it: the table is rearranged by their asking or by
// their arriving and by nothing the table did on its own.
describe("the order of the table after each kind of act", () => {
  const FIRST = scout({ id: "a", name: "Alpha" });
  const SECOND = scout({ id: "b", name: "Beta" });
  const names = async () =>
    (await tableRows()).flatMap((row) => {
      const header = within(row).queryByRole("rowheader");
      return header === null
        ? []
        : [header.querySelector("span > span")!.textContent];
    });

  const acts = [
    {
      act: "a pause",
      answer: (done: () => void) => ({
        "scouts.setPaused": () => void done(),
      }),
      perform: async () =>
        fireEvent.click(
          await screen.findByRole("button", { name: "Beta: pause" })
        ),
      said: "Paused. It will not run until you resume it.",
    },
    {
      act: "a cadence change",
      answer: (done: () => void) => ({
        "scouts.setCadence": () => {
          done();
          return { dueAtNextCheck: false };
        },
      }),
      perform: async () => {
        fireEvent.click(
          await screen.findByRole("button", {
            name: "Beta: cadence, weekly",
          })
        );
        fireEvent.click(screen.getByRole("menuitemradio", { name: "monthly" }));
      },
      said: "Cadence is now monthly.",
    },
    {
      act: "a saved edit",
      answer: (done: () => void) => ({
        "questions.list": QUESTIONS,
        "scouts.save": () => {
          done();
          return { id: "b", run: null };
        },
      }),
      perform: async () => {
        fireEvent.click(
          await screen.findByRole("button", { name: "Beta: edit" })
        );
        const panel = within(
          await screen.findByRole("form", { name: "Edit Beta" })
        );
        await panel.findAllByRole("checkbox");
        fireEvent.click(panel.getByRole("button", { name: "Save" }));
      },
      said: "Saved.",
    },
  ];

  it.each(acts)(
    "holds the order after $act, though the core's next answer reverses it",
    async ({ answer, perform, said }) => {
      let reversed = false;
      open(
        () => fleet(reversed ? [SECOND, FIRST] : [FIRST, SECOND]),
        answer(() => {
          reversed = true;
        })
      );
      expect(await names()).toEqual(["Alpha", "Beta"]);

      await perform();
      await screen.findByText(said);

      expect(reversed).toBe(true);
      expect(await names()).toEqual(["Alpha", "Beta"]);
    }
  );
});
