import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { Card } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// Group by Question (#645; ADR 0044 decision 10; #857, ADR 0053 decision 2):
// the control, Questions as headings in the list with the note that a paper can
// be in several, the rail of Scouts unchanged, and `⇧R` reaching only the cards
// on screen. Which paper is in which group is the core's
// (scouts.by-question.test.ts); the window draws what it is told.

const card = (id: number): Card => ({
  id,
  title: `Paper ${id}`,
  authors: ["Ana van der Meer"],
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
    { id: "sleep", name: "Sleep and memory", assigned: [], dropped: false },
  ],
  retroactive: false,
  signals: [],
  moved: null,
  pastWindow: false,
  counterweight: false,
});

const answers = (more: Record<string, unknown> = {}) => ({
  "vault.current": vault,
  "scouts.list": {
    scouts: [
      { id: "sleep", name: "Sleep and memory", assigned: [], paused: false },
    ],
    unreadable: [],
  },
  "scouts.queue": [card(1), card(2), card(3)],
  "scouts.batches": [],
  "scouts.groups": [{ id: "sleep", runId: 3, runPending: 3, held: [] }],
  "scouts.questionGroups": [
    { question: { id: "q1", name: "Does sleep help?" }, proposalIds: [1, 2] },
    { question: { id: "q2", name: "What is a trace?" }, proposalIds: [2] },
    { question: null, proposalIds: [3] },
  ],
  "scouts.health": { scouts: [] },
  "scouts.fleet": { claim: null, naming: [] },
  "scouts.skim": { recent: [], older: [] },
  ...more,
});

const grouped = async () => {
  await screen.findByRole("article");
  fireEvent.click(screen.getByRole("button", { name: "group: scout" }));
};

// What the list on screen holds: every row under every heading.
const finds = () =>
  within(screen.getByRole("region", { name: "Scout Queue" })).queryAllByRole(
    "button",
    {
      name: /^Paper /,
    }
  );

const heading = (name: string) => screen.findByRole("heading", { name });

const under = async (name: string) =>
  within((await heading(name)).closest("section")!).queryAllByRole("button", {
    name: /^Paper /,
  });

describe("group by Question", () => {
  it("starts on Scout and flips to Question and back, the rail of Scouts staying through both", async () => {
    renderApp(answers());
    await screen.findByRole("article");

    expect(screen.getByRole("button", { name: "group: scout" })).toBeDefined();
    expect(screen.getByRole("list", { name: "Scouts" })).toBeDefined();
    expect(
      screen.queryByRole("heading", { name: "Does sleep help?" })
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "group: scout" }));
    expect(
      await screen.findByRole("button", { name: "group: question" })
    ).toBeDefined();
    expect(screen.getByRole("list", { name: "Scouts" })).toBeDefined();
    expect(screen.queryByRole("list", { name: "Questions" })).toBeNull();
    expect(await heading("Does sleep help?")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "group: question" }));
    expect(
      await screen.findByRole("button", { name: "group: scout" })
    ).toBeDefined();
    expect(
      screen.queryByRole("heading", { name: "Does sleep help?" })
    ).toBeNull();
  });

  it("heads the list with each Question and Unassigned, a paper in several under each, and says so", async () => {
    renderApp(answers());
    await grouped();

    await waitFor(async () =>
      expect(
        (await under("Does sleep help?")).map((b) =>
          b.getAttribute("aria-label")
        )
      ).toEqual(["Paper 1", "Paper 2"])
    );
    expect(
      (await under("What is a trace?")).map((b) => b.getAttribute("aria-label"))
    ).toEqual(["Paper 2"]);
    expect(
      (await under("Unassigned")).map((b) => b.getAttribute("aria-label"))
    ).toEqual(["Paper 3"]);
    expect(
      screen.getByText(/can be in several groups, so these counts may add up/)
    ).toBeDefined();
  });

  it("filters by a Scout while grouped, and show all clears it", async () => {
    renderApp(
      answers({
        "scouts.list": {
          scouts: [
            {
              id: "sleep",
              name: "Sleep and memory",
              assigned: [],
              paused: false,
            },
            { id: "slow", name: "Slow waves", assigned: [], paused: false },
          ],
          unreadable: [],
        },
        "scouts.queue": [
          card(1),
          card(2),
          {
            ...card(3),
            scouts: [
              { id: "slow", name: "Slow waves", assigned: [], dropped: false },
            ],
          },
        ],
      })
    );
    await grouped();
    await waitFor(() => expect(finds()).toHaveLength(4));

    fireEvent.click(
      await within(screen.getByRole("list", { name: "Scouts" })).findByRole(
        "button",
        { name: /Slow waves/ }
      )
    );
    await waitFor(() => expect(finds()).toHaveLength(1));
    expect((await under("Unassigned")).length).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "show all" }));
    await waitFor(() => expect(finds()).toHaveLength(4));
  });

  it("⇧R rejects exactly the cards on screen, each once", async () => {
    const rejectGroup = vi.fn(() => ({ bulk: 5, count: 3 }));
    renderApp(answers({ "scouts.rejectGroup": rejectGroup }));
    await grouped();
    await waitFor(() => expect(finds()).toHaveLength(4));

    fireEvent.keyDown(document.body, { key: "R", shiftKey: true });

    await waitFor(() =>
      expect(rejectGroup).toHaveBeenCalledWith({ proposalIds: [1, 2, 3] })
    );
  });
});
