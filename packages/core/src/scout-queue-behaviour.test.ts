import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Scout, UnreadableScout } from "./scout-file.js";
import type { Card } from "./scouts.js";
import {
  closeCores,
  core,
  fixtureCopy,
  fixtures,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// Queue behaviour on the Scout (#641; spec #639, ADR 0044 d.11): `cap`,
// `review_days` and `skim_days` in the file, edited on the form or by hand.
// Absent means the default, and a value that does not parse is named, never
// read as the default. Driven through the router on a temp vault.

const NOW = new Date("2026-09-30T12:00:00Z");
const DAY = 86_400_000;
const FOLDER = ".vitrine/scouts";

const scoutYaml = (extra: string[] = []) =>
  [
    "name: Sleep and memory",
    "cadence: daily",
    "lane: skim",
    "created: 2026-09-20T00:00:00Z",
    ...extra,
    "filter:",
    "  query: all:sleep",
    "",
  ].join("\n");

async function opened(text: string) {
  const vault = await fixtureCopy("obsidian-vault");
  const path = join(vault, FOLDER, "sleep.yaml");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  const atom = await readFile(join(fixtures, "arxiv", "normal.xml"), "utf8");
  const c = await core({
    now: () => NOW,
    arxiv: {
      clock: virtualClock(),
      fetch: () => Promise.resolve(new Response(atom)),
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  return {
    c,
    vault,
    file: () => readFile(path, "utf8"),
    list: async () =>
      (
        await c.query<{ scouts: Scout[]; unreadable: UnreadableScout[] }>(
          "scouts.list"
        )
      ).result!.data,
    save: (input: Record<string, unknown>) =>
      c.mutate("scouts.save", {
        id: "sleep",
        name: "Sleep and memory",
        query: "all:sleep",
        cadence: "daily",
        assigned: [],
        lane: "skim",
        searchBackTo: null,
        ...input,
      }),
    /** Backdate every Proposal, as if first seen `days` before the clock. */
    aged: (days: number) => {
      const db = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"));
      db.prepare("UPDATE proposals SET first_seen = ?").run(
        new Date(NOW.getTime() - days * DAY).toISOString()
      );
      db.close();
    },
    skim: async () =>
      (await c.query<{ recent: Card[]; older: Card[] }>("scouts.skim")).result!
        .data,
  };
}

describe("the Queue behaviour fields", () => {
  it("are the defaults when the file does not say, and a save that sends none writes none", async () => {
    const c = await opened(scoutYaml());

    const [scout] = (await c.list()).scouts;
    expect([scout!.cap, scout!.reviewDays, scout!.skimDays]).toEqual([
      null,
      14,
      30,
    ]);
    expect((await c.save({ cadence: "weekly" })).error).toBeUndefined();
    expect(await c.file()).not.toMatch(/cap|review_days|skim_days/);
  });

  it("round-trip through the form: written under their file names, read back, and an emptied field takes the key away", async () => {
    const c = await opened(scoutYaml());

    const saved = await c.save({ cap: "25", reviewDays: "7", skimDays: "10" });

    expect(saved.error).toBeUndefined();
    const text = await c.file();
    expect(text).toMatch(/^cap: 25$/m);
    expect(text).toMatch(/^review_days: 7$/m);
    expect(text).toMatch(/^skim_days: 10$/m);
    const [scout] = (await c.list()).scouts;
    expect([scout!.cap, scout!.reviewDays, scout!.skimDays]).toEqual([
      25, 7, 10,
    ]);

    // Empty is *absent*: the key goes, and the default is back.
    expect(
      (await c.save({ cap: null, reviewDays: "", skimDays: " " })).error
    ).toBeUndefined();
    expect(await c.file()).not.toMatch(/cap|review_days|skim_days/);
  });

  it("keep a hand edit's value and comment when a save does not mention them", async () => {
    const c = await opened(
      scoutYaml(["cap: 40 # the lab's limit", "skim_days: 12"])
    );

    expect((await c.save({ cadence: "weekly" })).error).toBeUndefined();

    const text = await c.file();
    expect(text).toContain("cap: 40 # the lab's limit");
    expect(text).toMatch(/^skim_days: 12$/m);
  });

  it.each([
    ["cap", "-3", "cap"],
    ["cap", "lots", "cap"],
    ["cap", "2.5", "cap"],
    ["cap", "0", "cap"],
    ["reviewDays", "soon", "review_days"],
    ["skimDays", "-1", "skim_days"],
  ])(
    "refuse %s = %s on the form by name, and write nothing",
    async (key, value, named) => {
      const c = await opened(scoutYaml());
      const before = await c.file();

      const saved = await c.save({ [key]: value });

      expect(saved.error?.data.kind).toBe("refused");
      expect(saved.error?.message).toContain(named);
      expect(await c.file()).toBe(before);
    }
  );

  it.each([
    ["cap: -3", "cap"],
    ["cap: many", "cap"],
    ["review_days: 0", "review_days"],
    ["skim_days: soon", "skim_days"],
    ["skim_days: 7.5", "skim_days"],
  ])(
    "name a hand-edited %s in the rail, never read it as the default",
    async (line, named) => {
      const c = await opened(scoutYaml([line]));

      const { scouts, unreadable } = await c.list();

      expect(scouts).toEqual([]);
      expect(unreadable).toHaveLength(1);
      expect(unreadable[0]!.file).toBe("sleep.yaml");
      expect(unreadable[0]!.sentence).toContain(named);
    }
  );
});

describe("skim_days", () => {
  it("moves where *show older* starts for that Scout's Skim feed", async () => {
    const c = await opened(scoutYaml(["skim_days: 10"]));
    const run = await c.c.mutate("scouts.runNow", { scoutId: "sleep" });
    expect(run.error).toBeUndefined();

    c.aged(11);
    const past = await c.skim();
    expect(past.recent).toEqual([]);
    expect(past.older).toHaveLength(2);

    c.aged(10);
    expect((await c.skim()).recent).toHaveLength(2);
  });

  it("is 30 days when the file does not say", async () => {
    const c = await opened(scoutYaml());
    await c.c.mutate("scouts.runNow", { scoutId: "sleep" });

    c.aged(29);
    expect((await c.skim()).recent).toHaveLength(2);
    c.aged(31);
    expect((await c.skim()).older).toHaveLength(2);
  });
});
