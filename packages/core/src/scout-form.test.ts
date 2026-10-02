import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Health } from "./scout-health.js";
import type { Scout } from "./scout-file.js";
import type { RunSummary } from "./scouts.js";
import type { TriedQuery } from "./scout-form.js";
import {
  closeCores,
  core,
  fixtureCopy,
  fixtures,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// Beat 6's fourth slice (#451): a Scout made from a form instead of a file.
// Driven through the router; what the researcher would find on disk and on
// the next read is what is asserted.

const NOW = new Date("2026-09-30T12:00:00Z");
const atom = (name: string) =>
  readFile(join(fixtures, "arxiv", `${name}.xml`), "utf8");

type Answer = (url: URL) => Response | Promise<Response>;

async function opened(answer: Answer) {
  const vault = await fixtureCopy("obsidian-vault");
  const requests: URL[] = [];
  const c = await core({
    now: () => NOW,
    arxiv: {
      clock: virtualClock(),
      fetch: async (input) => {
        const url = urlOf(input);
        requests.push(url);
        return answer(url);
      },
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const rows = <T>(sql: string): T[] => {
    const handle = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"), {
      readOnly: true,
    });
    try {
      return handle.prepare(sql).all() as T[];
    } finally {
      handle.close();
    }
  };
  const ok = async <T>(
    kind: "query" | "mutate",
    path: string,
    input?: unknown
  ) => {
    const r = await c[kind]<T>(path, input);
    expect(r.error).toBeUndefined();
    return r.result!.data;
  };
  return {
    vault,
    requests,
    rows,
    c,
    save: (input: Record<string, unknown>) =>
      ok<{ id: string; run: RunSummary | null }>("mutate", "scouts.save", {
        name: "Sleep and memory",
        query: "all:sleep",
        cadence: "daily",
        assigned: [],
        lane: "review",
        searchBackTo: null,
        ...input,
      }),
    list: async () =>
      (await ok<{ scouts: Scout[] }>("query", "scouts.list")).scouts,
    health: () =>
      ok<{ scouts: Array<{ id: string; health: Health }> }>(
        "query",
        "scouts.health"
      ),
    file: (id: string) =>
      readFile(join(vault, ".vitrine/scouts", `${id}.yaml`), "utf8"),
    write: async (id: string, text: string) => {
      const path = join(vault, ".vitrine/scouts", `${id}.yaml`);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text);
    },
  };
}

const serving =
  (name: string): Answer =>
  async () =>
    new Response(await atom(name));

describe("saving a Scout from the form", () => {
  it("writes a file the next read finds, created now, with its search-back date", async () => {
    const c = await opened(serving("empty"));

    const { id, run } = await c.save({
      name: "Sleep and memory",
      query: "  all:sleep AND all:memory ",
      cadence: "weekly",
      lane: "skim",
      assigned: ["rq2b7x9mk4"],
      searchBackTo: "2026-07-02T00:00:00.000Z",
    });

    expect(id).toBe("sleep-and-memory");
    // A new Scout is not run by saving: it has not looked yet.
    expect(run).toBeNull();
    expect(c.requests).toEqual([]);
    expect(await c.list()).toEqual([
      {
        id: "sleep-and-memory",
        name: "Sleep and memory",
        query: "all:sleep AND all:memory",
        cadence: "weekly",
        assigned: ["rq2b7x9mk4"],
        lane: "skim",
        paused: false,
        created: NOW.toISOString(),
        searchBackTo: "2026-07-02T00:00:00.000Z",
      },
    ]);
  });

  it("gives a second Scout of the same name its own file", async () => {
    const c = await opened(serving("empty"));

    const first = await c.save({});
    const second = await c.save({});

    expect(second.id).not.toBe(first.id);
    expect(await c.list()).toHaveLength(2);
  });

  it("needs only a name and a non-empty Query", async () => {
    const c = await opened(serving("empty"));

    for (const bad of [{ name: "  " }, { query: "   " }]) {
      const r = await c.c.mutate("scouts.save", {
        name: "x",
        query: "q",
        cadence: "daily",
        assigned: [],
        lane: "review",
        searchBackTo: null,
        ...bad,
      });
      expect(r.error).toBeDefined();
    }
    expect(await c.list()).toEqual([]);
  });

  it("shows *not yet* until its first run", async () => {
    const c = await opened(serving("empty"));
    const { id } = await c.save({});

    expect((await c.health()).scouts).toEqual([
      { id, health: { voice: "not yet", sentence: "It has not run yet." } },
    ]);
  });

  it("marks a backward search's Proposals Retroactive", async () => {
    const c = await opened(serving("normal"));
    const { id } = await c.save({ searchBackTo: "2026-07-02T00:00:00.000Z" });

    await c.c.mutate("scouts.runNow", { scoutId: id });

    expect(
      c.rows<{ retroactive: number }>("SELECT retroactive FROM scout_runs")
    ).toEqual([{ retroactive: 1 }]);
    expect(c.requests[0]!.searchParams.get("search_query")).toContain(
      "202607020000"
    );
  });
});

describe("editing a Scout", () => {
  const seeded = async () => {
    const c = await opened(serving("normal"));
    const { id } = await c.save({
      query: "all:sleep",
      searchBackTo: "2026-07-02T00:00:00.000Z",
    });
    await c.c.mutate("scouts.runNow", { scoutId: id });
    c.requests.length = 0;
    return { c, id };
  };

  it("keeps history and the window, and runs the Scout, when the Query changes", async () => {
    const { c, id } = await seeded();
    const [{ window_to }] = c.rows<{ window_to: string }>(
      "SELECT window_to FROM scout_runs"
    ) as [{ window_to: string }];

    const saved = await c.save({ id, query: "cat:q-bio.NC" });

    expect(saved.run?.outcome).toBe("ok");
    const scout = (await c.list())[0]!;
    expect(scout.query).toBe("cat:q-bio.NC");
    expect(scout.created).toBe(NOW.toISOString());
    expect(scout.searchBackTo).toBe("2026-07-02T00:00:00.000Z");
    // The existing window_to: only what is new since the last clean run.
    expect(c.requests[0]!.searchParams.get("search_query")).toContain(
      "202609301200 TO"
    );
    expect(window_to).toBe(NOW.toISOString());
    expect(c.rows("SELECT id FROM proposals")).toHaveLength(2);
    expect(c.rows("SELECT id FROM scout_runs")).toHaveLength(2);
  });

  it("does not run when the Query did not change, and a Lane edit moves nothing already here", async () => {
    const { c, id } = await seeded();

    const saved = await c.save({ id, lane: "skim", name: "Renamed" });

    expect(saved.run).toBeNull();
    expect(c.requests).toEqual([]);
    expect((await c.list())[0]).toMatchObject({
      name: "Renamed",
      lane: "skim",
    });
    // Stamped at arrival: the Proposals already here keep their Lane.
    expect(
      c.rows<{ lane: string }>("SELECT DISTINCT lane FROM proposals")
    ).toEqual([{ lane: "review" }]);
  });

  it("saves an edited Query on a paused Scout without running it", async () => {
    const { c, id } = await seeded();
    await c.c.mutate("scouts.setPaused", { scoutId: id, paused: true });

    const saved = await c.save({ id, query: "cat:q-bio.NC" });

    expect(saved.run).toBeNull();
    expect(c.requests).toEqual([]);
    expect((await c.list())[0]!.query).toBe("cat:q-bio.NC");
  });

  it("keeps keys the form does not know about", async () => {
    const c = await opened(serving("empty"));
    await c.write(
      "hand",
      "name: By hand\ncadence: daily\ncreated: 2026-09-20T00:00:00Z\ncap: 40\nfilter:\n  query: all:x\n  tags: [sleep]\n"
    );

    await c.save({ id: "hand", name: "By hand", query: "all:x", lane: "skim" });

    const text = await c.file("hand");
    expect(text).toContain("cap: 40");
    expect(text).toContain("tags:");
  });

  it("refuses to edit a Scout that is not there", async () => {
    const c = await opened(serving("empty"));
    const r = await c.c.mutate("scouts.save", {
      id: "nope",
      name: "x",
      query: "q",
      cadence: "daily",
      assigned: [],
      lane: "review",
      searchBackTo: null,
    });
    expect(r.error?.message).toMatch(/no Scout/);
  });
});

describe("pausing", () => {
  it("pauses and resumes from the header, and a paused Scout says so", async () => {
    const c = await opened(serving("empty"));
    const { id } = await c.save({});

    expect(
      (await c.c.mutate("scouts.setPaused", { scoutId: id, paused: true }))
        .error
    ).toBeUndefined();
    expect((await c.list())[0]!.paused).toBe(true);
    expect((await c.health()).scouts[0]!.health).toEqual({
      voice: "not yet",
      sentence: "Paused — it is not looking.",
    });

    await c.c.mutate("scouts.setPaused", { scoutId: id, paused: false });
    expect((await c.list())[0]!.paused).toBe(false);
  });

  it("offers no delete", async () => {
    const c = await opened(serving("empty"));
    const r = await c.c.mutate("scouts.delete", { scoutId: "x" });
    expect(r.error).toBeDefined();
  });
});

describe("try", () => {
  const tried = async (answer: Answer) => {
    const c = await opened(answer);
    const r = await c.c.mutate<TriedQuery>("scouts.tryQuery", {
      query: "all:sleep",
    });
    expect(r.error).toBeUndefined();
    return { c, result: r.result!.data };
  };

  it("sends the Query once with no window and shows the total and the first titles, writing nothing", async () => {
    const { c, result } = await tried(serving("normal"));

    expect(result).toEqual({
      outcome: "found",
      total: 2,
      titles: expect.any(Array) as string[],
    });
    expect(result.outcome === "found" && result.titles).toHaveLength(2);
    expect(c.requests).toHaveLength(1);
    const params = c.requests[0]!.searchParams;
    expect(params.get("search_query")).toBe("all:sleep");
    expect(params.get("max_results")).toBe("5");
    expect(c.rows("SELECT id FROM scout_runs")).toEqual([]);
    expect(c.rows("SELECT id FROM proposals")).toEqual([]);
  });

  it("reports zero as a found total of zero", async () => {
    const { result } = await tried(serving("empty"));
    expect(result).toEqual({ outcome: "found", total: 0, titles: [] });
  });

  it("states a failure in the sentence its kind has everywhere", async () => {
    const { result } = await tried(() => new Response("", { status: 503 }));
    expect(result).toEqual({
      outcome: "failed",
      sentence:
        "arXiv answered with an error (HTTP 503), so nothing was checked.",
    });
  });
});

describe("the fleet", () => {
  it("is watching when every Scout parsed cleanly, and says when it last looked and last found", async () => {
    const c = await opened(serving("normal"));
    const a = await c.save({ name: "A" });
    const b = await c.save({ name: "B" });
    await c.c.mutate("scouts.runNow", { scoutId: a.id });
    await c.c.mutate("scouts.runNow", { scoutId: b.id });
    await c.c.mutate("scouts.setPaused", { scoutId: b.id, paused: true });

    const r = await c.c.query<{
      watching: number;
      notLooking: Array<{ id: string; name: string }>;
      broken: Array<{ id: string; name: string }>;
      newestRun: string | null;
      lastProposal: string | null;
    }>("scouts.fleet");

    expect(r.result!.data).toEqual({
      watching: 1,
      notLooking: [{ id: b.id, name: "B" }],
      broken: [],
      newestRun: NOW.toISOString(),
      lastProposal: NOW.toISOString(),
    });
  });

  it("names a Scout that is broken, a failed run and a file that does not parse alike", async () => {
    const c = await opened(() => new Response("", { status: 503 }));
    const a = await c.save({ name: "A" });
    await c.c.mutate("scouts.runNow", { scoutId: a.id });
    await c.write("torn", "name: [unclosed\n");

    const r = await c.c.query<{
      broken: Array<{ id: string; name: string }>;
    }>("scouts.fleet");

    expect(r.result!.data.broken).toEqual([
      { id: a.id, name: "A" },
      { id: "torn.yaml", name: "torn.yaml" },
    ]);
  });
});
