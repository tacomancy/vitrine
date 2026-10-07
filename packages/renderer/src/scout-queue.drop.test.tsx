import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { Card } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  window.location.hash = "#/scouts";
});

// What the Queue says of a Scout the researcher dropped (#521; spec #511; ADR
// 0042 decision 1): it is not in the rail, because it is not looking, but what
// it found stays in Review under its name, marked, until it is triaged — and
// can be cleared with *Reject this run* like any other Scout's. The core is
// faked, so what is asserted is what the page draws from what it says.

const SLEEP = {
  id: "sleep",
  name: "Sleep and memory",
  assigned: [],
  paused: false,
  dropped: null,
};
const BLOG = { ...SLEEP, id: "blog", name: "Blog ring", dropped: "2026-09-25" };

const card = (
  id: number,
  title: string,
  by: { id: string; name: string; dropped: boolean }
): Card => ({
  id,
  title,
  authors: ["Ana van der Meer"],
  published: "2026-09-29T10:00:00Z",
  venue: null,
  abstract: "A short abstract.",
  url: "http://arxiv.org/abs/2609.05678v1",
  doi: null,
  lane: "review",
  scouts: [{ ...by, assigned: [] }],
  retroactive: false,
});
const FROM_SLEEP = { id: "sleep", name: "Sleep and memory", dropped: false };
const FROM_BLOG = { id: "blog", name: "Blog ring", dropped: true };

const answers = (
  queue: Card[],
  more: Record<string, unknown> = {}
): Record<string, unknown> => ({
  "vault.current": vault,
  "scouts.list": { scouts: [SLEEP], dropped: [BLOG], unreadable: [] },
  "scouts.queue": queue,
  "scouts.groups": [
    { id: "sleep", runId: 3, runPending: 1, held: [] },
    { id: "blog", runId: 5, runPending: 2, held: [] },
  ],
  "scouts.health": { scouts: [] },
  "scouts.fleet": { claim: null, naming: [] },
  "scouts.skim": { recent: [], older: [] },
  "questions.list": { questions: [], partial: [], unreadable: [], shape: [] },
  ...more,
});

const stack = () => [
  card(7, "Slow Oscillations Reconsidered", FROM_SLEEP),
  card(8, "Link rot in lab blogs", FROM_BLOG),
  card(9, "Feeds that go quiet", FROM_BLOG),
];

const rail = () => screen.findByRole("list", { name: "Scouts" });

describe("the Scout Queue — a dropped Scout", () => {
  it("is not in the rail, which lists only the Scouts that are looking", async () => {
    renderApp(answers(stack()));

    const scouts = await rail();

    // The list is drawn before the Scouts are read: wait for one that is.
    expect(
      await within(scouts).findByRole("button", { name: /Sleep and memory/ })
    ).toBeDefined();
    expect(
      within(scouts).queryByRole("button", { name: /Blog ring/ })
    ).toBeNull();
    // Its cards are still in the stack: the rail's *All Scouts* counts them.
    expect(
      within(scouts).getByRole("button", { name: /All Scouts/ }).textContent
    ).toBe("All Scouts3");
  });

  it("says on each of its cards whose it was, marked as dropped", async () => {
    renderApp(answers(stack().slice(1)));

    const article = await screen.findByRole("article");

    expect(article.textContent).toContain("Blog ring (dropped)");
  });

  it("keeps its stack under its own name, marked dropped and apart from the rail, for as long as anything waits under it", async () => {
    renderApp(answers(stack()));
    const dropped = await screen.findByRole("list", { name: "Dropped Scouts" });
    const entry = within(dropped).getByRole("button", { name: /Blog ring/ });
    expect(entry.textContent).toBe("Blog ring2");
    expect(within(dropped).getByText("dropped")).toBeDefined();

    fireEvent.click(entry);

    // The stack is narrowed to what it found, and the pane says whose it is.
    expect(
      await screen.findByRole("heading", { name: "Blog ring" })
    ).toBeDefined();
    expect(screen.getByText(/^Dropped — /)).toBeDefined();
    expect(
      (await screen.findByRole("article")).getAttribute("aria-label")
    ).toBe("Link rot in lab blogs");
    expect(screen.getByText("card 1 of 2")).toBeDefined();
  });

  it("can be cleared with *Reject this run*, which works on what its newest run found as on any other Scout's", async () => {
    const rejectRun = vi.fn<(input: unknown) => unknown>(() => ({
      rejected: 2,
    }));
    renderApp(answers(stack(), { "scouts.rejectRun": rejectRun }));
    fireEvent.click(await screen.findByRole("button", { name: /Blog ring/ }));

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Reject this run of Blog ring (2)",
      })
    );

    expect(await screen.findByText("Rejected 2 from this run.")).toBeDefined();
    expect(rejectRun).toHaveBeenCalledWith({ runId: 5 });
  });

  it("has no stack of its own to list when nothing waits under it", async () => {
    renderApp(answers(stack().slice(0, 1)));
    await screen.findByRole("article");

    expect(screen.queryByRole("list", { name: "Dropped Scouts" })).toBeNull();
  });

  it("stays in its place while it is the one chosen, though the last of its stack has gone, and leaves when another is", async () => {
    let waiting = stack();
    renderApp(
      answers([], {
        "scouts.queue": () => waiting,
        "scouts.rejectRun": () => {
          waiting = stack().slice(0, 1);
          return { rejected: 2 };
        },
      })
    );
    fireEvent.click(await screen.findByRole("button", { name: /Blog ring/ }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Reject this run of Blog ring (2)",
      })
    );
    await screen.findByText("Rejected 2 from this run.");

    // Nothing waits under it now, but the pane the researcher is in has not moved.
    const dropped = await screen.findByRole("list", { name: "Dropped Scouts" });
    expect(
      within(dropped).getByRole("button", { name: /Blog ring/ }).textContent
    ).toBe("Blog ring0");
    fireEvent.click(screen.getByRole("button", { name: /All Scouts/ }));

    await vi.waitFor(() =>
      expect(screen.queryByRole("list", { name: "Dropped Scouts" })).toBeNull()
    );
  });
});
