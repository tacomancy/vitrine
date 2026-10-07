import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ScoutActivity } from "./scout-activity.js";
import {
  closeCores,
  core,
  fixtureCopy,
  fixtures,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// What a row on Scout Activity needs in order to act (#520; ADR 0042 decision
// 5): the fields its edit writes back through `scouts.save`, whether it is
// paused, and which cadences would make it due at the next check. Driven
// through the router on a temp vault with an injected clock and arXiv client;
// what is asserted is what a row says, never how it came to.

const START = Date.parse("2026-09-30T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A Scout file as someone would write it by hand. */
const scoutYaml = (
  name: string,
  fields: { cadence?: string; lane?: string; extra?: string[] } = {}
) =>
  [
    `name: ${name}`,
    `cadence: ${fields.cadence ?? "daily"}`,
    `lane: ${fields.lane ?? "review"}`,
    "created: 2026-09-20T00:00:00Z",
    ...(fields.extra ?? []),
    "filter:",
    "  query: all:sleep",
    "",
  ].join("\n");

async function opened(
  scouts: Record<string, string>,
  /** The same vault and clock, as the app opens them again after it closed. */
  again?: { vault: string; at: number }
) {
  const vault = again?.vault ?? (await fixtureCopy("obsidian-vault"));
  for (const [file, text] of Object.entries(scouts)) {
    const path = join(vault, ".vitrine/scouts", file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  let at = again?.at ?? START;
  const empty = await readFile(join(fixtures, "arxiv", "empty.xml"), "utf8");
  const c = await core({
    now: () => new Date(at),
    arxiv: {
      clock: virtualClock(),
      fetch: () => Promise.resolve(new Response(empty)),
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  return {
    c,
    vault,
    /** The app closed and opened on the same vault: what is still there is what was written. */
    reopen: async () => {
      await closeCores();
      return opened({}, { vault, at });
    },
    advance: (ms: number) => void (at += ms),
    run: async (scoutId: string) => {
      const r = await c.mutate("scouts.runNow", { scoutId });
      expect(r.error).toBeUndefined();
    },
    rows: async () => {
      const r = await c.query<ScoutActivity>("scouts.activity");
      expect(r.error).toBeUndefined();
      return r.result!.data.rows.flatMap((row) =>
        row.kind === "scout" ? [row] : []
      );
    },
    file: (id: string) =>
      readFile(join(vault, ".vitrine/scouts", `${id}.yaml`), "utf8"),
  };
}

type Opened = Awaited<ReturnType<typeof opened>>;

describe("scouts.activity — what a row edits", () => {
  it("carries a Scout's Assigned Questions, its starting Lane and whether it is paused, as its file says", async () => {
    const f = await opened({
      "sleep.yaml": scoutYaml("Sleep", {
        lane: "skim",
        extra: [
          "paused: true",
          "assigned:",
          "  - rq2b7x9mk4",
          "  - q8d1c0aa11",
        ],
      }),
      "plain.yaml": scoutYaml("Plain"),
    });

    const rows = await f.rows();

    expect(
      rows.map((row) => ({
        id: row.id,
        assigned: row.assigned,
        lane: row.lane,
        paused: row.paused,
      }))
    ).toEqual([
      { id: "plain", assigned: [], lane: "review", paused: false },
      {
        id: "sleep",
        assigned: ["rq2b7x9mk4", "q8d1c0aa11"],
        lane: "skim",
        paused: true,
      },
    ]);
  });
});

// The cadence menu says, before anything is chosen, which choices would make
// the Scout run at the next check (story 55). It is the scheduler's own reading
// of due (`isDue`), asked once per option, so the menu and the write cannot
// disagree about what a change does.
describe("scouts.activity — which cadences would make a Scout due", () => {
  const dueUnder = async (f: Opened) =>
    (await f.rows()).map((row) => [row.id, row.dueUnder]);

  it("names the shorter cadences that have already elapsed since the Scout last looked", async () => {
    const f = await opened({
      "weekly.yaml": scoutYaml("Weekly", { cadence: "weekly" }),
      "monthly.yaml": scoutYaml("Monthly", { cadence: "monthly" }),
    });
    await f.run("weekly");
    await f.run("monthly");
    f.advance(10 * DAY);

    expect(await dueUnder(f)).toEqual([
      // Ten days is past a day and past a week; a weekly Scout is due already.
      ["monthly", ["daily", "weekly"]],
      ["weekly", []],
    ]);
  });

  it("names only the shorter cadence a Scout that looked two days ago has outlasted", async () => {
    const f = await opened({
      "weekly.yaml": scoutYaml("Weekly", { cadence: "weekly" }),
    });
    await f.run("weekly");
    f.advance(2 * DAY);

    expect(await dueUnder(f)).toEqual([["weekly", ["daily"]]]);
  });

  it("names nothing for a Scout that looked a moment ago", async () => {
    const f = await opened({
      "weekly.yaml": scoutYaml("Weekly", { cadence: "weekly" }),
    });
    await f.run("weekly");
    f.advance(2 * HOUR);

    expect(await dueUnder(f)).toEqual([["weekly", []]]);
  });

  it("names nothing for a Scout that is due already, or that has never looked, or that is paused", async () => {
    const f = await opened({
      "never.yaml": scoutYaml("Never", { cadence: "weekly" }),
      "paused.yaml": scoutYaml("Paused", {
        cadence: "weekly",
        extra: ["paused: true"],
      }),
    });
    await f.run("paused");
    f.advance(2 * DAY);

    expect(await dueUnder(f)).toEqual([
      ["never", []],
      ["paused", []],
    ]);
  });
});

// The row's *edit* is the Queue form's own write (spec #511 story 49), fed from
// what the row carries: so a Query edited from a row changes the Query, runs
// the Scout, and leaves everything else in the file as it was.
describe("a Query edited from its row", () => {
  const HAND = (query: string) =>
    [
      "# Watching sleep for the lab",
      "name: Sleep and memory",
      "cadence: weekly # slow on purpose",
      "lane: skim",
      "created: 2026-09-20T00:00:00Z",
      "cap: 40",
      "assigned:",
      "  - rq2b7x9mk4",
      "filter:",
      `  query: ${query}`,
      "",
    ].join("\n");

  it("writes the Query and nothing else, keeps the comments and unknown keys, and runs the Scout at once", async () => {
    const f = await opened({ "sleep.yaml": HAND("all:sleep") });
    const [row] = await f.rows();

    const saved = await f.c.mutate<{
      id: string;
      run: { outcome: string } | null;
    }>("scouts.save", {
      id: row!.id,
      name: row!.name,
      watching: row!.source.kind,
      query: "all:sleep AND all:rem",
      cadence: row!.cadence,
      assigned: row!.assigned,
      lane: row!.lane,
      searchBackTo: null,
    });

    expect(saved.error).toBeUndefined();
    expect(await f.file("sleep")).toBe(HAND("all:sleep AND all:rem"));
    // It ran as the form's save runs it, and its row now says it looked.
    expect(saved.result!.data.run).toMatchObject({ outcome: "ok" });
    const [after] = await f.rows();
    expect(after).toMatchObject({
      source: { kind: "arxiv", query: "all:sleep AND all:rem" },
      lastRun: { ago: "just now" },
    });
  });
});

describe("a pause from its row", () => {
  const ran = async () => {
    const f = await opened({ "sleep.yaml": scoutYaml("Sleep") });
    await f.run("sleep");
    f.advance(HOUR);
    return f;
  };
  const voice = async (f: Opened) => {
    const [row] = await f.rows();
    return [row!.paused, row!.health];
  };
  const LOOKING = [
    false,
    {
      voice: "claim",
      warrant: {
        finished: new Date(START).toISOString(),
        fragments: ["newest run 1h ago", "parsed cleanly", "no baseline yet"],
      },
    },
  ];
  const PAUSED = [
    true,
    { voice: "not yet", sentence: "Paused — it is not looking." },
  ];

  it("shows in the row's Voice at once, and a resume takes it back", async () => {
    const f = await ran();
    expect(await voice(f)).toEqual(LOOKING);

    await f.c.mutate("scouts.setPaused", { scoutId: "sleep", paused: true });
    expect(await voice(f)).toEqual(PAUSED);

    await f.c.mutate("scouts.setPaused", { scoutId: "sleep", paused: false });
    expect(await voice(f)).toEqual(LOOKING);
  });

  it("is still there when the vault is opened again", async () => {
    const f = await ran();
    await f.c.mutate("scouts.setPaused", { scoutId: "sleep", paused: true });

    const again = await f.reopen();

    expect(await voice(again)).toEqual(PAUSED);
  });
});
