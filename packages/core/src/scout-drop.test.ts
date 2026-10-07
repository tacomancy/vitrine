import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ScoutActivity } from "./scout-activity.js";
import type { Scout, UnreadableScout } from "./scout-file.js";
import type { FleetHealth } from "./scout-health.js";
import type { Readings } from "./question-map.js";
import type { Accepted, Card } from "./scouts.js";
import type { AcceptCounts, Group } from "./triage.js";
import {
  arxivScout,
  daysAgo,
  NOW,
  openedWithQueue,
} from "./scout-queue-seed.js";
import { closeCores } from "./test-core.js";

afterEach(closeCores);

// Dropping a Scout retires it and removes nothing it owns (spec #511; ADR 0042
// decisions 1 and 9; #521). Driven through the router on a temp vault with an
// injected clock, and what is asserted is what the researcher would find: a
// file's bytes, a list, a figure, a card.

const FOLDER = ".vitrine/scouts";

/** A Scout file as someone would write it by hand: a comment, a key the app has never heard of, and a comment beside a value. */
const HAND = `# Watching sleep for the lab\nname: Sleep and memory\ncadence: daily # not weekly: it is slow\nlane: review\ncreated: 2026-09-20T00:00:00Z\ncap: 40\nfilter:\n  query: all:sleep\n`;

/** Formatted as a person might: a rewrite through the YAML library would re-indent it, so a write the app did not need to make shows. */
const UNTIDY = `name: Sleep and memory\ncadence: daily\nlane: review\ncreated: 2026-09-20T00:00:00Z\nfilter:\n    query: all:sleep\n`;
const DROPPED_EARLIER = `${UNTIDY}dropped: 2026-09-01T00:00:00Z\n`;

async function opened(files: Record<string, string>) {
  const q = await openedWithQueue(files);
  const { c, db, vault } = q;
  return {
    ...q,
    file: (name = "sleep.yaml") => readFile(join(vault, FOLDER, name), "utf8"),
    /** What the Queue's rail is drawn from. */
    listed: async () => {
      const read = await c.query<{
        scouts: Scout[];
        dropped: Scout[];
        unreadable: UnreadableScout[];
      }>("scouts.list");
      expect(read.error).toBeUndefined();
      return read.result!.data;
    },
    /** The rail's voices. */
    health: async () => {
      const read = await c.query<FleetHealth>("scouts.health");
      expect(read.error).toBeUndefined();
      return read.result!.data;
    },
    /** What Scout Activity draws. */
    activity: async () => {
      const read = await c.query<ScoutActivity>("scouts.activity");
      expect(read.error).toBeUndefined();
      return read.result!.data;
    },
    /** The Review stack, as the Queue draws it. */
    cards: async () => {
      const read = await c.query<Card[]>("scouts.queue");
      expect(read.error).toBeUndefined();
      return read.result!.data;
    },
    /** What the Accept rate is read from. */
    counts: async () => {
      const read = await c.query<AcceptCounts[]>("scouts.acceptCounts");
      expect(read.error).toBeUndefined();
      return read.result!.data;
    },
    /** What the Queue says beside each Scout's cards. */
    groups: async () => {
      const read = await c.query<Group[]>("scouts.groups");
      expect(read.error).toBeUndefined();
      return read.result!.data;
    },
    accept: async (proposalId: number) => {
      const read = await c.mutate<Accepted>("scouts.accept", { proposalId });
      expect(read.error).toBeUndefined();
      return read.result!.data;
    },
    /** Every row the Scout's history is made of, as stored. */
    stored: () => ({
      runs: db.prepare("SELECT * FROM scout_runs ORDER BY id").all(),
      proposals: db.prepare("SELECT * FROM proposals ORDER BY id").all(),
      appearances: db.prepare("SELECT * FROM appearances ORDER BY rowid").all(),
      triage: db.prepare("SELECT * FROM triage ORDER BY rowid").all(),
    }),
    /** What an empty Review may claim, from the whole fleet. */
    claim: async () => {
      const read = await c.query<{ claim: string | null; naming: string[] }>(
        "scouts.fleet"
      );
      expect(read.error).toBeUndefined();
      return read.result!.data;
    },
    /** A check that looked and parsed cleanly, this many days ago: the Scout has a Voice of its own. */
    looked: (scout: string, days = 1) =>
      db
        .prepare(
          `INSERT INTO scout_runs (scout_id, started, finished, outcome, window_from, window_to, retroactive, new)
           VALUES (?, ?, ?, 'ok', ?, ?, 0, 1)`
        )
        .run(
          scout,
          daysAgo(days),
          daysAgo(days),
          daysAgo(days + 1),
          daysAgo(days)
        ),
  };
}

describe("scouts.drop", () => {
  it("sets one key, `dropped`, and leaves a hand-written file's comments, unknown keys and order as they were", async () => {
    const { c, file } = await opened({ "sleep.yaml": HAND });

    const reply = await c.mutate("scouts.drop", { scoutId: "sleep" });

    expect(reply.error).toBeUndefined();
    expect(await file()).toBe(`${HAND}dropped: ${NOW.toISOString()}\n`);
  });

  it("keeps the first drop's date and rewrites nothing when the Scout is already dropped", async () => {
    const { c, file } = await opened({ "sleep.yaml": DROPPED_EARLIER });

    const reply = await c.mutate("scouts.drop", { scoutId: "sleep" });

    expect(reply.error).toBeUndefined();
    expect(await file()).toBe(DROPPED_EARLIER);
  });

  it.each(["scouts.drop", "scouts.restore"])(
    "%s refuses a Scout that is not there",
    async (call) => {
      const { c } = await opened({ "other.yaml": arxivScout("Other") });

      const reply = await c.mutate(call, { scoutId: "sleep" });

      expect(reply.error?.message).toBe("There is no Scout named sleep.");
      // A refusal, not a fault: the 400 `refusing` makes of a `VaultError`.
      expect(reply.error?.data).toMatchObject({
        code: "BAD_REQUEST",
        kind: "refused",
      });
    }
  );

  it.each(["scouts.drop", "scouts.restore"])(
    "%s refuses a file that does not parse, and does not rewrite it",
    async (call) => {
      const broken = "name: [unclosed\n";
      const { c, file } = await opened({ "sleep.yaml": broken });

      const reply = await c.mutate(call, { scoutId: "sleep" });

      expect(reply.error?.data).toMatchObject({
        code: "BAD_REQUEST",
        kind: "refused",
      });
      expect(await file()).toBe(broken);
    }
  );

  it("takes the Scout off the list of Scouts and names it among the dropped, so nothing that lists Scouts shows it", async () => {
    const { c, listed } = await opened({
      "sleep.yaml": arxivScout("Sleep and memory"),
      "other.yaml": arxivScout("Other"),
    });

    await c.mutate("scouts.drop", { scoutId: "sleep" });

    const read = await listed();
    expect(read.scouts.map((s) => s.id)).toEqual(["other"]);
    expect(read.dropped.map((s) => [s.id, s.name])).toEqual([
      ["sleep", "Sleep and memory"],
    ]);
  });

  it("leaves the Queue's rail and the table, and the fleet's source health stops counting it", async () => {
    const f = await opened({
      "keep.yaml": arxivScout("Keep"),
      "gone.yaml": arxivScout("Gone"),
    });
    f.looked("keep");
    f.looked("gone");
    expect((await f.activity()).fleet.parsingCleanly).toBe(2);

    await f.c.mutate("scouts.drop", { scoutId: "gone" });

    const { rows, fleet } = await f.activity();
    expect(rows.map((row) => row.kind === "scout" && row.id)).toEqual(["keep"]);
    expect(fleet.parsingCleanly).toBe(1);
    expect((await f.health()).scouts.map((s) => s.id)).toEqual(["keep"]);
  });

  it("is named on the one line that lists the dropped, in the table's own read, by name and not by file", async () => {
    const f = await opened({
      "keep.yaml": arxivScout("Keep"),
      "a-zeta.yaml": arxivScout("Zeta"),
      "b-alpha.yaml": arxivScout("Alpha"),
    });
    expect((await f.activity()).dropped).toEqual([]);

    await f.c.mutate("scouts.drop", { scoutId: "a-zeta" });
    await f.c.mutate("scouts.drop", { scoutId: "b-alpha" });

    expect((await f.activity()).dropped).toEqual([
      { id: "b-alpha", name: "Alpha" },
      { id: "a-zeta", name: "Zeta" },
    ]);
  });
});

describe("scouts.restore", () => {
  it("brings the Scout back into the rail and the table with everything it owns as it was, its deferred Proposals still deferred", async () => {
    const f = await opened({ "sleep.yaml": arxivScout("Sleep and memory") });
    f.seed("sleep", { action: "reject" });
    f.seed("sleep");
    f.seed("sleep");
    const [deferred] = await f.cards();
    await f.c.mutate("scouts.defer", { proposalId: deferred!.id });
    const before = f.stored();
    const row = (await f.activity()).rows;

    await f.c.mutate("scouts.drop", { scoutId: "sleep" });
    const reply = await f.c.mutate("scouts.restore", { scoutId: "sleep" });

    expect(reply.error).toBeUndefined();
    expect(f.stored()).toEqual(before);
    expect((await f.activity()).rows).toEqual(row);
    expect((await f.health()).scouts.map((s) => s.id)).toEqual(["sleep"]);
    expect(
      f.stored().proposals.filter((p) => p["state"] === "deferred")
    ).toHaveLength(1);
  });

  it("clears the one key and not the Scout's other states: a paused Scout is still paused when it comes back", async () => {
    const paused = `${HAND}paused: true\n`;
    const { c, file, listed } = await opened({ "sleep.yaml": paused });

    await c.mutate("scouts.drop", { scoutId: "sleep" });
    await c.mutate("scouts.restore", { scoutId: "sleep" });

    expect(await file()).toBe(paused);
    expect((await listed()).scouts).toMatchObject([
      { id: "sleep", paused: true },
    ]);
  });

  it("rewrites nothing when the Scout was not dropped", async () => {
    const { c, file } = await opened({ "sleep.yaml": UNTIDY });

    const reply = await c.mutate("scouts.restore", { scoutId: "sleep" });

    expect(reply.error).toBeUndefined();
    expect(await file()).toBe(UNTIDY);
  });

  it("clears `dropped` and nothing else: a Scout dropped and restored is the file it was, and is on the list again", async () => {
    const { c, file, listed } = await opened({ "sleep.yaml": HAND });
    await c.mutate("scouts.drop", { scoutId: "sleep" });

    const reply = await c.mutate("scouts.restore", { scoutId: "sleep" });

    expect(reply.error).toBeUndefined();
    expect(await file()).toBe(HAND);
    const read = await listed();
    expect(read.scouts.map((s) => s.id)).toEqual(["sleep"]);
    expect(read.dropped).toEqual([]);
  });
});

describe("a dropped Scout's Proposals", () => {
  it("stay in the Review stack under its name, each marked as the dropped Scout's", async () => {
    const f = await opened({ "sleep.yaml": arxivScout("Sleep and memory") });
    f.seed("sleep");
    f.seed("sleep");
    expect((await f.cards()).flatMap((card) => card.scouts)).toMatchObject([
      { id: "sleep", dropped: false },
      { id: "sleep", dropped: false },
    ]);

    await f.c.mutate("scouts.drop", { scoutId: "sleep" });

    const stack = await f.cards();
    expect(stack).toHaveLength(2);
    expect(stack.flatMap((card) => card.scouts)).toMatchObject([
      { id: "sleep", name: "Sleep and memory", dropped: true },
      { id: "sleep", name: "Sleep and memory", dropped: true },
    ]);
  });

  it("are still counted in Review's depth, the deferred ones apart, exactly as before the drop", async () => {
    const f = await opened({ "sleep.yaml": arxivScout("Sleep and memory") });
    f.seed("sleep");
    f.seed("sleep");
    f.seed("sleep");
    const [first] = await f.cards();
    await f.c.mutate("scouts.defer", { proposalId: first!.id });
    const before = (await f.activity()).review;
    expect(before).toMatchObject({ pending: 2, deferred: 1 });

    await f.c.mutate("scouts.drop", { scoutId: "sleep" });

    expect((await f.activity()).review).toEqual(before);
  });

  it("are not rejected for the researcher: nothing is written to the triage record, and the Accept rate reads what it did", async () => {
    const f = await opened({ "sleep.yaml": arxivScout("Sleep and memory") });
    f.seed("sleep", { action: "accept" });
    f.seed("sleep", { action: "reject" });
    f.seed("sleep");
    f.seed("sleep");
    const before = { counts: await f.counts(), stack: await f.cards() };

    await f.c.mutate("scouts.drop", { scoutId: "sleep" });

    expect(await f.counts()).toEqual(before.counts);
    expect(await f.cards()).toHaveLength(before.stack.length);
    expect(f.stored().triage).toHaveLength(2);
  });

  it("leave the Scout's runs, its Proposals, their Appearances, the triage record and the stubs that name it exactly as stored", async () => {
    const f = await opened({ "sleep.yaml": arxivScout("Sleep and memory") });
    f.seed("sleep", { action: "reject" });
    f.seed("sleep");
    const [card] = await f.cards();
    const stub = await f.accept(card!.id);
    const stubBytes = () => readFile(join(f.vault, stub.path), "utf8");
    const before = { stored: f.stored(), stub: await stubBytes() };

    await f.c.mutate("scouts.drop", { scoutId: "sleep" });

    expect(f.stored()).toEqual(before.stored);
    expect(await stubBytes()).toBe(before.stub);
    expect(before.stub).toContain("origin_scout: sleep");
  });

  it("can still be cleared by *reject this run*, which rejects what its newest run found and nothing else", async () => {
    const f = await opened({ "sleep.yaml": arxivScout("Sleep and memory") });
    f.seed("sleep");
    f.seed("sleep");
    await f.c.mutate("scouts.drop", { scoutId: "sleep" });
    const [group] = await f.groups();
    expect(group).toMatchObject({ id: "sleep", runPending: 1 });

    const reply = await f.c.mutate<{ rejected: number }>("scouts.rejectRun", {
      runId: group!.runId,
    });

    expect(reply.result!.data).toEqual({ rejected: 1 });
    expect(await f.cards()).toHaveLength(1);
  });

  it("that were deferred are counted on its group, since only a run of its own brings one back and it will make none", async () => {
    const f = await opened({ "sleep.yaml": arxivScout("Sleep and memory") });
    f.seed("sleep");
    f.seed("sleep");
    f.seed("sleep");
    const [first, second] = await f.cards();
    await f.c.mutate("scouts.defer", { proposalId: first!.id });
    await f.c.mutate("scouts.defer", { proposalId: second!.id });
    expect((await f.groups())[0]).toMatchObject({ deferred: 2 });

    await f.c.mutate("scouts.drop", { scoutId: "sleep" });

    expect((await f.groups())[0]).toMatchObject({ id: "sleep", deferred: 2 });
  });

  it("that were deferred are credited to the Scout that found them first, since its next run is the one that brings them back", async () => {
    const f = await opened({
      "sleep.yaml": arxivScout("Sleep and memory"),
      "other.yaml": arxivScout("Other"),
    });
    // Found by `other` first and by `sleep` after: it returns when `other` next runs clean.
    f.seed("sleep", { firstBy: "other" });
    const [card] = await f.cards();
    await f.c.mutate("scouts.defer", { proposalId: card!.id });

    const byScout = Object.fromEntries(
      (await f.groups()).map((group) => [group.id, group.deferred])
    );

    expect(byScout).toEqual({ other: 1, sleep: 0 });
  });

  it("can still be triaged one by one, as any other card can", async () => {
    const f = await opened({ "sleep.yaml": arxivScout("Sleep and memory") });
    f.seed("sleep");
    f.seed("sleep");
    await f.c.mutate("scouts.drop", { scoutId: "sleep" });
    const [reject, accept] = await f.cards();

    expect(
      (await f.c.mutate("scouts.reject", { proposalId: reject!.id })).error
    ).toBeUndefined();
    await f.accept(accept!.id);

    expect(await f.cards()).toEqual([]);
    expect(await f.counts()).toMatchObject([
      { scoutId: "sleep", accepted: 1, rejected: 1 },
    ]);
  });

  it("still carry the Scout and its Assigned Questions onto the stub an accept writes", async () => {
    const f = await opened({
      "sleep.yaml": `${arxivScout("Sleep and memory")}assigned:\n  - rq2b7x9mk4\n`,
    });
    f.seed("sleep");
    await f.c.mutate("scouts.drop", { scoutId: "sleep" });
    const [card] = await f.cards();

    const stub = await f.accept(card!.id);

    const text = await readFile(join(f.vault, stub.path), "utf8");
    expect(text).toContain("origin_scout: sleep\n");
    expect(text).toContain(
      'origin_question:\n  - "[[Is the overnight benefit consolidation or encoding (RQ)]]"\n'
    );
  });

  it("keep *Clocked but unquestioned* reading true: the stub is still counted, and its origin still names a Scout the app can find", async () => {
    // Assigned to no Question, so what it kept is a Skim-style find that no
    // Question stands behind.
    const f = await opened({ "sleep.yaml": arxivScout("Sleep and memory") });
    f.seed("sleep");
    const [card] = await f.cards();
    const stub = await f.accept(card!.id);
    const clocked = async () => {
      const read = await f.c.query<Readings>("questionMap.readings");
      expect(read.error).toBeUndefined();
      return read.result!.data.clockedButUnquestioned.count;
    };
    expect(await clocked()).toBe(1);

    await f.c.mutate("scouts.drop", { scoutId: "sleep" });

    expect(await clocked()).toBe(1);
    expect(await readFile(join(f.vault, stub.path), "utf8")).toContain(
      "origin_scout: sleep\n"
    );
    expect((await f.listed()).dropped.map((s) => s.id)).toEqual(["sleep"]);
  });
});

// A Scout file is read as found (ADR 0009): a hand edit is honoured, and a file
// the app cannot make sense of is named, never skipped.
describe("a `dropped` key written by hand", () => {
  it("retires the Scout as the app's own does, whatever way the date is written", async () => {
    const { listed } = await opened({
      "sleep.yaml": `${UNTIDY}dropped: 2026-09-01\n`,
    });

    const read = await listed();

    expect(read.scouts).toEqual([]);
    expect(read.dropped.map((s) => s.id)).toEqual(["sleep"]);
  });

  it("makes a file that cannot be read of one whose value is not a date, named in the table in the wrong Voice, never a Scout that is missing", async () => {
    const f = await opened({
      "sleep.yaml": `${UNTIDY}dropped: next week\n`,
    });

    const read = await f.listed();
    const { rows } = await f.activity();

    expect(read.scouts).toEqual([]);
    expect(read.dropped).toEqual([]);
    expect(read.unreadable).toEqual([
      {
        file: "sleep.yaml",
        sentence: "This file could not be read: dropped is not a date.",
      },
    ]);
    expect(rows).toMatchObject([
      { kind: "unreadable", file: "sleep.yaml", health: { voice: "wrong" } },
    ]);
  });
});

describe("the fleet's claim that Review is cleared", () => {
  // A claim is warranted by what the Scouts that were not dropped did (ADR
  // 0032): a retired Scout's last run is not evidence the field is being watched.
  it("rests on the Scouts that are not dropped: the newest run and the last find it names are theirs, not a dropped Scout's", async () => {
    const f = await opened({
      "keep.yaml": arxivScout("Keep"),
      "gone.yaml": arxivScout("Gone"),
    });
    f.looked("keep", 5);
    f.seed("gone", { action: "reject" });
    // The month is the locale's to abbreviate: only the run and the find matter.
    expect((await f.claim()).claim).toMatch(
      /^2 scouts watching · all parsed cleanly · newest run 1 day ago · last new proposal 27 Sep/
    );

    await f.c.mutate("scouts.drop", { scoutId: "gone" });

    expect((await f.claim()).claim).toBe(
      "1 scout watching · all parsed cleanly · newest run 5 days ago · no proposal yet"
    );
  });
});
