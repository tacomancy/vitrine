import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ScoutActivity } from "./scout-activity.js";
import type { Scout, Tombstone, UnreadableScout } from "./scout-file.js";
import type { Readings } from "./question-map.js";
import type { Accepted, Card } from "./scouts.js";
import type { NamedScout, RunLine } from "./scout-names.js";
import type { AcceptCounts } from "./triage.js";
import { arxivScout, daysAgo, openedWithQueue } from "./scout-queue-seed.js";
import { closeCores } from "./test-core.js";

afterEach(closeCores);

// A tombstone is what an erased Scout leaves: its name and id, in
// `.vitrine/scouts/<id>.erased` (ADR 0053 decision 6; spec #854, ticket #856).
// Nothing writes one yet, so these tests make it by hand, which is exactly
// what keeps erase, when it lands, from leaving a dangling Scout. Each test
// names one reader of a Scout by id (the census is in the PR); breaking that
// reader's resolution fails the test that names it.

const GONE = "name: Sleep and memory\n";

async function opened(files: Record<string, string>) {
  const q = await openedWithQueue(files);
  const { c, vault } = q;
  const read = async <T>(path: string, input?: unknown) => {
    const reply = await c.query<T>(path, input);
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  return {
    ...q,
    listed: () =>
      read<{
        scouts: Scout[];
        dropped: Scout[];
        erased: Tombstone[];
        unreadable: UnreadableScout[];
      }>("scouts.list"),
    activity: () => read<ScoutActivity>("scouts.activity"),
    cards: () => read<Card[]>("scouts.queue", { sort: "newest" }),
    counts: () => read<AcceptCounts[]>("scouts.acceptCounts"),
    origin: (path: string) =>
      read<NamedScout | null>("scouts.origin", { path }),
    runs: () => read<RunLine[]>("scouts.runs"),
    clocked: async () =>
      (await read<Readings>("questionMap.readings")).clockedButUnquestioned
        .count,
    accept: async (proposalId: number) => {
      const reply = await c.mutate<Accepted>("scouts.accept", { proposalId });
      expect(reply.error).toBeUndefined();
      return reply.result!.data;
    },
    file: (name: string) =>
      readFile(join(vault, ".vitrine/scouts", name), "utf8"),
  };
}

describe("a tombstone, read by the Queue", () => {
  it("names the Scout on a card, marked erased, and a Scout that is still there is not", async () => {
    const f = await opened({
      "sleep.erased": GONE,
      "live.yaml": arxivScout("Live one"),
    });
    f.seed("sleep");
    f.seed("live");

    const stack = await f.cards();

    expect(stack.flatMap((card) => card.scouts)).toEqual(
      expect.arrayContaining([
        {
          id: "sleep",
          name: "Sleep and memory",
          erased: true,
          assigned: [],
          dropped: false,
        },
        {
          id: "live",
          name: "Live one",
          erased: false,
          assigned: [],
          dropped: false,
        },
      ])
    );
  });

  it("names the Scout that raised a card, marked erased", async () => {
    const f = await opened({
      "sleep.erased": GONE,
      "live.yaml": arxivScout("Live one"),
    });
    // `live` placed it, `sleep` found it again at the same moment: the raise.
    f.seed("sleep", { firstBy: "live" });
    f.db
      .prepare(
        "INSERT INTO triage (proposal_id, action, at) VALUES (1, 'raise', ?)"
      )
      .run(daysAgo(3));

    const [card] = await f.cards();

    expect(card!.moved).toEqual({
      kind: "raised",
      by: { id: "sleep", name: "Sleep and memory", erased: true },
    });
  });
});

describe("a tombstone, read from a record that names it", () => {
  it("names the Scout on a stub's origin, marked erased", async () => {
    const f = await opened({
      "sleep.yaml": arxivScout("Sleep and memory"),
      "live.yaml": arxivScout("Live one"),
    });
    f.seed("sleep");
    f.seed("live");
    const stubs = await Promise.all(
      (await f.cards()).map((card) => f.accept(card.id))
    );
    expect(
      (await Promise.all(stubs.map((s) => f.origin(s.path)))).map(
        (o) => o?.erased
      )
    ).toEqual([false, false]);

    await f.c.mutate("scouts.drop", { scoutId: "sleep" });
    await f.c.mutate("scouts.drop", { scoutId: "live" });
    // The file goes and the tombstone takes its place, as erase will do.
    const { rm, writeFile } = await import("node:fs/promises");
    await rm(join(f.vault, ".vitrine/scouts/sleep.yaml"));
    await writeFile(join(f.vault, ".vitrine/scouts/sleep.erased"), GONE);

    const origins = await Promise.all(stubs.map((s) => f.origin(s.path)));
    expect(origins).toContainEqual({
      id: "sleep",
      name: "Sleep and memory",
      erased: true,
    });
    expect(origins).toContainEqual({
      id: "live",
      name: "Live one",
      erased: false,
    });
  });

  it("names the Scout on a past run's line, marked erased", async () => {
    const f = await opened({
      "sleep.erased": GONE,
      "live.yaml": arxivScout("Live one"),
    });
    f.seed("sleep");
    f.seed("live");

    const lines = await f.runs();

    expect(lines.map((l) => l.scout)).toEqual(
      expect.arrayContaining([
        { id: "sleep", name: "Sleep and memory", erased: true },
        { id: "live", name: "Live one", erased: false },
      ])
    );
  });

  it("falls back to the id, not erased, for a Scout nothing in the vault names", async () => {
    const f = await opened({});
    f.seed("never-was");

    const [line] = await f.runs();

    expect(line!.scout).toEqual({
      id: "never-was",
      name: "never-was",
      erased: false,
    });
  });
});

describe("a tombstone is not a Scout", () => {
  it("is in neither scouts.list's Scouts nor scouts.activity, and is not on the dropped line", async () => {
    const f = await opened({
      "sleep.erased": GONE,
      "live.yaml": arxivScout("Live one"),
    });

    const list = await f.listed();
    const activity = await f.activity();

    expect(list.scouts.map((s) => s.id)).toEqual(["live"]);
    expect(list.dropped).toEqual([]);
    expect(list.unreadable).toEqual([]);
    expect(list.erased).toEqual([{ id: "sleep", name: "Sleep and memory" }]);
    expect(
      activity.rows.map((r) => (r.kind === "scout" ? r.id : r.file))
    ).toEqual(["live"]);
    expect(activity.dropped).toEqual([]);
  });

  it("is refused a restore, with the reason, and is not written", async () => {
    const f = await opened({ "sleep.erased": GONE });

    const reply = await f.c.mutate("scouts.restore", { scoutId: "sleep" });

    expect(reply.error?.message).toBe(
      "Sleep and memory was erased and cannot be restored."
    );
    expect(await f.file("sleep.erased")).toBe(GONE);
  });

  it("keeps its id taken, so a new Scout of the same name does not take it", async () => {
    const f = await opened({ "sleep-and-memory.erased": GONE });

    const reply = await f.c.mutate("scouts.save", {
      name: "Sleep and memory",
      query: "all:sleep",
      cadence: "weekly",
      assigned: [],
      lane: "review",
      searchBackTo: null,
    });

    expect(reply.error).toBeUndefined();
    expect((await f.listed()).scouts.map((s) => s.id)).toEqual([
      "sleep-and-memory-2",
    ]);
  });

  it("reads a tombstone whose name cannot be read as the id, still erased", async () => {
    const f = await opened({ "sleep.erased": "{{ not yaml" });

    expect((await f.listed()).erased).toEqual([{ id: "sleep", name: "sleep" }]);
  });
});

describe("a tombstone leaves what other Scouts read as it was", () => {
  const seeded = async (tombstone: boolean) => {
    const f = await opened({
      "live.yaml": arxivScout("Live one"),
      ...(tombstone ? { "sleep.erased": GONE } : {}),
    });
    f.seed("live", { action: "accept" });
    f.seed("live", { action: "reject" });
    f.seed("sleep", { action: "accept" });
    f.seed("sleep", { action: "reject" });
    return f;
  };

  it("Accept rate for a Scout that is still there", async () => {
    const [without, withTomb] = [await seeded(false), await seeded(true)];

    const live = async (f: typeof without) =>
      (await f.activity()).rows.find(
        (r) => r.kind === "scout" && r.id === "live"
      );

    expect(await live(withTomb)).toEqual(await live(without));
    expect(
      (await withTomb.counts()).find((c) => c.scoutId === "sleep")
    ).toEqual((await without.counts()).find((c) => c.scoutId === "sleep"));
  });

  it("Clocked but unquestioned, for a stub whose Scout rows remain", async () => {
    const f = await opened({ "sleep.yaml": arxivScout("Sleep and memory") });
    f.seed("sleep");
    const [card] = await f.cards();
    await f.accept(card!.id);
    expect(await f.clocked()).toBe(1);

    const { rm, writeFile } = await import("node:fs/promises");
    await rm(join(f.vault, ".vitrine/scouts/sleep.yaml"));
    await writeFile(join(f.vault, ".vitrine/scouts/sleep.erased"), GONE);

    expect(await f.clocked()).toBe(1);
  });
});
