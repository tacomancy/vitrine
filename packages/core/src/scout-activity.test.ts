import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ScoutActivity } from "./scout-activity.js";
import type { FleetHealth } from "./scout-health.js";
import {
  closeCores,
  core,
  fixtureCopy,
  fixtures,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// Scout Activity's tracer (#513; spec #511; ADR 0042): one read, `scouts.activity`,
// draws a row for every Scout the vault holds. Driven through the router on a
// temp vault with an injected clock and arXiv client, the way the Queue's own
// health is — and what is asserted is what a row says, never how it came to.

const START = Date.parse("2026-09-30T12:00:00Z");
const HOUR = 3_600_000;

const atom = (name: string) =>
  readFile(join(fixtures, "arxiv", `${name}.xml`), "utf8");

/** A Scout file as someone would write it by hand. */
const scoutYaml = (
  name: string,
  query: string,
  extra: Record<string, string> = {}
) =>
  [
    `name: ${name}`,
    `cadence: ${extra["cadence"] ?? "daily"}`,
    "lane: review",
    "created: 2026-09-20T00:00:00Z",
    ...(extra["paused"] === undefined ? [] : [`paused: ${extra["paused"]}`]),
    "filter:",
    `  query: ${query}`,
    "",
  ].join("\n");

type Answer = () => Response | Promise<Response>;

/**
 * A vault holding these Scout files and a core whose arXiv answers by Query:
 * `serve[<text in the Query>]` is what that Scout's next run is told, so each
 * Scout in a fleet can be given a different history through `runNow` alone.
 */
async function opened(scouts: Record<string, string>) {
  const vault = await fixtureCopy("obsidian-vault");
  for (const [file, text] of Object.entries(scouts)) {
    const path = join(vault, ".vitrine/scouts", file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  let at = START;
  const serve: Record<string, Answer> = {};
  const c = await core({
    now: () => new Date(at),
    arxiv: {
      clock: virtualClock(),
      fetch: async (input) => {
        const asked = urlOf(input).searchParams.get("search_query") ?? "";
        const key = Object.keys(serve).find((text) => asked.includes(text));
        if (key === undefined) throw new Error(`nothing serves ${asked}`);
        return serve[key]!();
      },
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  return {
    vault,
    serve,
    /** Move the injected clock on, so a run's age is a number a test chose. */
    advance: (ms: number) => void (at += ms),
    run: async (scoutId: string) => {
      const r = await c.mutate("scouts.runNow", { scoutId });
      expect(r.error).toBeUndefined();
    },
    activity: async () => {
      const r = await c.query<ScoutActivity>("scouts.activity");
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    /** The Queue rail's own read of the same fleet. */
    rail: async () => {
      const r = await c.query<FleetHealth>("scouts.health");
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
  };
}

const found = async () => new Response(await atom("normal"));
const nothing = async () => new Response(await atom("empty"));
const down = () => new Response("", { status: 503 });

/**
 * Three Scouts of three different health, left as a researcher would find
 * them: one whose last check failed, one that looked, found papers once and
 * has found nothing since, and one that is paused. The clock is read two
 * hours after the quiet one's last check and three after the failed one's.
 */
async function aFleet() {
  const f = await opened({
    "broken.yaml": scoutYaml("Broken by arXiv", "all:broken"),
    "quiet.yaml": scoutYaml("Quiet by design", "all:quiet"),
    "resting.yaml": scoutYaml("Resting", "all:resting", { paused: "true" }),
  });
  f.serve["all:broken"] = down;
  await f.run("broken");
  f.advance(HOUR);
  f.serve["all:quiet"] = found;
  await f.run("quiet");
  f.serve["all:quiet"] = nothing;
  await f.run("quiet");
  f.advance(2 * HOUR);
  return f;
}

describe("scouts.activity — a row for each readable Scout", () => {
  it("is one row for one Scout: what it is, what it watches, how often, and that it has not run", async () => {
    const f = await opened({
      "sleep.yaml": scoutYaml("Sleep and memory", "all:sleep"),
    });

    expect((await f.activity()).rows).toEqual([
      {
        kind: "scout",
        id: "sleep",
        name: "Sleep and memory",
        source: { kind: "arxiv", query: "all:sleep" },
        cadence: "daily",
        lastRun: null,
        health: { voice: "not yet", sentence: "It has not run yet." },
      },
    ]);
  });
});

describe("scouts.activity — what a Scout watches", () => {
  it("is the arXiv Query for one and the one page's address for a Watched source, each with its own cadence", async () => {
    const f = await opened({
      "arxiv.yaml": scoutYaml("Sleep", "all:sleep", { cadence: "weekly" }),
      "page.yaml": [
        "name: Lab publications",
        "cadence: monthly",
        "lane: skim",
        "created: 2026-09-20T00:00:00Z",
        "source:",
        "  kind: watched",
        "  url: https://lab.example/publications",
        "",
      ].join("\n"),
    });

    const { rows } = await f.activity();

    expect(
      rows.map((row) => row.kind === "scout" && [row.source, row.cadence])
    ).toEqual([
      [{ kind: "arxiv", query: "all:sleep" }, "weekly"],
      [{ kind: "watched", url: "https://lab.example/publications" }, "monthly"],
    ]);
    // A page saved but never checked says why it is quiet, in the rail's words.
    expect(rows[1]!.health).toEqual({
      voice: "not yet",
      sentence: "Not yet — first check due now.",
    });
  });
});

describe("scouts.activity — each Scout's Voice", () => {
  it("says a failed check in its one fault sentence, a quiet field as a claim with its warrant, and a paused Scout as not looking", async () => {
    const f = await aFleet();

    const { rows } = await f.activity();

    expect(rows.map((row) => row.kind === "scout" && row.name)).toEqual([
      "Broken by arXiv",
      "Quiet by design",
      "Resting",
    ]);
    expect(rows.map((row) => row.health)).toEqual([
      {
        voice: "wrong",
        kind: "http",
        sentence:
          "arXiv answered with an error (HTTP 503), so nothing was checked.",
      },
      {
        voice: "claim",
        warrant: {
          finished: new Date(START + HOUR).toISOString(),
          fragments: ["newest run 2h ago", "parsed cleanly", "no baseline yet"],
        },
      },
      { voice: "not yet", sentence: "Paused — it is not looking." },
    ]);
  });

  it("is the Queue rail's wording to the letter, so the two surfaces cannot describe one Scout two ways", async () => {
    const f = await aFleet();

    const { rows } = await f.activity();
    const rail = await f.rail();

    for (const row of rows) {
      if (row.kind !== "scout") throw new Error("a fleet of readable Scouts");
      expect(row.health).toEqual(
        rail.scouts.find((scout) => scout.id === row.id)!.health
      );
    }
  });

  it("names when each Scout last ran in the phrase its warrant uses, and says nothing for one that never has", async () => {
    const f = await aFleet();

    const { rows } = await f.activity();

    expect(rows.map((row) => row.kind === "scout" && row.lastRun)).toEqual([
      { finished: new Date(START).toISOString(), ago: "3h ago" },
      { finished: new Date(START + HOUR).toISOString(), ago: "2h ago" },
      null,
    ]);
  });
});

describe("scouts.activity — a Scout file that does not parse", () => {
  const unparseable = "name: Broken\ncadence: [daily\nfilter:\n  query: x\n";

  it("is a row by its file name in the wrong Voice, worded as the rail words it, and never names a path", async () => {
    const f = await opened({
      "good.yaml": scoutYaml("Good", "all:good"),
      "bad.yaml": unparseable,
    });

    const { rows } = await f.activity();
    const rail = await f.rail();

    expect(rows.map((row) => row.kind)).toEqual(["scout", "unreadable"]);
    const bad = rows[1]!;
    expect(bad).toEqual({
      kind: "unreadable",
      file: "bad.yaml",
      health: {
        voice: "wrong",
        kind: null,
        sentence: expect.stringMatching(
          /^This file could not be read: line \d+ is not valid YAML\.$/
        ) as string,
      },
    });
    expect(bad.health).toEqual(
      rail.unreadable.find((u) => u.file === "bad.yaml")!.health
    );
    expect(JSON.stringify(rows)).not.toContain(f.vault);
  });

  it("is still a row when it is the only Scout file there is, so a fleet it alone makes up is not an empty one", async () => {
    const f = await opened({ "bad.yaml": unparseable });

    const { rows } = await f.activity();

    expect(rows.map((row) => row.kind)).toEqual(["unreadable"]);
  });
});

describe("scouts.activity — nothing to draw", () => {
  it("is no rows for a vault with no Scouts", async () => {
    const f = await opened({});

    expect(await f.activity()).toEqual({ rows: [] });
  });

  it("answers an error, never an empty fleet, when no vault is open", async () => {
    const c = await core();

    const r = await c.query("scouts.activity");

    expect(r.result).toBeUndefined();
    expect(r.error?.message).toBe("No vault is open.");
  });
});
