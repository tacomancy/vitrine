import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { ActivityRow, ScoutActivity } from "core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { empty, renderApp, vault } from "./fake-core";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/"));

// Dropping a Scout from its row, and the one line at the foot of the table
// that brings it back (#521; spec #511; ADR 0042 decisions 1 and 9). What the
// core says is faked, so what is asserted is what the page draws from it and
// what it asks the core to do.

const READ = { indexing: null, watching: { ok: true }, current: { ok: true } };
const NO_FLEET = {
  parsingCleanly: 0,
  notParsing: 0,
  notReached: 0,
  keyRejected: 0,
  noKey: 0,
};
const NO_REVIEW = { pending: 0, deferred: 0, median: null, oldest: null };

type ScoutRow = Extract<ActivityRow, { kind: "scout" }>;

const scout = (id: string, name: string): ScoutRow => ({
  kind: "scout",
  id,
  name,
  source: { kind: "arxiv", query: `all:${id}` },
  cadence: "daily",
  lastRun: { finished: "2026-09-30T10:00:00.000Z", ago: "2h ago" },
  health: { voice: "claim", warrant: null },
  acceptRate: { kind: "nothing triaged" },
  review: NO_REVIEW,
  volume: { proposals: 0, held: 0, alsoFoundElsewhere: 0 },
  cost: { kind: "no model call" },
});
const SLEEP = scout("sleep", "Sleep and memory");
const BLOG = scout("blog", "Blog ring");
const TORN: ActivityRow = {
  kind: "unreadable",
  file: "torn.yaml",
  health: {
    voice: "wrong",
    kind: null,
    sentence: "This file could not be read: line 2 is not valid YAML.",
  },
};

/** What the core reads: these rows, and these dropped. */
const read = (
  rows: ActivityRow[],
  dropped: ScoutActivity["dropped"] = []
): ScoutActivity => ({ rows, fleet: NO_FLEET, review: NO_REVIEW, dropped });

const open = (
  activity: unknown,
  more: Record<string, unknown> = {}
): ReturnType<typeof renderApp> => {
  window.location.hash = "#/scout-activity";
  return renderApp({
    "vault.current": vault,
    "questions.list": empty,
    "vault.status": READ,
    "scouts.activity": activity,
    ...more,
  });
};

const table = () => screen.findByRole("table", { name: "Scouts" });
/** The Scouts' rows, header row left out. */
const tableRows = async () =>
  within(await table())
    .getAllByRole("row")
    .slice(1);

const dropOn = (row: HTMLElement, name: string) =>
  within(row).getByRole("button", { name: `${name}: drop` });

/** What a dropped row says in place of its figures. */
const DROPPED = "dropped — it no longer runs; what it found stays in Review";

/** A moment for any re-read the page was going to make to land: the tests below pin that none is made. */
const letAReadLand = () => new Promise((resolve) => setTimeout(resolve, 50));

describe("Scout Activity — drop", () => {
  it("is offered on every Scout's row, and on nothing that is not a Scout", async () => {
    open(read([SLEEP, BLOG, TORN]));

    const rows = await tableRows();

    expect(
      rows.map(
        (row) =>
          within(row).queryAllByRole("button", { name: /: drop$/ }).length
      )
    ).toEqual([1, 1, 0]);
  });

  it("drops a Scout from its row, which stays where it was saying what happened, with undo, and is not read away from under the cursor", async () => {
    let current = read([SLEEP, BLOG]);
    const drop = vi.fn<(input: unknown) => unknown>(() => {
      // The core has the drop from here on: a re-read would take the row.
      current = read([BLOG], [{ id: "sleep", name: "Sleep and memory" }]);
      return undefined;
    });
    open(() => current, { "scouts.drop": drop });
    const [first] = await tableRows();

    fireEvent.click(dropOn(first!, "Sleep and memory"));

    await vi.waitFor(() =>
      expect(drop).toHaveBeenCalledWith({ scoutId: "sleep" })
    );
    await screen.findByText(DROPPED);
    await letAReadLand();
    const rows = await tableRows();
    expect(rows).toHaveLength(2);
    const [dropped] = rows;
    expect(within(dropped!).getByRole("rowheader").textContent).toContain(
      "Sleep and memory"
    );
    expect(within(dropped!).getByRole("status").textContent).toBe(DROPPED);
    expect(
      within(dropped!).getByRole("button", { name: "undo" })
    ).toBeDefined();
    // Nothing else about it is offered: it is not looking.
    expect(
      within(dropped!).queryByRole("button", { name: /: drop$/ })
    ).toBeNull();
  });

  it("takes a drop back with undo: the Scout is restored, and the table is read again so its row returns as the core now has it", async () => {
    let current = read([SLEEP, BLOG]);
    const drop = vi.fn<(input: unknown) => unknown>(() => {
      current = read([BLOG], [{ id: "sleep", name: "Sleep and memory" }]);
      return undefined;
    });
    // The core's own copy has moved on since the first read: only a read shows it.
    const restore = vi.fn<(input: unknown) => unknown>(() => {
      current = read([{ ...SLEEP, cadence: "weekly" }, BLOG]);
      return undefined;
    });
    open(() => current, { "scouts.drop": drop, "scouts.restore": restore });
    const [first] = await tableRows();
    fireEvent.click(dropOn(first!, "Sleep and memory"));
    const [dropped] = await tableRows();

    fireEvent.click(
      await within(dropped!).findByRole("button", { name: "undo" })
    );

    await vi.waitFor(() =>
      expect(restore).toHaveBeenCalledWith({ scoutId: "sleep" })
    );
    await vi.waitFor(async () => {
      const [back] = await tableRows();
      expect(within(back!).getAllByRole("cell")[1]!.textContent).toBe("weekly");
    });
    const rows = await tableRows();
    expect(rows).toHaveLength(2);
    expect(dropOn(rows[0]!, "Sleep and memory")).toBeDefined();
    expect(screen.queryByText(DROPPED)).toBeNull();
  });

  it("says so on the row, in the alert voice, when the core refuses a drop, and leaves the row as it was", async () => {
    const refusal =
      "Couldn't write .vitrine/scouts/sleep.yaml: EACCES: permission denied";
    open(read([SLEEP, BLOG]), {
      "scouts.drop": () => {
        throw new Error(refusal);
      },
    });
    const [first] = await tableRows();

    fireEvent.click(dropOn(first!, "Sleep and memory"));

    // The user is waiting on the act, so the answer interrupts (ADR 0033).
    expect((await screen.findByRole("alert")).textContent).toContain(refusal);
    const rows = await tableRows();
    expect(dropOn(rows[0]!, "Sleep and memory")).toBeDefined();
    expect(screen.queryByText(DROPPED)).toBeNull();
  });

  it("says so on the row when an undo is refused, which still offers the undo", async () => {
    const refusal =
      "Couldn't read .vitrine/scouts/sleep.yaml: ENOENT: no such file or directory";
    open(read([SLEEP, BLOG]), {
      "scouts.drop": () => undefined,
      "scouts.restore": () => {
        throw new Error(refusal);
      },
    });
    const [first] = await tableRows();
    fireEvent.click(dropOn(first!, "Sleep and memory"));
    const [dropped] = await tableRows();

    fireEvent.click(
      await within(dropped!).findByRole("button", { name: "undo" })
    );

    expect((await screen.findByRole("alert")).textContent).toContain(refusal);
    const [still] = await tableRows();
    expect(within(still!).getByRole("button", { name: "undo" })).toBeDefined();
    expect(screen.getByText(DROPPED)).toBeDefined();
  });
});

describe("Scout Activity — the dropped line", () => {
  const GONE = { id: "gone", name: "Gone" };
  const SLEEPING = { id: "sleep", name: "Sleep and memory" };

  it("is absent when nothing is dropped, so the page carries nothing it has no use for", async () => {
    open(read([SLEEP]));
    await tableRows();

    expect(screen.queryByText(/\d+ dropped/)).toBeNull();
  });

  it("says how many are dropped and opens to their names, each with restore", async () => {
    open(read([BLOG], [SLEEPING, GONE]));
    await tableRows();
    const line = screen.getByRole("button", { name: "2 dropped" });
    // Closed, the line is only a count: the names are one click away.
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list", { name: "Dropped Scouts" })).toBeNull();

    fireEvent.click(line);

    expect(line.getAttribute("aria-expanded")).toBe("true");
    const names = screen.getByRole("list", { name: "Dropped Scouts" });
    expect(
      within(names)
        .getAllByRole("listitem")
        .map((item) => item.firstChild?.textContent)
    ).toEqual(["Sleep and memory", "Gone"]);
    expect(
      within(names)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label"))
    ).toEqual(["Sleep and memory: restore", "Gone: restore"]);
  });

  it("restores a Scout from the line: the core is asked, the table is read again, and the Scout is a row once more", async () => {
    let current = read([BLOG], [SLEEPING]);
    const restore = vi.fn<(input: unknown) => unknown>(() => {
      current = read([SLEEP, BLOG]);
      return undefined;
    });
    open(() => current, { "scouts.restore": restore });
    await tableRows();
    fireEvent.click(screen.getByRole("button", { name: "1 dropped" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Sleep and memory: restore" })
    );

    await vi.waitFor(() =>
      expect(restore).toHaveBeenCalledWith({ scoutId: "sleep" })
    );
    await vi.waitFor(async () =>
      expect(
        (await tableRows()).map(
          (row) => within(row).getByRole("rowheader").textContent
        )
      ).toEqual([
        expect.stringContaining("Sleep and memory"),
        expect.stringContaining("Blog ring"),
      ])
    );
    // The line goes with the last of the dropped.
    expect(screen.queryByText(/\d+ dropped/)).toBeNull();
  });

  it("is where a Scout is found once its row has left: the table's next read has no row for it and the line names it", async () => {
    let current = read([SLEEP, BLOG]);
    const { stream } = open(() => current, {
      "scouts.drop": () => {
        current = read([BLOG], [SLEEPING]);
        return undefined;
      },
    });
    const [first] = await tableRows();
    fireEvent.click(dropOn(first!, "Sleep and memory"));
    await screen.findByText(DROPPED);

    // Any read of the Scouts is the table's next read; a run finishing is one.
    stream.push({ type: "scoutFinished", scoutId: "blog", runId: 1 });

    await vi.waitFor(() => expect(screen.queryByText(DROPPED)).toBeNull());
    expect(await tableRows()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "1 dropped" })).toBeDefined();
  });

  it("is still there when every Scout is dropped, and the first slot says nothing is watching rather than that there are none yet", async () => {
    open(read([], [SLEEPING, GONE]));

    expect(await screen.findByText("no scouts watching")).toBeDefined();
    expect(screen.queryByText("no scouts yet")).toBeNull();
    expect(screen.getByRole("button", { name: "2 dropped" })).toBeDefined();
    // A fleet to rebuild is one new Scout away, as an empty one is.
    expect(screen.getByRole("button", { name: "new scout" })).toBeDefined();
  });
});
