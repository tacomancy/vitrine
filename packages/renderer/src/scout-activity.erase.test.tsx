import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { ActivityRow, ScoutActivity } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// Erasing a dropped Scout from the line at the foot of the Scouts screen
// (#859; spec #854; ADR 0053 decision 6). What the core says is faked, so what
// is asserted is what the page draws from it and what it asks the core to do;
// the preconditions themselves are the core's, in `scout-erase.test.ts`.

const READ = { indexing: null, watching: { ok: true }, current: { ok: true } };
const NO_REVIEW = {
  pending: 0,
  pastWindow: 0,
  deferred: 0,
  median: null,
  oldest: null,
};

type ScoutRow = Extract<ActivityRow, { kind: "scout" }>;

const BLOG: ScoutRow = {
  kind: "scout",
  id: "blog",
  name: "Blog ring",
  source: { kind: "arxiv", query: "all:blog", tags: null },
  cadence: "daily",
  dueUnder: [],
  assigned: [],
  lane: "review",
  paused: false,
  lastWindow: null,
  lastRun: { finished: "2026-09-30T10:00:00.000Z", ago: "2h ago" },
  health: { voice: "claim", warrant: null },
  acceptRate: { kind: "nothing triaged" },
  review: NO_REVIEW,
  volume: {
    proposals: 0,
    held: 0,
    alsoFoundElsewhere: 0,
    belowCap: 0,
    muted: 0,
  },
  cost: { kind: "no model call" },
};
const SLEEPING = { id: "sleep", name: "Sleep and memory" };
const GONE = { id: "gone", name: "Gone" };

const read = (dropped: ScoutActivity["dropped"]): ScoutActivity => ({
  rows: [BLOG],
  fleet: {
    parsingCleanly: 0,
    notParsing: 0,
    notReached: 0,
    keyRejected: 0,
    noKey: 0,
  },
  review: NO_REVIEW,
  coverageGaps: {
    kind: "covered",
    warrant: { questions: 0, scouts: 0 },
    notLooking: [],
  },
  dropped,
});

const open = (activity: unknown, more: Record<string, unknown> = {}) => {
  window.location.hash = "#/scout-management";
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": READ,
    "scouts.activity": activity,
    ...more,
  });
};

/** The dropped line, opened. */
const opened = async (count: number) => {
  await screen.findByRole("table", { name: "Scouts" });
  fireEvent.click(screen.getByRole("button", { name: `${count} dropped` }));
  return screen.getByRole("list", { name: "Dropped Scouts" });
};

const item = (list: HTMLElement, name: string) =>
  within(list)
    .getAllByRole("listitem")
    .find((li) => li.firstChild?.textContent === name)!;

describe("Scouts screen — erase", () => {
  it("is offered beside restore on every dropped Scout, and nowhere else on the page", async () => {
    open(read([SLEEPING, GONE]));

    const list = await opened(2);

    expect(
      within(list)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label"))
    ).toEqual([
      "Sleep and memory: restore",
      "Sleep and memory: erase",
      "Gone: restore",
      "Gone: erase",
    ]);
    expect(screen.getAllByRole("button", { name: /: erase$/ })).toHaveLength(2);
  });

  it("asks first, says the brief is lost, and asks the core nothing until it is confirmed", async () => {
    const erase = vi.fn<(input: unknown) => unknown>(() => undefined);
    open(read([SLEEPING]), { "scouts.erase": erase });
    const list = await opened(1);

    fireEvent.click(
      within(list).getByRole("button", { name: "Sleep and memory: erase" })
    );

    const ask = within(list).getByRole("alertdialog", {
      name: "Erase Sleep and memory?",
    });
    expect(ask.textContent).toContain(
      "Its brief — the Query, Tags and Assigned Questions — is lost"
    );
    expect(ask.textContent).toContain("cannot be undone");
    expect(erase).not.toHaveBeenCalled();
  });

  it("changes nothing when it is cancelled: the question goes, the Scout stays on the line, the core is never asked", async () => {
    const erase = vi.fn<(input: unknown) => unknown>(() => undefined);
    open(read([SLEEPING]), { "scouts.erase": erase });
    const list = await opened(1);
    fireEvent.click(
      within(list).getByRole("button", { name: "Sleep and memory: erase" })
    );

    fireEvent.click(screen.getByRole("button", { name: "keep it" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(
      within(list).getByRole("button", { name: "Sleep and memory: restore" })
    ).toBeDefined();
    expect(erase).not.toHaveBeenCalled();
  });

  it("erases on confirmation: the core is asked for that Scout, the table is read again, and the Scout leaves the line", async () => {
    let current = read([SLEEPING, GONE]);
    const erase = vi.fn<(input: unknown) => unknown>(() => {
      current = read([GONE]);
      return undefined;
    });
    open(() => current, { "scouts.erase": erase });
    const list = await opened(2);
    fireEvent.click(
      within(list).getByRole("button", { name: "Sleep and memory: erase" })
    );

    fireEvent.click(screen.getByRole("button", { name: "erase it" }));

    await vi.waitFor(() =>
      expect(erase).toHaveBeenCalledWith({ scoutId: "sleep" })
    );
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "1 dropped" })).toBeDefined()
    );
    expect(screen.queryByText("Sleep and memory")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("says a refusal as an alert beside the Scout it was about, with the core's reason, and leaves it on the line", async () => {
    const refusal =
      "Sleep and memory still has 2 pending Proposals in the Queue. Triage them before erasing.";
    open(read([SLEEPING, GONE]), {
      "scouts.erase": () => {
        throw new Error(refusal);
      },
    });
    const list = await opened(2);
    fireEvent.click(
      within(list).getByRole("button", { name: "Sleep and memory: erase" })
    );

    fireEvent.click(screen.getByRole("button", { name: "erase it" }));

    const sleeping = item(list, "Sleep and memory");
    expect((await within(sleeping).findByRole("alert")).textContent).toContain(
      refusal
    );
    expect(within(item(list, "Gone")).queryByRole("alert")).toBeNull();
    // The Scout is as it was, with both ways still open to it.
    expect(
      within(sleeping).getByRole("button", {
        name: "Sleep and memory: restore",
      })
    ).toBeDefined();
    expect(
      within(sleeping).getByRole("button", { name: "Sleep and memory: erase" })
    ).toBeDefined();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("says a failed write beside the Scout too, and still lists it", async () => {
    const failure =
      "Couldn't write .vitrine/scouts/gone.erased: EACCES: permission denied";
    open(read([GONE]), {
      "scouts.erase": () => {
        throw new Error(failure);
      },
    });
    const list = await opened(1);
    fireEvent.click(within(list).getByRole("button", { name: "Gone: erase" }));

    fireEvent.click(screen.getByRole("button", { name: "erase it" }));

    expect((await within(list).findByRole("alert")).textContent).toContain(
      failure
    );
    expect(screen.getByRole("button", { name: "1 dropped" })).toBeDefined();
  });

  it("forgets an old refusal when the researcher tries again", async () => {
    let refuse = true;
    open(read([GONE]), {
      "scouts.erase": () => {
        if (refuse) throw new Error("Not yet.");
        return undefined;
      },
    });
    const list = await opened(1);
    const erase = () => {
      fireEvent.click(
        within(list).getByRole("button", { name: "Gone: erase" })
      );
      fireEvent.click(screen.getByRole("button", { name: "erase it" }));
    };
    erase();
    await within(list).findByRole("alert");

    refuse = false;
    erase();

    await vi.waitFor(() =>
      expect(within(list).queryByRole("alert")).toBeNull()
    );
  });
});
