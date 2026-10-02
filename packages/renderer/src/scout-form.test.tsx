import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { question, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// #451: a Scout made from a form, and every short place in the Queue in one
// of ADR 0032's three voices. The core is faked, so what is asserted is what
// the renderer sends and what it draws from what the core says.

const scout = (rest: Record<string, unknown> = {}) => ({
  id: "sleep",
  name: "Sleep and memory",
  query: "all:sleep",
  cadence: "daily",
  assigned: [],
  lane: "review",
  paused: false,
  created: "2026-09-20T00:00:00.000Z",
  searchBackTo: null,
  ...rest,
});

const wrong = {
  voice: "wrong",
  kind: "http",
  sentence: "arXiv answered with an error (HTTP 503), so nothing was checked.",
};
const notYet = { voice: "not yet", sentence: "It has not run yet." };
const quiet = {
  voice: "claim",
  warrant: {
    finished: "2026-09-30T10:00:00.000Z",
    fragments: [
      "newest run 2h ago",
      "parsed cleanly",
      "usually ~4 a week (6 runs)",
    ],
  },
};

const fleet = (rest: Record<string, unknown> = {}) => ({
  watching: 3,
  notLooking: [],
  broken: [],
  newestRun: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  lastProposal: "2026-09-11T08:00:00.000Z",
  ...rest,
});

const answers = (more: Record<string, unknown> = {}) => ({
  "vault.current": vault,
  "scouts.list": { scouts: [scout()], unreadable: [] },
  "scouts.queue": [],
  "scouts.groups": [{ id: "sleep", runId: null, runPending: 0, held: [] }],
  "scouts.health": {
    scouts: [{ id: "sleep", health: quiet }],
    unreadable: [],
  },
  "scouts.fleet": fleet(),
  "questions.list": {
    questions: [
      question("Is it consolidation?", "2026-09-01T00:00:00Z", { id: "rq1" }),
      question("Does it need REM?", "2026-09-02T00:00:00Z", {
        id: "rq2",
        status: "answered",
      }),
      question("Is it promoted?", "2026-09-03T00:00:00Z", {
        id: "rq3",
        status: "promoted",
      }),
    ],
    partial: [],
    unreadable: [],
    shape: [],
  },
  ...more,
});

const rail = () => screen.findByRole("list", { name: "Scouts" });

describe("the rail's voices", () => {
  it("shows each Scout's voice on its row, and a Scout file that does not parse in the wrong voice", async () => {
    renderApp(
      answers({
        "scouts.list": {
          scouts: [
            scout(),
            scout({ id: "late", name: "Late one" }),
            scout({ id: "new", name: "New one" }),
          ],
          unreadable: [
            {
              file: "torn.yaml",
              sentence:
                "This file could not be read: line 2 is not valid YAML.",
            },
          ],
        },
        "scouts.health": {
          scouts: [
            { id: "sleep", health: quiet },
            { id: "late", health: wrong },
            { id: "new", health: notYet },
          ],
          unreadable: [],
        },
      })
    );

    const list = await rail();
    await within(list).findByText(wrong.sentence);
    const rows = Object.fromEntries(
      within(list)
        .getAllByRole("listitem")
        .map((li) => [
          (
            li.querySelector("button")?.textContent ??
            li.textContent ??
            ""
          ).replace(/\d+$/, ""),
          li,
        ])
    );
    expect(rows["Sleep and memory"]!.textContent).toContain(
      "newest run 2h ago · parsed cleanly · usually ~4 a week (6 runs)"
    );
    expect(
      within(rows["Late one"]!).getByRole("img", {
        name: "not working",
      })
    ).toBeDefined();
    expect(rows["New one"]!.textContent).toContain("It has not run yet.");
    // Not yet has no glyph: the glyph is what marks a failure.
    expect(within(rows["New one"]!).queryByRole("img")).toBeNull();
    const torn = within(list).getByText("torn.yaml").closest("li")!;
    expect(
      within(torn).getByRole("img", { name: "not working" })
    ).toBeDefined();
    expect(torn.textContent).toContain("line 2 is not valid YAML");
  });

  it("draws the chosen Scout's header with its voice and each Assigned Question's glyph, closed ones without a nag", async () => {
    renderApp(
      answers({
        "scouts.list": {
          scouts: [scout({ assigned: ["rq1", "rq2", "rq3"] })],
          unreadable: [],
        },
        "scouts.health": {
          scouts: [{ id: "sleep", health: wrong }],
          unreadable: [],
        },
      })
    );
    fireEvent.click(
      await within(await rail()).findByRole("button", {
        name: /Sleep and memory/,
      })
    );

    const assigned = await screen.findByRole("list", {
      name: "Assigned Questions",
    });
    const items = within(assigned).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(
      [" Is it consolidation?", " Does it need REM?", " Is it promoted?"].map(
        (t) => expect.stringContaining(t.trim()) as string
      )
    );
    expect(
      items.map((li) => within(li).getByRole("img").getAttribute("aria-label"))
    ).toEqual(["open", "answered", "promoted"]);
    expect(screen.queryByText(/closed|finished|no longer/i)).toBeNull();
  });
});

describe("pause and resume", () => {
  it("pauses from the header and resumes a paused Scout", async () => {
    const calls: unknown[] = [];
    renderApp(
      answers({
        "scouts.setPaused": (input: unknown) => {
          calls.push(input);
          return null;
        },
      })
    );
    fireEvent.click(
      await within(await rail()).findByRole("button", {
        name: /Sleep and memory/,
      })
    );

    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));

    await waitFor(() =>
      expect(calls).toEqual([{ scoutId: "sleep", paused: true }])
    );
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("offers Resume on a paused Scout, which speaks not yet with its reason", async () => {
    renderApp(
      answers({
        "scouts.list": { scouts: [scout({ paused: true })], unreadable: [] },
        "scouts.health": {
          scouts: [
            {
              id: "sleep",
              health: {
                voice: "not yet",
                sentence: "Paused — it is not looking.",
              },
            },
          ],
          unreadable: [],
        },
      })
    );
    fireEvent.click(
      await within(await rail()).findByRole("button", {
        name: /Sleep and memory/,
      })
    );

    expect(await screen.findByRole("button", { name: "Resume" })).toBeDefined();
    expect(
      screen.getAllByText("Paused — it is not looking.").length
    ).toBeGreaterThan(0);
  });
});

describe("the form", () => {
  const open = async (more: Record<string, unknown> = {}) => {
    renderApp(answers(more));
    fireEvent.click(await screen.findByRole("button", { name: "+ New Scout" }));
    return screen.findByRole("form", { name: "New Scout" });
  };
  const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it("opens in place of the stack, offers open Questions only, and Esc returns to the stack", async () => {
    const form = await open({
      "scouts.queue": [
        {
          id: 7,
          title: "A card",
          authors: [],
          published: "2026-09-29T10:00:00Z",
          venue: null,
          abstract: "x",
          url: "https://arxiv.org/abs/1",
          doi: null,
          lane: "review",
          scouts: [{ id: "sleep", name: "Sleep and memory", assigned: [] }],
          retroactive: false,
        },
      ],
    });

    expect(screen.queryByRole("article")).toBeNull();
    const picker = within(form).getByRole("group", {
      name: "Assigned Questions",
    });
    expect(
      within(picker)
        .getAllByRole("checkbox")
        .map((box) => box.parentElement!.textContent)
    ).toEqual([expect.stringContaining("Is it consolidation?") as string]);

    // Heard on the document, so it works after focus has left the form.
    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(await screen.findByRole("article")).toBeDefined();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("saves on a name and a Query alone, searching back 90 days by default, without a try", async () => {
    const saves: Array<Record<string, unknown>> = [];
    await open({
      "scouts.save": (input: Record<string, unknown>) => {
        saves.push(input);
        return { id: "new-one", run: null };
      },
    });
    const save = screen.getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    type("Name", "New one");
    expect((save as HTMLButtonElement).disabled).toBe(true);
    type("Query", "all:sleep");
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Is it consolidation/ })
    );
    type("Cadence", "weekly");
    type("Starting lane", "skim");

    fireEvent.click(save);

    await waitFor(() => expect(saves).toHaveLength(1));
    const back = Date.parse(saves[0]!["searchBackTo"] as string);
    const days = (Date.now() - back) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
    expect(saves[0]).toMatchObject({
      name: "New one",
      query: "all:sleep",
      cadence: "weekly",
      lane: "skim",
      assigned: ["rq1"],
    });
    expect(saves[0]).not.toHaveProperty("id");
    // Back to the stack once saved.
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
  });

  it("tries a Query: the total and the first titles, written nowhere", async () => {
    await open({
      "scouts.tryQuery": {
        outcome: "found",
        total: 212,
        titles: ["First paper", "Second paper"],
      },
    });
    type("Query", "all:sleep");

    fireEvent.click(screen.getByRole("button", { name: "Try" }));

    expect(
      await screen.findByText(/212 results across all of arXiv/)
    ).toBeDefined();
    expect(
      within(screen.getByRole("list", { name: "First results" }))
        .getAllByRole("listitem")
        .map((li) => li.textContent)
    ).toEqual(["First paper", "Second paper"]);
  });

  it("says a zero total is zero across all of arXiv", async () => {
    await open({
      "scouts.tryQuery": { outcome: "found", total: 0, titles: [] },
    });
    type("Query", "all:zzzz");

    fireEvent.click(screen.getByRole("button", { name: "Try" }));

    expect(
      await screen.findByText("0 results across all of arXiv for this query")
    ).toBeDefined();
  });

  it("states a failed try in its kind's sentence, and Save is still open", async () => {
    await open({
      "scouts.tryQuery": { outcome: "failed", sentence: wrong.sentence },
    });
    type("Name", "N");
    type("Query", "all:sleep");

    fireEvent.click(screen.getByRole("button", { name: "Try" }));

    expect(await screen.findByText(wrong.sentence)).toBeDefined();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled
    ).toBe(false);
  });

  it("reopens to edit with the Scout's own values, and sends its id", async () => {
    const saves: Array<Record<string, unknown>> = [];
    renderApp(
      answers({
        "scouts.list": {
          scouts: [scout({ cadence: "monthly", assigned: ["rq2"] })],
          unreadable: [],
        },
        "scouts.save": (input: Record<string, unknown>) => {
          saves.push(input);
          return { id: "sleep", run: null };
        },
      })
    );
    fireEvent.click(
      await within(await rail()).findByRole("button", {
        name: /Sleep and memory/,
      })
    );

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    expect((await screen.findByLabelText<HTMLInputElement>("Name")).value).toBe(
      "Sleep and memory"
    );
    expect(screen.getByLabelText<HTMLTextAreaElement>("Query").value).toBe(
      "all:sleep"
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Cadence").value).toBe(
      "monthly"
    );
    // A Question already assigned stays on the list even though it closed.
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", {
        name: /Does it need REM/,
      }).checked
    ).toBe(true);
    // An existing Scout's window is never moved by an edit.
    expect(screen.queryByLabelText("Also search back to")).toBeNull();
    type("Query", "all:sleep AND all:rem");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({
      id: "sleep",
      query: "all:sleep AND all:rem",
      searchBackTo: null,
    });
  });
});

describe("empty stacks, in the three voices", () => {
  it("says not yet when there are no Scouts, and claims nothing", async () => {
    renderApp(
      answers({
        "scouts.list": { scouts: [], unreadable: [] },
        "scouts.health": { scouts: [], unreadable: [] },
        "scouts.fleet": fleet({ watching: 0 }),
      })
    );

    expect(await screen.findByText("no Scouts yet")).toBeDefined();
    expect(screen.queryByText(/Review cleared/)).toBeNull();
    expect(screen.queryByText(/Nothing pending/)).toBeNull();
  });

  it("claims Review cleared with the fleet's warrant, naming a Scout that is not looking", async () => {
    renderApp(
      answers({
        "scouts.fleet": fleet({
          notLooking: [{ id: "old", name: "Paused one" }],
        }),
      })
    );

    expect(await screen.findByText("Review cleared.")).toBeDefined();
    const warrant = screen.getByText(/3 scouts watching/);
    expect(warrant.textContent).toMatch(
      /^3 scouts watching · all parsed cleanly · newest run 2h ago · last new proposal 11 Sep · not looking: Paused one$/
    );
  });

  it("withholds Review cleared while any Scout is broken, and names it with its sentence", async () => {
    renderApp(
      answers({
        "scouts.list": {
          scouts: [scout()],
          unreadable: [
            {
              file: "torn.yaml",
              sentence: "This file could not be read: it is not a map of keys.",
            },
          ],
        },
        "scouts.health": {
          scouts: [{ id: "sleep", health: wrong }],
          unreadable: [],
        },
        "scouts.fleet": fleet({
          broken: [
            { id: "sleep", name: "Sleep and memory" },
            { id: "torn.yaml", name: "torn.yaml" },
          ],
        }),
      })
    );

    const broken = await screen.findByRole("list", {
      name: "Scouts that are broken",
    });
    expect(broken.textContent).toContain(wrong.sentence);
    expect(broken.textContent).toContain(
      "This file could not be read: it is not a map of keys."
    );
    expect(screen.queryByText("Review cleared.")).toBeNull();
  });

  it("lets a Scout claim nothing pending only after a clean run, and otherwise speaks in its own voice", async () => {
    const clean = renderApp(answers());
    fireEvent.click(
      await within(await rail()).findByRole("button", {
        name: /Sleep and memory/,
      })
    );
    expect(await screen.findByText("Nothing pending.")).toBeDefined();
    clean.unmount();
    cleanup();

    renderApp(
      answers({
        "scouts.health": {
          scouts: [{ id: "sleep", health: wrong }],
          unreadable: [],
        },
      })
    );
    fireEvent.click(
      await within(await rail()).findByRole("button", {
        name: /Sleep and memory/,
      })
    );
    await screen.findByRole("button", { name: "Pause" });
    expect(screen.queryByText("Nothing pending.")).toBeNull();
    expect(screen.getAllByText(wrong.sentence).length).toBeGreaterThan(1);
  });

  it("says no Scout is looking, and names the ones that are not, rather than clearing", async () => {
    renderApp(
      answers({
        "scouts.fleet": fleet({
          watching: 0,
          notLooking: [{ id: "sleep", name: "Sleep and memory" }],
        }),
      })
    );

    expect(
      await screen.findByText(
        /no Scout is looking · not looking: Sleep and memory/
      )
    ).toBeDefined();
    expect(screen.queryByText("Review cleared.")).toBeNull();
  });

  it("says nothing at all while the evidence has not been read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderApp(
      answers({
        "scouts.fleet": () => {
          throw new Error("down");
        },
      })
    );
    await rail();
    expect(screen.queryByText("Review cleared.")).toBeNull();
  });
});
