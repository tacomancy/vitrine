import { afterEach, describe, expect, it } from "vitest";
import { MEASURED_MONTHS, type Attention, type SyncResult } from "./lexicon.js";
import type { LooseEnds } from "./loose-ends.js";
import type { ScoutActivity } from "./scout-activity.js";
import type { FleetHealth } from "./scout-health.js";
import type { RunSummary } from "./scouts.js";
import {
  closeCores,
  core,
  urlOf,
  vaultWith,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// One OpenAlex budget for the whole app (#805, ADR 0051 decisions 5 and 6): a
// Scout and the Attention scatter's sync draw on the same keyless credits, so
// each is told what the other learned. Driven through the router with a
// stand-in `fetch` and a virtual clock; nothing here reaches the real API.

const NOW = new Date("2026-10-22T09:00:00.000Z");
const HOUR = 3_600_000;

const paper = (name: string, tags: string[], abstract: string) => `---
kind: source
citekey: ${name}
title: ${name} on ${abstract.split(".")[0]}
tags: [${tags.join(", ")}]
---
${abstract
  .split(". ")
  .map((s) => `> ${s}`)
  .join("\n")}
`;

// Two placeable Tags, so a sync has two to measure and can stop between them.
const PAPERS = {
  "s/a.md": paper(
    "a",
    ["ml/probing"],
    "The residual stream carries features. A linear probe reads alpha."
  ),
  "s/b.md": paper(
    "b",
    ["ml/probing"],
    "The residual stream is sparse. A linear probe reads beta."
  ),
  "s/c.md": paper(
    "c",
    ["ml/probing"],
    "The residual stream grows. A linear probe reads gamma."
  ),
  "s/d.md": paper(
    "d",
    ["bio/sleep"],
    "Slow waves consolidate memory. Spindle density rises."
  ),
  "s/e.md": paper(
    "e",
    ["bio/sleep"],
    "Slow waves shift at night. Spindle density falls."
  ),
  "s/f.md": paper(
    "f",
    ["bio/sleep"],
    "Slow waves return. Spindle density holds."
  ),
};

const SCOUT = `name: Published sleep
source:
  kind: openalex
cadence: daily
lane: review
created: 2026-10-01T00:00:00Z
filter:
  query: '"sleep consolidation"'
`;

/** The months one Tag's measurement asks for. */
const MONTHS = MEASURED_MONTHS;

const isSearch = (url: URL) =>
  (url.searchParams.get("filter") ?? "").includes("primary_location");

const headers = (remaining?: number, reset?: number) => ({
  headers: {
    ...(remaining === undefined
      ? {}
      : { "x-ratelimit-remaining": String(remaining) }),
    ...(reset === undefined ? {} : { "x-ratelimit-reset": String(reset) }),
  },
});

const counted = (remaining?: number, reset?: number) =>
  Response.json({ meta: { count: 7 }, results: [] }, headers(remaining, reset));

const searched = (remaining?: number, reset?: number) =>
  Response.json({ meta: { count: 0 }, results: [] }, headers(remaining, reset));

const spent = (reset = 3600) =>
  new Response("", { status: 429, ...headers(0, reset) });

async function opened(
  answer: (url: URL, nth: number) => Response,
  scout = SCOUT
) {
  const vault = await vaultWith({
    ...PAPERS,
    ".vitrine/scouts/pub.yaml": scout,
  });
  const requests: URL[] = [];
  const clock = virtualClock();
  let now = NOW.getTime();
  const c = await core({
    now: () => new Date(now),
    openalex: {
      clock,
      fetch: async (input) => {
        const url = urlOf(input);
        requests.push(url);
        return answer(url, requests.length);
      },
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const data = async <T>(path: string) => {
    const reply = await c.query<T>(path);
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  return {
    requests,
    clock,
    advance: (ms: number) => void (now += ms),
    sync: async () => {
      const r = await c.mutate<SyncResult>("lexicon.sync", { confirm: true });
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    run: async () => {
      const r = await c.mutate<RunSummary>("scouts.runNow", { scoutId: "pub" });
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    check: async () =>
      (await c.mutate<string[]>("scouts.checkDue")).result!.data,
    attention: () => data<Attention>("questionMap.attention"),
    health: async () =>
      (await data<FleetHealth>("scouts.health")).scouts.find(
        (s) => s.id === "pub"
      )!.health,
    ends: async () =>
      (await data<LooseEnds>("looseEnds.rows")).groups.flatMap((g) => g.rows),
    activity: () => data<ScoutActivity>("scouts.activity"),
  };
}

describe("one budget for Scouts and the sync", () => {
  it("keeps the sync from sending once a Scout has found the budget spent", async () => {
    const o = await opened((url) => (isSearch(url) ? spent() : counted()));
    expect(await o.run()).toMatchObject({
      outcome: "failed",
      errorKind: "rate_limited",
    });
    const result = await o.sync();
    expect(o.requests).toHaveLength(1);
    expect(result.failed.map((f) => f.kind)).toEqual(["rate_limited"]);
    expect(result.measured).toBe(0);
  });

  it("keeps a Scout from sending once the sync has found the budget spent", async () => {
    const o = await opened((url) => (isSearch(url) ? searched() : spent()));
    await o.sync();
    expect(o.requests).toHaveLength(1);
    expect(await o.run()).toMatchObject({
      outcome: "failed",
      errorKind: "rate_limited",
    });
    expect(o.requests).toHaveLength(1);
  });
});

describe("the sync leaves a reserve of 300 credits for Scouts", () => {
  // Tag one is answered with exactly 300 left on every month but the last,
  // which leaves 299: under the reserve, so tag two is not started.
  const underAfterTheFirstTag = (url: URL, nth: number) =>
    isSearch(url)
      ? searched(10, 3600)
      : counted(nth < MONTHS ? 300 : 299, 3600);

  it("stops under the reserve, having measured what it had begun, and says it paused", async () => {
    const o = await opened(underAfterTheFirstTag);
    const result = await o.sync();
    expect(o.requests).toHaveLength(MONTHS);
    expect(result).toMatchObject({
      measured: 1,
      failed: [],
      waiting: 1,
    });
    expect(result.paused).toBe(
      new Date(NOW.getTime() + 3600 * 1000).toISOString()
    );
  });

  it("records the pause as no failure, and shows it on the panel until the reset", async () => {
    const o = await opened(underAfterTheFirstTag);
    await o.sync();
    const view = await o.attention();
    expect(view.tags.map((t) => t.failure)).toEqual([null, null]);
    expect(view.paused).toBe(
      new Date(NOW.getTime() + 3600 * 1000).toISOString()
    );
  });

  it("does not hold a Scout back", async () => {
    const o = await opened(underAfterTheFirstTag);
    await o.sync();
    expect(await o.run()).toMatchObject({ outcome: "ok" });
  });

  it("is lifted by a Scout's answer too: the reserve is read from any response", async () => {
    const o = await opened((url) =>
      isSearch(url) ? searched(299, 3600) : counted(5000, 3600)
    );
    await o.run();
    const result = await o.sync();
    expect(result.measured).toBe(0);
    expect(result.paused).not.toBeNull();
    expect(o.requests).toHaveLength(1);
  });

  it("resumes after the reset", async () => {
    let answers = underAfterTheFirstTag;
    const o = await opened((url, nth) => answers(url, nth));
    await o.sync();
    answers = (url) => (isSearch(url) ? searched() : counted(900, 3600));
    // The reset is an hour away on the client's own clock.
    await o.clock.sleep(HOUR + 1000);
    const result = await o.sync();
    expect(result).toMatchObject({ measured: 1, waiting: 0, paused: null });
    expect((await o.attention()).paused).toBeNull();
  });
});

describe("a spent budget is a Scout waiting, not a fault", () => {
  const SENTENCE =
    "OpenAlex's daily budget is used up, so this Scout is waiting. It resets at midnight UTC.";

  it("reads not yet in Scout health, and never says the user spent it", async () => {
    const o = await opened(() => spent());
    await o.run();
    const health = await o.health();
    expect(health).toEqual({
      voice: "not yet",
      kind: "budget",
      sentence: SENTENCE,
    });
    expect(health).not.toMatchObject({
      sentence: expect.stringMatching(/\byou/i),
    });
  });

  it("is not a failed Scout in Loose Ends and not a fault in Scout Activity", async () => {
    const o = await opened(() => spent());
    await o.run();
    const rows = await o.ends();
    expect(rows.map((r) => r.kind)).toEqual(["waiting-scout"]);
    expect(rows[0]).toMatchObject({ voice: "not yet", sentence: SENTENCE });
    const { fleet, rows: activity } = await o.activity();
    expect(activity[0]).toMatchObject({
      health: { voice: "not yet", sentence: SENTENCE },
    });
    expect(fleet).toMatchObject({ notReached: 0, notParsing: 0 });
  });

  it("is asked again at the first check after the reset and not before", async () => {
    const o = await opened(() => spent(3600));
    await o.run();
    o.advance(30 * 60_000);
    expect(await o.check()).toEqual([]);
    o.advance(31 * 60_000);
    expect(await o.check()).toEqual(["pub"]);
  });
});
