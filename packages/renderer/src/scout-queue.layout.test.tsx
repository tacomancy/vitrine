import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import type { Card } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WIDE_FROM } from "./queue-width";
import { resetQueueWidth, setQueueWidth } from "./queue-width.stub";
import { renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// Review as a ranked list beside a detail pane (#837; ADR 0052 decisions 3,
// 7 and 8): the selection is by Proposal id, the keys act on it and move on,
// and one footer line holds the last act with its undo.

const card = (id: number, rest: Partial<Card> = {}): Card => ({
  id,
  title: `Paper ${id}`,
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
    { id: "sleep", name: "Sleep and memory", assigned: [], dropped: false },
  ],
  retroactive: false,
  signals: [],
  moved: null,
  pastWindow: false,
  counterweight: false,
  ...rest,
});

const answers = (queue: Card[], more: Record<string, unknown> = {}) => ({
  "vault.current": vault,
  "scouts.list": {
    scouts: [
      { id: "sleep", name: "Sleep and memory", assigned: [], paused: false },
    ],
    unreadable: [],
  },
  "scouts.queue": queue,
  "scouts.batches": [],
  "scouts.groups": [
    { id: "sleep", runId: 3, runPending: queue.length, held: [] },
  ],
  "scouts.health": { scouts: [] },
  "scouts.fleet": { claim: null, naming: [] },
  "scouts.muted": { rules: [], problem: null, items: [] },
  "scouts.skim": { recent: [], older: [] },
  ...more,
});

// The Queue stacks or sits side by side by its own width, not the window's
// (#868; ADR 0054 decision 2). jsdom evaluates no container query, so the
// width comes from the stand-in for the browser's signal (`queue-width.stub.ts`).

const three = () => [card(1), card(2), card(3)];
const queue = () => screen.getByRole("region", { name: "Scout Queue" });
const rows = () =>
  within(screen.getByRole("list", { name: "New finds" })).getAllByRole(
    "button"
  );

describe("the Queue's layout", () => {
  afterEach(() => {
    resetQueueWidth();
    vi.restoreAllMocks();
  });

  it("follows the Queue's width at one window size, not the viewport", async () => {
    // The window stays at a laptop's width throughout; only the Queue moves.
    window.innerWidth = 1280;
    renderApp(answers(three()));
    await screen.findByRole("article", { name: "Paper 1" });

    act(() => setQueueWidth(WIDE_FROM));
    expect(queue().getAttribute("data-layout")).toBe("wide");

    act(() => setQueueWidth(WIDE_FROM - 1));
    expect(queue().getAttribute("data-layout")).toBe("narrow");
    expect(window.innerWidth).toBe(1280);

    act(() => setQueueWidth(WIDE_FROM + 200));
    expect(queue().getAttribute("data-layout")).toBe("wide");
  });

  it("keeps the same paper chosen when the Queue crosses the threshold", async () => {
    renderApp(answers(three()));
    await screen.findByRole("article", { name: "Paper 1" });
    fireEvent.keyDown(document.body, { key: "j" });
    await screen.findByRole("article", { name: "Paper 2" });

    act(() => setQueueWidth(WIDE_FROM - 100));
    expect(rows()[1]!.getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("article", { name: "Paper 2" })).toBeDefined();

    act(() => setQueueWidth(WIDE_FROM + 100));
    expect(rows()[1]!.getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("article", { name: "Paper 2" })).toBeDefined();
  });
});
