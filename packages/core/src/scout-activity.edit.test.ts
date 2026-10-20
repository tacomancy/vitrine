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

// What a row on Scout Activity needs in order to act (#520; spec #511): the
// fields its edit writes back through `scouts.save`, whether it is paused, and
// which cadences would make it due at the next check. Driven
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

// A Tag Filter on a row (#691; spec #678 decision 10): the Filter a row shows
// is the Tags as written, the compiled query is one step deeper, and the edit
// row saves a changed list through the same `scouts.save` as the form.
describe("scouts.activity — a Tag Filter", () => {
  const TAGGED = (...tags: string[]) =>
    [
      "name: Probing",
      "cadence: daily",
      "lane: review",
      "created: 2026-09-20T00:00:00Z",
      "filter:",
      "  tags:",
      ...tags.map((t) => `    - ${t}`),
      "",
    ].join("\n");

  async function seeded(tags: string[]) {
    const f = await opened({ "probing.yaml": TAGGED(...tags) });
    for (const tag of ["ml/probing", "ml/saes"]) {
      expect(
        (await f.c.mutate("lexicon.seed", { tag, term: `${tag} term` })).error
      ).toBeUndefined();
    }
    return f;
  }

  it("shows the Tags as the Filter, with no query of its own", async () => {
    const f = await opened({ "probing.yaml": TAGGED("ml/probing", "ml/saes") });
    const [row] = await f.rows();
    expect(row!.source).toEqual({
      kind: "arxiv",
      query: "",
      tags: ["ml/probing", "ml/saes"],
    });
  });

  it("gives a Query Scout no Tags", async () => {
    const f = await opened({ "sleep.yaml": scoutYaml("Sleep") });
    const [row] = await f.rows();
    expect(row!.source).toEqual({
      kind: "arxiv",
      query: "all:sleep",
      tags: null,
    });
  });

  it("says the compiled query verbatim on demand, as a run would ask it now", async () => {
    const f = await seeded(["ml/probing"]);
    const r = await f.c.query<string>("scouts.compiled", {
      tags: ["ml/probing", "ml/saes"],
    });
    expect(r.error).toBeUndefined();
    expect(r.result!.data).toBe(
      'abs:"ml probing term" OR ti:"ml probing term" OR abs:"ml saes term" OR ti:"ml saes term"'
    );
  });

  it("refuses by name a Tag with nothing to compile", async () => {
    const f = await seeded(["ml/probing"]);
    const r = await f.c.query("scouts.compiled", { tags: ["nope"] });
    expect(r.error?.message).toContain("Tag nope is gone");
  });

  it("saves a changed Tag list through scouts.save, keeps the Scout, and runs it once", async () => {
    const f = await seeded(["ml/probing"]);
    const [row] = await f.rows();

    const saved = await f.c.mutate<{ run: { outcome: string } | null }>(
      "scouts.save",
      {
        id: row!.id,
        name: row!.name,
        watching: "arxiv",
        query: "",
        tags: ["ml/probing", "ml/saes"],
        cadence: row!.cadence,
        assigned: row!.assigned,
        lane: row!.lane,
        searchBackTo: null,
      }
    );

    expect(saved.error).toBeUndefined();
    expect(saved.result!.data.run).toMatchObject({ outcome: "ok" });
    expect(await f.file("probing")).toContain("- ml/saes");
    const [after] = await f.rows();
    expect(after!.source).toMatchObject({ tags: ["ml/probing", "ml/saes"] });
  });
});

// What a hand-written file is owed by a save that did not change a key: the
// key is not rewritten (ADR 0009). A list is a node the document replaces
// whole when it is set, so setting it to what it already was would lose a
// comment on it and the style it was written in, and would add the key to a
// file that never had one.
describe("a save that leaves the Assigned Questions as they were", () => {
  const FLOW = (query: string) =>
    [
      "name: Sleep and memory",
      "cadence: weekly",
      "lane: skim",
      "created: 2026-09-20T00:00:00Z",
      "assigned: [rq2b7x9mk4, k7m2p9q4wx] # the two I am chasing",
      "filter:",
      `  query: ${query}`,
      "",
    ].join("\n");
  const NONE_ASSIGNED = (query: string) =>
    [
      "name: Sleep and memory",
      "cadence: weekly",
      "lane: skim",
      "created: 2026-09-20T00:00:00Z",
      "filter:",
      `  query: ${query}`,
      "",
    ].join("\n");

  /** The row's own write, as the form would send it, with a new Query. */
  async function saveQuery(f: Opened, query: string) {
    const [row] = await f.rows();
    const saved = await f.c.mutate("scouts.save", {
      id: row!.id,
      name: row!.name,
      watching: row!.source.kind,
      query,
      cadence: row!.cadence,
      assigned: row!.assigned,
      lane: row!.lane,
      searchBackTo: null,
    });
    expect(saved.error).toBeUndefined();
  }

  it("keeps a comment on the key and the style the list was written in", async () => {
    const f = await opened({ "sleep.yaml": FLOW("all:sleep") });

    await saveQuery(f, "all:sleep AND all:rem");

    expect(await f.file("sleep")).toBe(FLOW("all:sleep AND all:rem"));
  });

  it("does not add the key to a file that never had one", async () => {
    const f = await opened({ "sleep.yaml": NONE_ASSIGNED("all:sleep") });

    await saveQuery(f, "all:sleep AND all:rem");

    expect(await f.file("sleep")).toBe(NONE_ASSIGNED("all:sleep AND all:rem"));
  });

  // One Question for another leaves the list as long as it was: a comparison of
  // lengths, or of the first item, would call it unchanged and lose the edit.
  it("still writes them when one Question was swapped for another", async () => {
    const f = await opened({ "sleep.yaml": FLOW("all:sleep") });
    const [row] = await f.rows();

    await f.c.mutate("scouts.save", {
      id: row!.id,
      name: row!.name,
      watching: "arxiv",
      query: "all:sleep",
      cadence: row!.cadence,
      assigned: ["rq2b7x9mk4", "q8d1c0aa11"],
      lane: row!.lane,
      searchBackTo: null,
    });

    expect((await f.rows())[0]!.assigned).toEqual(["rq2b7x9mk4", "q8d1c0aa11"]);
  });

  it("still writes them when they did change", async () => {
    const f = await opened({ "sleep.yaml": FLOW("all:sleep") });
    const [row] = await f.rows();

    await f.c.mutate("scouts.save", {
      id: row!.id,
      name: row!.name,
      watching: "arxiv",
      query: "all:sleep",
      cadence: row!.cadence,
      assigned: ["k7m2p9q4wx"],
      lane: row!.lane,
      searchBackTo: null,
    });

    expect((await f.rows())[0]!.assigned).toEqual(["k7m2p9q4wx"]);
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
