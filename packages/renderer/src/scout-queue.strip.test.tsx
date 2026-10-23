import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { Card } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateOver, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// The health strip (#838; ADR 0052 decisions 1 and 2): one tile per Scout,
// carrying its Voice and Accept rate, that only filters; and the Scout header a
// filter opens, holding everything the old rail's selected Scout offered.

const SLEEP = {
  id: "sleep",
  name: "Sleep and memory",
  assigned: [],
  paused: false,
  dropped: null,
};
const PAUSED = { ...SLEEP, id: "slow", name: "Slow waves", paused: true };
const BLOG = { ...SLEEP, id: "blog", name: "Blog ring", dropped: "2026-09-25" };
const FROM_SLEEP = { id: "sleep", name: "Sleep and memory", dropped: false };
const FROM_BLOG = { id: "blog", name: "Blog ring", dropped: true };

const card = (
  id: number,
  by: { id: string; name: string; dropped: boolean } = FROM_SLEEP
): Card => ({
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
  scouts: [{ ...by, assigned: [] }],
  retroactive: false,
  signals: [],
  moved: null,
  pastWindow: false,
  counterweight: false,
});

const row = (id: string, rest: Record<string, unknown>) => ({
  kind: "scout",
  id,
  ...rest,
});

const answers = (
  queue: Card[],
  more: Record<string, unknown> = {}
): Record<string, unknown> => ({
  "vault.current": vault,
  "scouts.list": {
    scouts: [SLEEP, PAUSED],
    dropped: [BLOG],
    unreadable: [{ file: "broken.md", sentence: "Line 3 is not a field." }],
  },
  "scouts.queue": queue,
  "scouts.groups": [
    { id: "sleep", runId: 3, runPending: 2, deferred: 0, held: [] },
    { id: "slow", runId: null, runPending: 0, deferred: 0, held: [] },
    { id: "blog", runId: 5, runPending: 1, deferred: 0, held: [] },
  ],
  "scouts.health": {
    scouts: [
      {
        id: "sleep",
        lastCostUsd: 0.0123,
        health: {
          voice: "claim",
          warrant: {
            finished: "2026-10-01T10:00:00Z",
            fragments: [
              "newest run 2h ago",
              "parsed cleanly",
              "usually ~4 a week",
            ],
          },
        },
      },
      {
        id: "slow",
        lastCostUsd: null,
        health: { voice: "not yet", sentence: "paused since 2 Oct" },
      },
    ],
  },
  "scouts.activity": {
    rows: [
      row("sleep", { acceptRate: rateOver(3, 4) }),
      row("slow", { acceptRate: { kind: "nothing triaged" } }),
    ],
  },
  "scouts.muted": { rules: [], problem: null, items: [] },
  "scouts.fleet": { claim: null, naming: [] },
  "scouts.skim": { recent: [], older: [] },
  "questions.list": { questions: [], partial: [], unreadable: [], shape: [] },
  ...more,
});

const stack = () => [card(1), card(2), card(3, FROM_BLOG)];
const strip = () => screen.findByRole("list", { name: "Scouts" });
const tile = async (name: RegExp) =>
  within(await strip()).findByRole("button", { name });

describe("the health strip", () => {
  it("gives every Scout a tile — paused, dropped with cards waiting, and unreadable — each with its Voice", async () => {
    renderApp(answers(stack()));
    const scouts = await strip();

    const sleep = await tile(/Sleep and memory/);
    expect(sleep.textContent).toContain("2");
    expect(sleep.textContent).toContain(
      "newest run 2h ago · parsed cleanly · usually ~4 a week"
    );
    expect((await tile(/Slow waves/)).textContent).toContain(
      "paused since 2 Oct"
    );
    const blog = await tile(/Blog ring/);
    expect(blog.textContent).toContain("1");
    expect(blog.textContent).toContain("dropped");
    // A file that will not parse keeps its tile, with what is wrong, and is not a filter.
    const broken = within(scouts).getByText("broken.md").closest("li")!;
    expect(broken.textContent).toContain("Line 3 is not a field.");
    expect(within(broken).queryByRole("button")).toBeNull();
  });

  it("says a quiet Scout in words and never as a bare 0, and a missing key as waiting", async () => {
    renderApp(
      answers([], {
        "scouts.health": {
          scouts: [
            {
              id: "sleep",
              lastCostUsd: null,
              health: {
                voice: "not yet",
                sentence: "waiting for a key",
                kind: "credentials",
              },
            },
          ],
        },
      })
    );

    const waiting = await tile(/Sleep and memory/);

    expect(waiting.textContent).toContain("waiting for a key");
    expect(waiting.textContent).not.toContain("⚠");
    expect(waiting.textContent).not.toMatch(/Sleep and memory\s*0/);
  });

  it("draws the Accept rate as a bar, and `—` with the reason in its title when there is none", async () => {
    renderApp(
      answers(stack(), {
        "scouts.activity": {
          rows: [
            row("sleep", { acceptRate: rateOver(3, 4) }),
            row("slow", { acceptRate: { kind: "nothing triaged" } }),
            row("blog", {
              acceptRate: {
                kind: "unavailable",
                reason: "Most of this Scout's papers arrive without authors.",
              },
            }),
          ],
        },
      })
    );

    const rate = (await tile(/Sleep and memory/)).querySelector(
      "[data-accept]"
    )!;
    expect(rate.getAttribute("data-accept")).toBe("rate");
    expect(rate.textContent).toContain("75%");
    expect(rate.getAttribute("title")).toContain("3 of 4");

    const none = (await tile(/Slow waves/)).querySelector("[data-accept]")!;
    expect(none.textContent).toBe("—");
    expect(none.getAttribute("title")).toBe("Nothing triaged yet.");

    const gone = (await tile(/Blog ring/)).querySelector("[data-accept]")!;
    expect(gone.textContent).toBe("—");
    expect(gone.getAttribute("title")).toBe(
      "Most of this Scout's papers arrive without authors."
    );
  });

  it("draws `—` and says why when the rate could not be read", async () => {
    renderApp(
      answers(stack(), {
        "scouts.activity": () => {
          throw new Error("disk gone");
        },
      })
    );

    const none = (await tile(/Sleep and memory/)).querySelector(
      "[data-accept]"
    )!;
    expect(none.textContent).toBe("—");
    expect(none.getAttribute("title")).toContain("could not be read");
  });
});

describe("filtering by a tile", () => {
  it("narrows both lanes to the Scout, names it, and clears by the tile again or by show all", async () => {
    renderApp(
      answers(stack(), {
        "scouts.skim": {
          recent: [
            { ...card(10), title: "Sleep line" },
            { ...card(11, FROM_BLOG), title: "Blog line" },
          ],
          older: [],
        },
      })
    );
    const sleep = await tile(/Sleep and memory/);
    expect(
      within(
        await screen.findByRole("list", { name: "New finds" })
      ).getAllByRole("button")
    ).toHaveLength(3);

    fireEvent.click(sleep);

    expect(
      within(screen.getByRole("list", { name: "New finds" })).getAllByRole(
        "button"
      )
    ).toHaveLength(2);
    expect(sleep.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/only Sleep and memory/)).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: /^Skim/ }));
    const lines = await screen.findByRole("list", { name: "Skim" });
    expect(within(lines).getAllByRole("button")).toHaveLength(1);

    fireEvent.click(screen.getByRole("tab", { name: /^Review/ }));
    fireEvent.click(await tile(/Sleep and memory/));
    expect(screen.queryByText(/only Sleep and memory/)).toBeNull();
    expect(
      within(screen.getByRole("list", { name: "New finds" })).getAllByRole(
        "button"
      )
    ).toHaveLength(3);

    fireEvent.click(await tile(/Blog ring/));
    fireEvent.click(screen.getByRole("button", { name: "show all" }));
    expect(screen.queryByText(/only Blog ring/)).toBeNull();
  });

  it("opens a Scout header with Run now, Edit, Pause, the cost and Assigned Questions, and runs the Scout", async () => {
    const runNow = vi.fn(() => ({
      runId: 1,
      outcome: "ok",
      errorKind: null,
      fetched: 5,
      new: 3,
      held: 1,
      truncated: 230,
      ceiling: 400,
    }));
    renderApp(
      answers(stack(), {
        "scouts.list": {
          scouts: [{ ...SLEEP, assigned: ["q1"] }, PAUSED],
          dropped: [BLOG],
          unreadable: [],
        },
        "scouts.runNow": runNow,
      })
    );
    fireEvent.click(await tile(/Sleep and memory/));

    expect(
      await screen.findByRole("heading", { name: "Sleep and memory" })
    ).toBeDefined();
    expect(screen.getByText(/last run cost \$0\.0123/)).toBeDefined();
    expect(
      screen.getByRole("list", { name: "Assigned Questions" })
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Edit" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Pause" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Run now" }));
    await vi.waitFor(() => expect(runNow).toHaveBeenCalled());
    expect(runNow.mock.calls[0]).toEqual([{ scoutId: "sleep" }]);
  });

  it("puts the held links, the cap line and Show them in the header, and the deferred line on a dropped Scout's", async () => {
    const showCapped = vi.fn(() => ({}));
    renderApp(
      answers(stack(), {
        "scouts.groups": [
          {
            id: "sleep",
            runId: 3,
            runPending: 2,
            deferred: 0,
            capped: 4,
            cap: 5,
            held: [{ path: `${vault.path}/sources/A.md`, title: "Held A" }],
          },
          { id: "blog", runId: 5, runPending: 1, deferred: 2, held: [] },
        ],
        "scouts.showCapped": showCapped,
      })
    );
    fireEvent.click(await tile(/Sleep and memory/));

    expect(await screen.findByText("1 already in your vault")).toBeDefined();
    expect(screen.getByRole("link", { name: "Held A" })).toBeDefined();
    expect(screen.getByText(/4 below your cap of 5/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Show them" }));
    await vi.waitFor(() => expect(showCapped).toHaveBeenCalled());

    fireEvent.click(await tile(/Blog ring/));
    expect(await screen.findByText(/2 deferred/)).toBeDefined();
    // A dropped Scout is not looking: no Run now, Edit or Pause for it.
    expect(screen.queryByRole("button", { name: "Run now" })).toBeNull();
  });

  it("opens already filtered on the Scout a link from Scout Activity names", async () => {
    window.location.hash = "#/scouts?scout=blog";
    renderApp(answers(stack()));

    expect(await screen.findByText(/only Blog ring/)).toBeDefined();
  });
});
