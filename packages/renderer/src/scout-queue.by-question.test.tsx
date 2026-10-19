import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { Card } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// Group by Question (#645; ADR 0044 decision 10): the control, the rail of
// Questions with their own counts and the note that a paper can be in several,
// and `⇧R` reaching only the group on screen. Which paper is in which group
// is the core's (scouts.by-question.test.ts); the window draws what it is told.

const card = (id: number): Card => ({
  id,
  title: `Paper ${id}`,
  authors: ["Ana van der Meer"],
  published: "2026-09-29T10:00:00Z",
  venue: null,
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
  fireEvent.click(screen.getByRole("button", { name: "Question" }));
};

describe("group by Question", () => {
  it("offers Scout, pressed by default, and Question", async () => {
    renderApp(answers());
    await screen.findByRole("article");

    const control = screen.getByRole("group", { name: "Group by" });
    const [scout, question] = Array.from(control.querySelectorAll("button"));
    expect(scout!.getAttribute("aria-pressed")).toBe("true");
    expect(question!.getAttribute("aria-pressed")).toBe("false");
  });

  it("lists each Question and Unassigned with its own count, and says a paper can be in several", async () => {
    renderApp(answers());
    await grouped();

    const rail = await screen.findByRole("list", { name: "Questions" });
    await waitFor(() =>
      expect(
        Array.from(rail.querySelectorAll("button")).map((b) => b.textContent)
      ).toEqual([
        "All Questions3",
        "Does sleep help?2",
        "What is a trace?1",
        "Unassigned1",
      ])
    );
    expect(
      screen.getByText(/can be in several groups, so these counts may add up/)
    ).toBeDefined();
  });

  it("deals only the chosen Question's cards, a shared paper in both", async () => {
    renderApp(answers());
    await grouped();

    fireEvent.click(
      await screen.findByRole("button", { name: /What is a trace/ })
    );
    expect(await screen.findByText("Paper 2")).toBeDefined();
    expect(screen.getByText("card 1 of 1")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Does sleep help/ }));
    await waitFor(() => expect(screen.getByText("card 1 of 2")).toBeDefined());
  });

  it("⇧R in a Question group rejects only that group's cards", async () => {
    const rejectGroup = vi.fn(() => ({ bulk: 5, count: 2 }));
    renderApp(answers({ "scouts.rejectGroup": rejectGroup }));
    await grouped();
    fireEvent.click(
      await screen.findByRole("button", { name: /Does sleep help/ })
    );
    await screen.findByText("card 1 of 2");

    fireEvent.keyDown(document.body, { key: "R", shiftKey: true });

    await waitFor(() =>
      expect(rejectGroup).toHaveBeenCalledWith({ proposalIds: [1, 2] })
    );
  });

  it("Unassigned holds what no Question claims", async () => {
    renderApp(answers());
    await grouped();

    fireEvent.click(await screen.findByRole("button", { name: /Unassigned/ }));

    expect(await screen.findByText("Paper 3")).toBeDefined();
    expect(screen.getByText("card 1 of 1")).toBeDefined();
  });
});
