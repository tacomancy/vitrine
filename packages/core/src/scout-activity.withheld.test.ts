import { afterEach, describe, expect, it } from "vitest";
import type { ScoutActivity } from "./scout-activity.js";
import type { Group } from "./triage.js";
import type { Muted } from "./mutes.js";
import { arxivScout, openedWithQueue, type Seed } from "./scout-queue-seed.js";
import { closeCores } from "./test-core.js";

afterEach(closeCores);

// What the Queue is withholding, said on Scout Activity (#649; ADR 0044
// decision 12): *N below your cap* and *N muted*, read from the rows the Queue
// reads. The queue is seeded directly; what is asserted is the figure a row
// carries and that it agrees with the Queue's own.

async function opened() {
  const s = await openedWithQueue({
    "a.yaml": arxivScout("a"),
    "b.yaml": arxivScout("b"),
  });
  const read = async <T>(path: string, input?: unknown): Promise<T> => {
    const r = await s.c.query<T>(path, input);
    expect(r.error).toBeUndefined();
    return r.result!.data;
  };
  return {
    ...s,
    volume: async (scoutId: string) => {
      const { rows } = await read<ScoutActivity>("scouts.activity");
      const row = rows.find((r) => r.kind === "scout" && r.id === scoutId);
      if (row?.kind !== "scout") throw new Error("no such row");
      return row.volume;
    },
    cut: (...ids: number[]) =>
      ids.forEach((id) =>
        s.db
          .prepare("UPDATE proposals SET state = 'capped' WHERE id = ?")
          .run(id)
      ),
    mute: async (kind: string, value: string) => {
      const r = await s.c.mutate("scouts.mute", { kind, value });
      expect(r.error).toBeUndefined();
    },
    unmute: async (kind: string, value: string) => {
      const r = await s.c.mutate("scouts.unmute", { kind, value });
      expect(r.error).toBeUndefined();
    },
    groups: () => read<Group[]>("scouts.groups"),
    muted: () => read<Muted>("scouts.muted"),
  };
}

const review = (over: Seed = {}) => ({ lane: "review" as const, ...over });

describe("N below your cap", () => {
  it("counts what the Scout's cap cut, the Scout's own and no other's", async () => {
    const q = await opened();
    q.seed("a", review());
    q.seed("a", review());
    q.seed("a", review());
    q.seed("b", review());
    q.cut(2, 3, 4);

    expect((await q.volume("a")).belowCap).toBe(2);
    expect((await q.volume("b")).belowCap).toBe(1);
  });

  it("agrees with the count the Queue's group gives, and falls to none once they are shown", async () => {
    const q = await opened();
    q.seed("a", review());
    q.seed("a", review());
    q.cut(1, 2);

    const group = (await q.groups()).find((g) => g.id === "a")!;
    expect((await q.volume("a")).belowCap).toBe(group.capped);

    const r = await q.c.mutate("scouts.showCapped", { scoutId: "a" });
    expect(r.error).toBeUndefined();
    expect((await q.volume("a")).belowCap).toBe(0);
  });

  it("is none for a Scout whose cap cut nothing", async () => {
    const q = await opened();
    q.seed("a", review());

    expect((await q.volume("a")).belowCap).toBe(0);
  });
});

describe("N muted", () => {
  it("counts what a rule holds in either Lane, credited to the Scout that found it first", async () => {
    const q = await opened();
    q.seed("a", review({ authors: ["Ada Lovelace"] }));
    q.seed("a", { lane: "skim", authors: ["Ada Lovelace"] });
    q.seed("b", review({ authors: ["Ada Lovelace"] }));
    q.seed("b", review({ authors: ["Someone Else"] }));
    q.seed("b", review({ authors: ["Ada Lovelace"], firstBy: "a" }));

    await q.mute("author", "ada lovelace");

    expect((await q.volume("a")).muted).toBe(3);
    expect((await q.volume("b")).muted).toBe(1);
  });

  it("agrees with the muted view, and the rule's deletion returns what it held", async () => {
    const q = await opened();
    q.seed("a", review({ venue: "Nature" }));
    q.seed("a", review({ venue: "Nature" }));
    await q.mute("venue", "nature");

    expect((await q.volume("a")).muted).toBe((await q.muted()).items.length);

    await q.unmute("venue", "nature");
    expect((await q.volume("a")).muted).toBe(0);
  });

  it("leaves a Proposal that is already triaged out", async () => {
    const q = await opened();
    q.seed("a", review({ authors: ["Ada Lovelace"], action: "reject" }));

    await q.mute("author", "ada lovelace");

    expect((await q.volume("a")).muted).toBe(0);
  });
});
