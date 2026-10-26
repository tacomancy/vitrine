import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rateOver, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// The marker and the line above the list (#861; ADR 0053 decision 3, spec #854
// stories 9–23): a shape beside a Scout's Voice when it needs the researcher,
// and the one line that names every such Scout so a fault cannot hide behind a
// narrow rail.

const scout = (id: string, name: string, paused = false) => ({
  id,
  name,
  assigned: [],
  paused,
  dropped: null,
});

const WRONG = {
  voice: "wrong",
  kind: "network",
  sentence: "arXiv could not be reached, so nothing was checked.",
};
const REJECTED = {
  voice: "wrong",
  kind: "credentials",
  sentence: "The key was rejected, so nothing was checked.",
};
const WAITING = {
  voice: "not yet",
  sentence: "waiting for a key",
  kind: "credentials",
};
const BUDGET = {
  voice: "not yet",
  sentence: "OpenAlex's daily credits are used up",
  kind: "budget",
};
const PAUSED = { voice: "not yet", sentence: "paused since 2 Oct" };
const NEVER_RAN = { voice: "not yet", sentence: "first check due now" };
const QUIET = {
  voice: "claim",
  warrant: {
    finished: "2026-10-01T10:00:00Z",
    fragments: ["newest run 2h ago", "parsed cleanly", "usually ~4 a week"],
  },
};
const FOUND = { voice: "claim", warrant: null };

/** Every Voice the core derives, in one fleet, each under its own Scout. */
const FLEET: [string, unknown, "wrong" | "blocked" | null][] = [
  ["Failing", WRONG, "wrong"],
  ["Rejected", REJECTED, "wrong"],
  ["Waiting", WAITING, "blocked"],
  ["Budget", BUDGET, null],
  ["Paused", PAUSED, null],
  ["Never ran", NEVER_RAN, null],
  ["Quiet", QUIET, null],
  ["Found", FOUND, null],
  ["Seldom accepted", FOUND, null],
];

const idOf = (name: string) => name.toLowerCase().replace(/ /g, "-");

const answersFor = (
  fleet: [string, unknown, "wrong" | "blocked" | null][],
  more: Record<string, unknown> = {}
): Record<string, unknown> => ({
  "vault.current": vault,
  "scouts.list": {
    scouts: fleet.map(([name]) => scout(idOf(name), name, name === "Paused")),
    dropped: [
      {
        ...scout("old", "Old one"),
        dropped: "2026-09-25",
      },
    ],
    unreadable: [],
  },
  "scouts.queue": [],
  "scouts.batches": [],
  "scouts.groups": [],
  "scouts.health": {
    scouts: fleet.map(([name, health]) => ({
      id: idOf(name),
      lastCostUsd: null,
      health,
    })),
  },
  "scouts.activity": {
    rows: fleet.map(([name]) => ({
      kind: "scout",
      id: idOf(name),
      // Low enough that a threshold would grade it; it must never be marked.
      acceptRate: name === "Seldom accepted" ? rateOver(0, 9) : rateOver(3, 4),
    })),
  },
  "scouts.muted": { rules: [], problem: null, items: [] },
  "scouts.fleet": { claim: null, naming: [] },
  "scouts.skim": { recent: [], older: [] },
  "questions.list": { questions: [], partial: [], unreadable: [], shape: [] },
  ...more,
});

const rail = () => screen.findByRole("list", { name: "Scouts" });
const entry = async (name: string) => {
  const list = await rail();
  const button = await within(list).findByRole("button", {
    name: new RegExp(name),
  });
  return button.closest("li")!;
};
const markers = (li: HTMLElement) =>
  within(li)
    .queryAllByRole("img")
    .map((img) => img.getAttribute("aria-label"));

describe("the marker beside a Scout that needs you", () => {
  it("lists every Voice and marks the Scouts that are wrong or blocked on credentials, and no others", async () => {
    renderApp(answersFor(FLEET));
    await rail();

    for (const [name, , marked] of FLEET) {
      const li = await entry(name);
      expect(
        markers(li).length > 0,
        `${name} ${marked === null ? "carries no marker" : "is marked"}`
      ).toBe(marked !== null);
    }
  });

  it("draws the two as different shapes, each with a label a screen reader says", async () => {
    renderApp(answersFor(FLEET));
    const wrong = (await entry("Failing")).querySelector("[role=img]")!;
    const blocked = (await entry("Waiting")).querySelector("[role=img]")!;

    expect(wrong.getAttribute("aria-label")).toBe("not working");
    expect(blocked.getAttribute("aria-label")).toBe("waiting for a key");
    expect(wrong.textContent).not.toBe("");
    expect(blocked.textContent).not.toBe("");
    expect(blocked.textContent).not.toBe(wrong.textContent);
  });

  it("says a Scout whose health could not be read in words, with no marker", async () => {
    renderApp(
      answersFor([["Failing", WRONG, "wrong"]], {
        "scouts.health": () => {
          throw new Error("unreadable");
        },
      })
    );
    const li = await entry("Failing");
    await within(li).findByText("health could not be read");
    expect(markers(li)).toEqual([]);
  });
});

describe("a dropped Scout with cards waiting", () => {
  it("keeps its entry, marked dropped, and is neither marked nor named in the line", async () => {
    const dropped = { ...scout("old", "Old one"), dropped: "2026-09-25" };
    renderApp(
      answersFor([["Quiet", QUIET, null]], {
        "scouts.list": {
          scouts: [scout("quiet", "Quiet")],
          dropped: [dropped],
          unreadable: [],
        },
        "scouts.queue": [
          {
            id: 1,
            title: "Paper 1",
            authors: [],
            published: "2026-09-29T10:00:00Z",
            venue: null,
            venueType: null,
            venueId: null,
            alsoOnArxiv: null,
            publisher: null,
            abstract: "An abstract.",
            url: "http://arxiv.org/abs/2609.05678v1",
            doi: null,
            lane: "review",
            scouts: [
              { id: "old", name: "Old one", dropped: true, assigned: [] },
            ],
            retroactive: false,
            signals: [],
            moved: null,
            pastWindow: false,
            counterweight: false,
          },
        ],
        "scouts.groups": [
          { id: "old", runId: 5, runPending: 1, deferred: 0, held: [] },
        ],
      })
    );
    const li = await entry("Old one");

    expect(li.textContent).toContain("dropped");
    expect(markers(li)).toEqual([]);
    expect(screen.queryByRole("region", { name: "Needs you" })).toBeNull();
  });
});

describe("the line above the list", () => {
  const line = () => screen.queryByRole("region", { name: "Needs you" });

  it("names two marked Scouts together with their causes, links each to its row, and is absent with none marked", async () => {
    renderApp(answersFor(FLEET));
    const needs = await screen.findByRole("region", { name: "Needs you" });

    const failing = within(needs).getByRole("link", { name: "Failing" });
    const waiting = within(needs).getByRole("link", { name: "Waiting" });
    expect(failing.getAttribute("href")).toBe(
      "#/scout-management?scout=failing"
    );
    expect(waiting.getAttribute("href")).toBe(
      "#/scout-management?scout=waiting"
    );
    expect(needs.textContent).toContain(WRONG.sentence);
    expect(needs.textContent).toContain("waiting for a key");
    // Paused, quiet, budget and the rest are not named.
    expect(within(needs).queryByRole("link", { name: "Paused" })).toBeNull();
    expect(within(needs).queryByRole("link", { name: "Quiet" })).toBeNull();
    expect(within(needs).queryByRole("link", { name: "Budget" })).toBeNull();
    cleanup();

    renderApp(answersFor(FLEET.filter(([, , marked]) => marked === null)));
    await rail();
    expect(line()).toBeNull();
  });

  it("goes when the cause does, with no other action, and has no button to dismiss it", async () => {
    let health: unknown = WRONG;
    const { stream } = renderApp(
      answersFor([["Failing", WRONG, "wrong"]], {
        "scouts.health": () => ({
          scouts: [{ id: "failing", lastCostUsd: null, health }],
        }),
      })
    );
    const needs = await screen.findByRole("region", { name: "Needs you" });
    expect(within(needs).queryByRole("button")).toBeNull();

    health = QUIET;
    act(() => stream.reconnect());

    await within(await rail()).findByText(/newest run 2h ago/);
    expect(line()).toBeNull();
    expect(markers(await entry("Failing"))).toEqual([]);
  });
});
