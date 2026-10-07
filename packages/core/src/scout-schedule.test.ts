import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LooseEnds } from "./loose-ends.js";
import type { Health } from "./scout-health.js";
import type { Card, RunSummary } from "./scouts.js";
import {
  closeCores,
  core,
  fixtureCopy,
  fixtures,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// Beat 6's second slice (#449): Scouts run when due, and each says how it is
// doing in one of three voices. Driven through the router with an injected
// `now`, fetch and clock; history is seeded as run rows because the thing
// under test is what the rows mean, not how a run came to write them.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = new Date("2026-09-20T00:00:00Z");

const atom = (name: string) =>
  readFile(join(fixtures, "arxiv", `${name}.xml`), "utf8");

const scoutYaml = (
  over: {
    cadence?: string;
    query?: string;
    paused?: boolean;
    dropped?: boolean;
  } = {}
) =>
  [
    "name: Sleep and memory",
    `cadence: ${over.cadence ?? "daily"}`,
    "lane: review",
    "created: 2026-09-20T00:00:00Z",
    ...(over.paused ? ["paused: true"] : []),
    ...(over.dropped ? ["dropped: 2026-09-25T00:00:00Z"] : []),
    "filter:",
    `  query: ${over.query ?? "all:sleep"}`,
    "",
  ].join("\n");

// The only kind of Scout that can be refused for want of a key (ADR 0040).
const watchedYaml = (name: string) =>
  [
    `name: ${name}`,
    "source:",
    "  kind: watched",
    "  url: https://lab.example/publications",
    "cadence: daily",
    "lane: review",
    "created: 2026-09-20T00:00:00Z",
    "",
  ].join("\n");

type Answer = (url: URL) => Response | Promise<Response>;
type Seed = {
  scout?: string;
  started: number;
  outcome?: "ok" | "failed";
  kind?: string;
  message?: string;
  new?: number;
  query?: string;
  retroactive?: boolean;
  from?: number | undefined;
  unfinished?: boolean;
};

async function fleet(
  answer: Answer,
  scouts: Record<string, string> = { "sleep.yaml": scoutYaml() },
  clockAt = START.getTime() + 10 * DAY
) {
  const vault = await fixtureCopy("obsidian-vault");
  for (const [file, text] of Object.entries(scouts)) {
    const path = join(vault, ".vitrine/scouts", file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  let at = clockAt;
  const requests: URL[] = [];
  const clock = virtualClock();
  const options = (scoutCheckMs?: number) => ({
    now: () => new Date(at),
    ...(scoutCheckMs === undefined ? {} : { scoutCheckMs }),
    arxiv: {
      clock,
      fetch: async (input: string | URL | Request) => {
        const url = urlOf(input);
        requests.push(url);
        return answer(url);
      },
    },
  });
  let stream: Awaited<ReturnType<Awaited<ReturnType<typeof core>>["events"]>>;
  const start = async (scoutCheckMs?: number) => {
    const c = await core(options(scoutCheckMs));
    // Before the open: a scheduled check starts as the vault does, and an
    // event raised before anyone listens is gone.
    if (scoutCheckMs !== undefined) stream = await c.events();
    expect(
      (await c.mutate("vault.open", { path: vault })).error
    ).toBeUndefined();
    await c.indexed();
    opened = true;
    for (const r of waiting.splice(0)) insert(r);
    return c;
  };
  const dbPath = join(vault, ".vitrine/queue.sqlite");
  const write = (sql: string, ...args: Array<string | number | null>) => {
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare(sql).run(...args);
    } finally {
      db.close();
    }
  };
  const rows = <T>(sql: string): T[] => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return db.prepare(sql).all() as T[];
    } finally {
      db.close();
    }
  };
  /** Insert a run the way a past check would have left it. */
  const waiting: Seed[] = [];
  let opened = false;
  const insert = (r: Seed) => {
    const started = new Date(r.started).toISOString();
    const finished = r.unfinished
      ? null
      : new Date(r.started + 60_000).toISOString();
    write(
      `INSERT INTO scout_runs (scout_id, started, finished, outcome, error_kind, error_message, window_from, window_to, retroactive, new, query)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      r.scout ?? "sleep",
      started,
      finished,
      r.unfinished ? null : (r.outcome ?? "ok"),
      r.kind ?? null,
      r.message ?? null,
      new Date(r.from ?? r.started - DAY).toISOString(),
      started,
      r.retroactive ? 1 : 0,
      r.new ?? 0,
      r.query ?? "all:sleep"
    );
  };
  // The tables exist once the vault has been opened; a seed asked for before
  // that waits for it, so a test reads top to bottom as history then check.
  const seed = (r: Seed) => (opened ? insert(r) : void waiting.push(r));
  return {
    vault,
    requests,
    clock,
    get stream() {
      return stream;
    },
    rows,
    seed,
    start,
    set: (ms: number) => void (at = ms),
    get at() {
      return at;
    },
    health: async (c: Awaited<ReturnType<typeof start>>) => {
      const r = await c.query<{
        scouts: Array<{ id: string; health: Health }>;
        unreadable: Array<{ file: string; health: Health }>;
      }>("scouts.health");
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    check: async (c: Awaited<ReturnType<typeof start>>) => {
      const r = await c.mutate<string[]>("scouts.checkDue");
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
  };
}

const serving =
  (name: string): Answer =>
  async () =>
    new Response(await atom(name));

describe("when a Scout is due", () => {
  it("is when its cadence has elapsed since its last completed run, and never before", async () => {
    const f = await fleet(serving("empty"));
    f.seed({ started: f.at - 23 * HOUR });
    const c = await f.start();

    expect(await f.check(c)).toEqual([]);
    f.set(f.at + 2 * HOUR);
    expect(await f.check(c)).toEqual(["sleep"]);
  });

  it("is at once for a Scout that has never run, and never for a paused one", async () => {
    const f = await fleet(serving("empty"), {
      "sleep.yaml": scoutYaml(),
      "rest.yaml": scoutYaml({ paused: true }),
    });
    const c = await f.start();

    expect(await f.check(c)).toEqual(["sleep"]);
  });

  it("is never for a dropped Scout, even one that has never run and so would be due at once", async () => {
    const f = await fleet(serving("empty"), {
      "sleep.yaml": scoutYaml(),
      "gone.yaml": scoutYaml({ dropped: true, query: "all:gone" }),
    });
    const c = await f.start();

    expect(await f.check(c)).toEqual(["sleep"]);

    // Not asked of arXiv either: a Scout that did not run left no request.
    expect(
      f.requests.map((url) => url.searchParams.get("search_query"))
    ).toEqual([expect.stringContaining("all:sleep")]);
    expect(
      f.rows<{ scout_id: string }>("SELECT scout_id FROM scout_runs")
    ).toEqual([{ scout_id: "sleep" }]);
  });

  it("is never for a dropped Scout whose cadence has long elapsed, until it is restored; then at the next check, and not at the restore itself", async () => {
    const f = await fleet(serving("empty"), {
      "sleep.yaml": scoutYaml({ dropped: true }),
    });
    f.seed({ started: f.at - 3 * DAY });
    const c = await f.start();

    expect(await f.check(c)).toEqual([]);

    expect(
      (await c.mutate("scouts.restore", { scoutId: "sleep" })).error
    ).toBeUndefined();
    expect(f.requests).toEqual([]);
    expect(await f.check(c)).toEqual(["sleep"]);
  });

  it("is not while a run of its own is still in flight", async () => {
    const f = await fleet(serving("empty"));
    f.seed({ started: f.at - 3 * DAY });
    // A run still in flight when the core starts would be closed as
    // interrupted; the row is added after the open to stand for one.
    const c = await f.start();
    f.seed({ started: f.at, unfinished: true });

    expect(await f.check(c)).toEqual([]);
  });
});

// One table for ADR 0039 decision 3 and ADR 0032: each error kind against
// the voice it speaks in, whether the next hourly check retries it, and the
// one sentence every surface renders.
describe("each failure kind", () => {
  const kinds = [
    {
      kind: "network",
      message: "arXiv could not be reached",
      retries: true,
      sentence: "arXiv could not be reached, so nothing was checked.",
    },
    {
      kind: "http",
      message: "HTTP 503",
      retries: true,
      sentence:
        "arXiv answered with an error (HTTP 503), so nothing was checked.",
    },
    {
      kind: "interrupted",
      message: "Vitrine closed before this check finished.",
      retries: true,
      sentence: "Vitrine closed before this check finished.",
    },
    {
      kind: "rate_limited",
      message: "HTTP 429",
      retries: false,
      sentence:
        "arXiv asked Vitrine to slow down (HTTP 429), so nothing was checked.",
    },
    {
      kind: "parse",
      message: "the answer was not an Atom feed",
      retries: false,
      sentence:
        "arXiv's answer did not read as a search result: the query may be malformed, or arXiv changed what it returns.",
    },
  ] as const;

  for (const k of kinds) {
    it(`${k.kind}: is wrong in one sentence, and ${k.retries ? "retries at the next hourly check" : "waits a full cadence from the attempt"}`, async () => {
      const f = await fleet(serving("empty"));
      f.seed({ started: f.at - 3 * DAY, new: 1 });
      f.seed({
        started: f.at - 2 * HOUR,
        outcome: "failed",
        kind: k.kind,
        message: k.message,
      });
      const c = await f.start();

      const [only] = (await f.health(c)).scouts;
      expect(only!.health).toEqual({
        voice: "wrong",
        kind: k.kind,
        sentence: k.sentence,
      });

      const ran = await f.check(c);
      expect(ran).toEqual(k.retries ? ["sleep"] : []);
      if (!k.retries) {
        // Waiting is for one cadence from the attempt, not for ever.
        f.set(f.at + 23 * HOUR);
        expect(await f.check(c)).toEqual(["sleep"]);
      }
    });
  }

  it("a failed run does not complete: the cadence is read off the last ok run", async () => {
    const f = await fleet(serving("empty"));
    // Failed 30 minutes ago, but the last clean run is 5 days old.
    f.seed({ started: f.at - 5 * DAY });
    f.seed({
      started: f.at - 30 * 60_000,
      outcome: "failed",
      kind: "network",
    });
    const c = await f.start();

    expect(await f.check(c)).toEqual(["sleep"]);
  });

  it("parse gains its second clause when the Query was edited since the last clean run", async () => {
    const f = await fleet(serving("empty"), {
      "sleep.yaml": scoutYaml({ query: "all:sleep AND all:replay" }),
    });
    f.seed({ started: f.at - 3 * DAY, query: "all:sleep" });
    f.seed({
      started: f.at - 2 * HOUR,
      outcome: "failed",
      kind: "parse",
      query: "all:sleep",
    });
    const c = await f.start();

    const [only] = (await f.health(c)).scouts;
    expect(only!.health.voice).toBe("wrong");
    expect((only!.health as { sentence: string }).sentence).toContain(
      "Its query changed since it last ran cleanly."
    );
    // Saving the edit overrides the wait the failed attempt had set.
    expect(await f.check(c)).toEqual(["sleep"]);
  });

  it("no sentence names a path or anything about the machine", () => {
    for (const k of kinds) {
      expect(k.sentence).not.toMatch(/\/|\\|Users|\.sqlite|\.yaml/);
    }
  });
});

describe("a check", () => {
  it("closes every run with no finish as failed, interrupted, before the first check", async () => {
    const f = await fleet(serving("empty"));
    f.seed({ started: f.at - 3 * DAY });
    // The core that wrote this row is gone: opening the vault is the start.
    const first = await f.start();
    await first.close();
    f.seed({ started: f.at - 2 * HOUR, unfinished: true });

    await f.start(HOUR);
    // The first event is the closed run's own, raised before any check.
    const closedRun = await f.stream.next("scoutFinished");
    expect(closedRun.runId).toBe(
      f.rows<{ id: number }>(
        "SELECT id FROM scout_runs WHERE error_kind = 'interrupted'"
      )[0]!.id
    );
    f.stream.close();

    const [closed] = f.rows<{
      outcome: string;
      error_kind: string;
      finished: string;
    }>(
      "SELECT outcome, error_kind, finished FROM scout_runs WHERE error_kind = 'interrupted'"
    );
    expect(closed).toMatchObject({
      outcome: "failed",
      error_kind: "interrupted",
    });
    expect(closed!.finished).toBeTruthy();
  });

  it("runs on vault open, and again on the hourly interval, when scheduled runs are on", async () => {
    const f = await fleet(serving("empty"));
    await f.start(50);
    // Opening ran it; the interval is a second run once it is due again.
    await f.stream.next("scoutFinished");
    f.set(f.at + 2 * DAY);
    await f.stream.next("scoutFinished");
    f.stream.close();

    expect(
      f.rows<{ n: number }>("SELECT COUNT(*) AS n FROM scout_runs")[0]!.n
    ).toBeGreaterThanOrEqual(2);
  });

  it("does not advance window_to when it fails, and the next attempt re-covers the window without a second card", async () => {
    let failing = true;
    const f = await fleet(async () =>
      failing
        ? new Response("", { status: 503 })
        : new Response(await atom("normal"))
    );
    f.seed({ started: f.at - 3 * DAY });
    const c = await f.start();
    const lastClean = f.rows<{ window_to: string }>(
      "SELECT window_to FROM scout_runs"
    )[0]!.window_to;

    expect(await f.check(c)).toEqual(["sleep"]);
    f.set(f.at + HOUR);
    failing = false;
    expect(await f.check(c)).toEqual(["sleep"]);
    f.set(f.at + 2 * DAY);
    expect(await f.check(c)).toEqual(["sleep"]);

    const runs = f.rows<{ outcome: string; window_from: string }>(
      "SELECT outcome, window_from FROM scout_runs ORDER BY id"
    );
    expect(runs.map((r) => r.outcome)).toEqual(["ok", "failed", "ok", "ok"]);
    // The failed attempt and the one that followed asked for the same days.
    expect(runs[1]!.window_from).toBe(lastClean);
    expect(runs[2]!.window_from).toBe(lastClean);
    // The overlap is harmless: identity by arxiv_id means one card per paper.
    const cards = (await c.query<Card[]>("scouts.queue")).result!.data;
    expect(new Set(cards.map((x) => x.id)).size).toBe(cards.length);
    expect(cards).toHaveLength(2);
  });

  it("folds the days the app was closed into one run with nothing lost", async () => {
    const f = await fleet(serving("empty"));
    f.seed({ started: f.at - 6 * DAY });
    const c = await f.start();
    const before = f.rows<{ window_to: string }>(
      "SELECT window_to FROM scout_runs"
    )[0]!.window_to;

    expect(await f.check(c)).toEqual(["sleep"]);
    expect(await f.check(c)).toEqual([]);

    const runs = f.rows<{ window_from: string; window_to: string }>(
      "SELECT window_from, window_to FROM scout_runs ORDER BY id"
    );
    expect(runs).toHaveLength(2);
    expect(runs[1]).toEqual({
      window_from: before,
      window_to: new Date(f.at).toISOString(),
    });
  });

  it("queues ten Scouts due at once on the one client, in creation order", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      const id = `scout-${String(i).padStart(2, "0")}`;
      files[`${id}.yaml`] = scoutYaml({ query: `all:topic${i}` }).replace(
        "created: 2026-09-20T00:00:00Z",
        // Reverse alphabetical creation, so file order and creation order differ.
        `created: 2026-09-${String(20 + (9 - i)).padStart(2, "0")}T00:00:00Z`
      );
    }
    const f = await fleet(serving("empty"), files, START.getTime() + 20 * DAY);
    const c = await f.start();

    const ran = await f.check(c);
    expect(ran).toEqual(
      Array.from(
        { length: 10 },
        (_, i) => `scout-${String(9 - i).padStart(2, "0")}`
      )
    );
    expect(f.requests).toHaveLength(10);
    // Nine gaps of the ToU's three seconds between ten requests.
    expect(f.clock.slept.filter((ms) => ms === 3000)).toHaveLength(9);
  });

  it("raises scoutFinished once per run, failed or interrupted too", async () => {
    const f = await fleet(() =>
      Promise.resolve(new Response("", { status: 503 }))
    );
    const c = await f.start();
    const events = await c.events();

    const r = await c.mutate<RunSummary>("scouts.runNow", { scoutId: "sleep" });
    const finished = await events.next("scoutFinished");
    events.close();

    expect(r.result!.data.outcome).toBe("failed");
    expect(finished).toEqual({
      type: "scoutFinished",
      scoutId: "sleep",
      runId: r.result!.data.runId,
    });
  });
});

describe("how a Scout says it is doing", () => {
  it("is not yet, with the reason, for a Scout with no runs and for a paused one", async () => {
    const f = await fleet(serving("empty"), {
      "new.yaml": scoutYaml(),
      "rest.yaml": scoutYaml({ paused: true }),
    });
    f.seed({
      scout: "rest",
      started: f.at - DAY,
      outcome: "failed",
      kind: "network",
    });
    const c = await f.start();

    const { scouts } = await f.health(c);
    expect(scouts.find((s) => s.id === "new")!.health).toEqual({
      voice: "not yet",
      sentence: "It has not run yet.",
    });
    // Paused wins over a failure the researcher has already answered by pausing.
    expect(scouts.find((s) => s.id === "rest")!.health).toEqual({
      voice: "not yet",
      sentence: "Paused — it is not looking.",
    });
  });

  it("claims without a warrant when the newest run found something", async () => {
    const f = await fleet(serving("empty"));
    f.seed({ started: f.at - 2 * DAY, new: 2 });
    const c = await f.start();

    expect((await f.health(c)).scouts[0]!.health).toEqual({
      voice: "claim",
      warrant: null,
    });
  });

  it("a Quiet field's Warrant carries the newest finish, that it parsed cleanly, and no baseline under three ok runs", async () => {
    const f = await fleet(serving("empty"));
    f.seed({ started: f.at - 3 * DAY, new: 1 });
    f.seed({ started: f.at - 2 * HOUR });
    const c = await f.start();

    const { health } = (await f.health(c)).scouts[0]!;
    expect(health).toEqual({
      voice: "claim",
      warrant: {
        finished: new Date(f.at - 2 * HOUR + 60_000).toISOString(),
        fragments: ["newest run 1h ago", "parsed cleanly", "no baseline yet"],
      },
    });
  });

  it("names the runs the usual rate rests on, and its unit follows its magnitude", async () => {
    const rateOf = async (finds: number, runs: number, spanDays: number) => {
      const f = await fleet(serving("empty"));
      for (let i = 0; i < runs; i++) {
        const started =
          f.at - (runs - 1 - i) * (spanDays / (runs - 1)) * DAY - HOUR;
        f.seed({
          started,
          new: i < finds ? 1 : 0,
          from: i === 0 ? started - (spanDays / (runs - 1)) * DAY : undefined,
        });
      }
      const c = await f.start();
      const { health } = (await f.health(c)).scouts[0]!;
      return health.voice === "claim" ? health.warrant?.fragments[2] : health;
    };

    // The unit follows the magnitude, and the runs it rests on are named.
    expect(await rateOf(0, 6, 7)).toMatch(/^nothing found yet \(6 runs\)$/);
    expect(await rateOf(1, 3, 90)).toMatch(/^usually ~1 a quarter \(3 runs\)$/);
    expect(await rateOf(3, 4, 30)).toMatch(/^usually ~2 a month \(4 runs\)$/);
  });

  it("states a rate per week at one or more a week", async () => {
    const f = await fleet(serving("empty"));
    // Daily runs for a week, the newest quiet: 6 of the 7 found something.
    for (let i = 0; i < 7; i++) {
      f.seed({
        started: f.at - (6 - i) * DAY - HOUR,
        new: i < 6 ? 1 : 0,
        from: f.at - (7 - i) * DAY - HOUR,
      });
    }
    const c = await f.start();

    const { health } = (await f.health(c)).scouts[0]!;
    expect(health).toMatchObject({
      voice: "claim",
      warrant: {
        fragments: [
          expect.any(String),
          "parsed cleanly",
          "usually ~6 a week (7 runs)",
        ],
      },
    });
  });

  it("a Scout file that does not parse is wrong by its file's name and the line, with no kind and no path", async () => {
    const f = await fleet(serving("empty"), {
      "good.yaml": scoutYaml(),
      "bad.yaml": "name: Broken\ncadence: [daily\nfilter:\n  query: x\n",
    });
    const c = await f.start();

    const { unreadable, scouts } = await f.health(c);
    expect(scouts.map((s) => s.id)).toEqual(["good"]);
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0]!.file).toBe("bad.yaml");
    const health = unreadable[0]!.health;
    expect(health).toMatchObject({ voice: "wrong", kind: null });
    expect((health as { sentence: string }).sentence).toMatch(
      /^This file could not be read: line \d+ is not valid YAML\.$/
    );
    expect(JSON.stringify(unreadable)).not.toContain(f.vault);
  });
});

// Beat 9's prefactor (#512; ADR 0042 decision 6): a *no key* run went no
// further than the missing key, so it is no check of the field, and a Scout
// waiting on a key must never read as having looked. Its row is there so that
// *blocked on credentials* is derived from rows (ADR 0040 decision 1). Seeded
// like the block above, because what is under test is what the rows mean; that
// a due Scout with no key leaves one is `watched.test.ts`'s.
describe("a no-key run", () => {
  type Fleet = Awaited<ReturnType<typeof fleet>>;
  // What `queue.sqlite` holds for a Scout that was due and found no key. The
  // message is spelled out because it is stored: renaming it must fail here.
  const refused = {
    outcome: "failed",
    kind: "credentials",
    message: "no key",
  } as const;
  // Before a Scout's first clean read there is nothing to be after, so the
  // row is Retroactive, as a real one is.
  const refusedFirst = { ...refused, retroactive: true } as const;
  const NOT_YET = {
    voice: "not yet",
    kind: "credentials",
    sentence: "No model key is stored, so this page has not been read yet.",
  };

  // A page has no date window, so each run is an instant. The first takes in
  // everything the page lists (Retroactive); the next four find something on
  // alternate days.
  const readCleanly = (f: Fleet, scout: string) => {
    for (const { daysAgo, found } of [
      { daysAgo: 8, found: 3 },
      { daysAgo: 7, found: 1 },
      { daysAgo: 6, found: 0 },
      { daysAgo: 5, found: 1 },
      { daysAgo: 4, found: 0 },
    ]) {
      const at = f.at - daysAgo * DAY;
      f.seed({
        scout,
        started: at,
        from: at,
        new: found,
        retroactive: daysAgo === 8,
      });
    }
  };
  // The key is stored again and the Scout reads at once; nothing new.
  const readQuietly = (f: Fleet, scout: string) => {
    const at = f.at - 3 * HOUR;
    f.seed({ scout, started: at, from: at });
  };

  it("leaves a Scout whose only runs were refused not yet, with why, and with no Warrant or baseline", async () => {
    const f = await fleet(serving("empty"), {
      "lab.yaml": watchedYaml("Sleep Lab"),
    });
    for (const daysAgo of [3, 2, 1]) {
      f.seed({ scout: "lab", started: f.at - daysAgo * DAY, ...refusedFirst });
    }
    const c = await f.start();

    expect((await f.health(c)).scouts.map((s) => s.health)).toEqual([NOT_YET]);
  });

  it("says the same of a Scout that was reading cleanly until its key went missing, and shows none of the baseline it had", async () => {
    const f = await fleet(serving("empty"), {
      "plain.yaml": watchedYaml("Plain Lab"),
      "lab.yaml": watchedYaml("Sleep Lab"),
    });
    readCleanly(f, "plain");
    readCleanly(f, "lab");
    for (const daysAgo of [3, 2]) {
      f.seed({ scout: "lab", started: f.at - daysAgo * DAY, ...refused });
    }
    const c = await f.start();

    const { scouts } = await f.health(c);
    // The history is one that warrants a claim: the Scout without a no-key
    // run makes it, with a baseline over its five runs.
    expect(scouts.find((s) => s.id === "plain")!.health).toMatchObject({
      voice: "claim",
      warrant: {
        fragments: [
          expect.any(String),
          "parsed cleanly",
          expect.stringMatching(/^usually ~\d+ a week \(5 runs\)$/),
        ],
      },
    });
    // A no-key run is the newest thing it said, so it speaks as a Scout that
    // has not looked: *not yet* with the reason, and no Warrant (ADR 0032
    // decision 2). The baseline is not lost, only not asserted while it waits.
    expect(scouts.find((s) => s.id === "lab")!.health).toEqual(NOT_YET);
  });

  it("keeps the baseline a Scout had before, with the same run count, once it reads again", async () => {
    const f = await fleet(serving("empty"), {
      "plain.yaml": watchedYaml("Plain Lab"),
      "lost.yaml": watchedYaml("Lost Lab"),
      "waited.yaml": watchedYaml("Waited Lab"),
    });
    readCleanly(f, "plain");
    readQuietly(f, "plain");
    // The key went missing for two checks, then came back.
    readCleanly(f, "lost");
    for (const daysAgo of [3, 2]) {
      f.seed({ scout: "lost", started: f.at - daysAgo * DAY, ...refused });
    }
    readQuietly(f, "lost");
    // The key was not there for its first two checks, which is how a page's
    // Scout is first made, and the first clean read is then its first run.
    for (const daysAgo of [10, 9]) {
      f.seed({
        scout: "waited",
        started: f.at - daysAgo * DAY,
        ...refusedFirst,
      });
    }
    readCleanly(f, "waited");
    readQuietly(f, "waited");
    const c = await f.start();

    // Six clean runs, two of which found something once the first (which
    // took in the whole page) is set aside: the no-key runs are in neither
    // the count nor the rate, wherever they sit, so each Scout reads exactly
    // as the one that never lost its key.
    const reads = {
      voice: "claim",
      warrant: {
        finished: new Date(f.at - 3 * HOUR + 60_000).toISOString(),
        fragments: [
          "newest run 2h ago",
          "parsed cleanly",
          "usually ~2 a week (6 runs)",
        ],
      },
    };
    const { scouts } = await f.health(c);
    expect(Object.fromEntries(scouts.map((s) => [s.id, s.health]))).toEqual({
      plain: reads,
      lost: reads,
      waited: reads,
    });
  });

  it("is worded in Loose Ends exactly as the Queue's rail words it, whichever way the Scout came to be waiting", async () => {
    const f = await fleet(serving("empty"), {
      "fresh.yaml": watchedYaml("Fresh Lab"),
      "lab.yaml": watchedYaml("Sleep Lab"),
    });
    f.seed({ scout: "fresh", started: f.at - 2 * DAY, ...refusedFirst });
    readCleanly(f, "lab");
    f.seed({ scout: "lab", started: f.at - 2 * DAY, ...refused });
    const c = await f.start();

    const rail = Object.fromEntries(
      (await f.health(c)).scouts.map((s) => [s.id, s.health])
    );
    expect(rail).toEqual({ fresh: NOT_YET, lab: NOT_YET });

    // One row each, and never a second for the same wait: the sentence is
    // the rail's, not a wording of its own.
    const ends = await c.query<LooseEnds>("looseEnds.rows");
    expect(ends.error).toBeUndefined();
    const ours = ends
      .result!.data.groups.flatMap((g) => g.rows)
      .filter((r) => r.subject === "fresh" || r.subject === "lab")
      .sort((a, b) => a.subject.localeCompare(b.subject));
    expect(ours).toEqual([
      {
        kind: "blocked-on-credentials",
        subject: "fresh",
        path: ".vitrine/scouts/fresh.yaml",
        title: "Fresh Lab",
        voice: "not yet",
        sentence: NOT_YET.sentence,
      },
      {
        kind: "blocked-on-credentials",
        subject: "lab",
        path: ".vitrine/scouts/lab.yaml",
        title: "Sleep Lab",
        voice: "not yet",
        sentence: NOT_YET.sentence,
      },
    ]);
  });
});
