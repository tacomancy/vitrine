import { afterEach, describe, expect, it } from "vitest";
import type { ScoutActivity } from "./scout-activity.js";
import {
  arxivScout,
  daysAgo,
  openedWithQueue,
  watchedScout,
} from "./scout-queue-seed.js";
import { closeCores } from "./test-core.js";

afterEach(closeCores);

// The weekly Accept-rate line says when the page last changed, derived from
// the runs inside its twelve weeks (ADR 0043 decision 8; #612). Nothing is
// stored: the fact is each run's recorded `query`.

const LAB = "https://lab.example/lab";
const MOVED = "https://lab.example/moved";

async function opened(scouts: Record<string, string>) {
  const f = await openedWithQueue(scouts);
  const runAt = (scout: string, ago: number, query: string | null) =>
    f.db
      .prepare(
        `INSERT INTO scout_runs (scout_id, started, finished, outcome, window_from, window_to, query)
         VALUES (?, ?, ?, 'ok', ?, ?, ?)`
      )
      .run(
        scout,
        daysAgo(ago),
        daysAgo(ago),
        daysAgo(ago),
        daysAgo(ago),
        query
      );
  const rate = async (scoutId: string) => {
    const r = await f.c.query<ScoutActivity>("scouts.activity");
    const row = r.result!.data.rows.find(
      (row) => row.kind === "scout" && row.id === scoutId
    );
    if (row?.kind !== "scout") throw new Error("no such row");
    return row.acceptRate;
  };
  const judged = (scout: string) => f.seed(scout, { action: "accept" });
  return { ...f, runAt, rate, judged };
}

const pageChange = async (
  f: Awaited<ReturnType<typeof opened>>,
  id: string
) => {
  const rate = await f.rate(id);
  if (rate.kind !== "rate") throw new Error(`no line: ${rate.kind}`);
  return rate.pageChange;
};

describe("the weekly line's page change", () => {
  it("is the first run at the page the Scout reads now, when the weeks hold two pages", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    f.judged("w");
    f.runAt("w", 40, LAB);
    f.runAt("w", 20, MOVED);
    f.runAt("w", 10, MOVED);

    expect(await pageChange(f, "w")).toEqual({ at: daysAgo(20) });
  });

  it("is the latest change when the Scout went A, B, A", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    f.judged("w");
    f.runAt("w", 50, LAB);
    f.runAt("w", 30, MOVED);
    f.runAt("w", 10, LAB);

    expect(await pageChange(f, "w")).toEqual({ at: daysAgo(10) });
  });

  it("is null when the runs inside the weeks all asked one page, even if an older run asked another", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    f.judged("w");
    f.runAt("w", 200, LAB);
    f.runAt("w", 20, MOVED);
    f.runAt("w", 10, MOVED);

    expect(await pageChange(f, "w")).toBeNull();
  });

  it("never takes a run from before the column for a second page", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    f.judged("w");
    f.runAt("w", 40, null);
    f.runAt("w", 10, LAB);

    expect(await pageChange(f, "w")).toBeNull();
  });

  it("is null for an arXiv Scout whose Query changed, which is one source", async () => {
    const f = await opened({ "a.yaml": arxivScout("a") });
    f.judged("a");
    f.runAt("a", 40, "all:old");
    f.runAt("a", 10, "all:a");

    expect(await pageChange(f, "a")).toBeNull();
  });

  it("leaves the line's figures as they were", async () => {
    const f = await opened({ "w.yaml": watchedScout("w") });
    f.judged("w");
    const before = await f.rate("w");
    f.runAt("w", 40, LAB);
    f.runAt("w", 10, MOVED);
    const after = await f.rate("w");

    expect({ ...after, pageChange: null }).toEqual({
      ...before,
      pageChange: null,
    });
    expect((after as { pageChange: unknown }).pageChange).not.toBeNull();
  });
});
