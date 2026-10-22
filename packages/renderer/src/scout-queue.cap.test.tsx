import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { Card } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// What a Scout's group says of its cap (#647; ADR 0044 decision 5): how many
// the cap cut, what it was, and one click to give them back. The core is
// faked, so what is asserted is what the page draws from what it says.

const SLEEP = {
  id: "sleep",
  name: "Sleep and memory",
  assigned: [],
  paused: false,
  dropped: null,
};

const card: Card = {
  id: 7,
  title: "Slow Oscillations Reconsidered",
  authors: ["Ana van der Meer"],
  published: "2026-09-29T10:00:00Z",
  venue: null,
  venueType: null,
  venueId: null,
  publisher: null,
  abstract: "A short abstract.",
  url: "http://arxiv.org/abs/2609.05678v1",
  doi: null,
  lane: "review",
  scouts: [
    {
      id: "sleep",
      name: "Sleep and memory",
      assigned: [],
      dropped: false,
    },
  ],
  retroactive: false,
  signals: [],
  moved: null,
  pastWindow: false,
  counterweight: false,
};

const group = (over: Record<string, unknown> = {}) => ({
  id: "sleep",
  runId: 3,
  runPending: 1,
  deferred: 0,
  capped: 0,
  cap: null,
  held: [],
  ...over,
});

const answers = (groups: unknown[], more: Record<string, unknown> = {}) => ({
  "vault.current": vault,
  "scouts.list": { scouts: [SLEEP], dropped: [], unreadable: [] },
  "scouts.queue": [card],
  "scouts.groups": groups,
  "scouts.health": { scouts: [] },
  "scouts.fleet": { claim: null, naming: [] },
  "scouts.skim": { recent: [], older: [] },
  "questions.list": { questions: [], partial: [], unreadable: [], shape: [] },
  ...more,
});

const open = async () => {
  fireEvent.click(
    await screen.findByRole("button", { name: /Sleep and memory/ })
  );
  await screen.findByRole("heading", { name: "Sleep and memory" });
};

describe("the Scout Queue — a cap", () => {
  it("says how many sit below the cap, and what the cap was", async () => {
    renderApp(answers([group({ capped: 3, cap: 5 })]));
    await open();

    expect(await screen.findByText("3 below your cap of 5")).toBeDefined();
  });

  it("says nothing of a cap that cut nothing", async () => {
    renderApp(answers([group({ capped: 0, cap: 5 })]));
    await open();

    expect(screen.queryByText(/below your cap/)).toBeNull();
  });

  it("releases them with *show them*, and nothing is rejected", async () => {
    const showCapped = vi.fn<(input: unknown) => unknown>(() => ({
      released: 3,
    }));
    renderApp(
      answers([group({ capped: 3, cap: 5 })], {
        "scouts.showCapped": showCapped,
      })
    );
    await open();

    fireEvent.click(await screen.findByRole("button", { name: "Show them" }));

    await vi.waitFor(() =>
      expect(showCapped).toHaveBeenCalledWith({ scoutId: "sleep" })
    );
  });
});
