import { chmod, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ScoutActivity } from "./scout-activity.js";
import type { Readings } from "./question-map.js";
import type { Accepted, Card } from "./scouts.js";
import type { NamedScout } from "./scout-names.js";
import type { AcceptCounts } from "./triage.js";
import { arxivScout, openedWithQueue } from "./scout-queue-seed.js";
import { closeCores } from "./test-core.js";

afterEach(closeCores);

// Erase takes a dropped Scout's file out of the app and leaves a tombstone
// (ADR 0053 decision 6; spec #854, ticket #859). Driven through the router on
// a temp vault. What is asserted is what the researcher would find: the
// folder's contents, every row the Scout's history is made of byte for byte,
// and the figures read from them.

const FOLDER = ".vitrine/scouts";
const SLEEP = arxivScout("Sleep and memory");

async function opened(files: Record<string, string>) {
  const q = await openedWithQueue(files);
  const { c, db, vault } = q;
  const read = async <T>(path: string, input?: unknown) => {
    const reply = await c.query<T>(path, input);
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  return {
    ...q,
    folder: () => readdir(join(vault, FOLDER)).then((names) => names.sort()),
    file: (name: string) => readFile(join(vault, FOLDER, name), "utf8"),
    erase: (scoutId: string) => c.mutate("scouts.erase", { scoutId }),
    drop: (scoutId: string) => c.mutate("scouts.drop", { scoutId }),
    /** Every row the Scout's history is made of, as stored. */
    stored: () => ({
      runs: db.prepare("SELECT * FROM scout_runs ORDER BY id").all(),
      proposals: db.prepare("SELECT * FROM proposals ORDER BY id").all(),
      appearances: db.prepare("SELECT * FROM appearances ORDER BY rowid").all(),
      triage: db.prepare("SELECT * FROM triage ORDER BY rowid").all(),
    }),
    activity: () => read<ScoutActivity>("scouts.activity"),
    counts: () => read<AcceptCounts[]>("scouts.acceptCounts"),
    cards: () => read<Card[]>("scouts.queue", { sort: "newest" }),
    clocked: async () =>
      (await read<Readings>("questionMap.readings")).clockedButUnquestioned
        .count,
    origin: (path: string) =>
      read<NamedScout | null>("scouts.origin", { path }),
    accept: async (proposalId: number) => {
      const reply = await c.mutate<Accepted>("scouts.accept", { proposalId });
      expect(reply.error).toBeUndefined();
      return reply.result!.data;
    },
  };
}

describe("scouts.erase", () => {
  it("removes the file, leaves a tombstone holding its name, and changes no row the Scout's history is made of", async () => {
    const f = await opened({
      "sleep.yaml": SLEEP,
      "other.yaml": arxivScout("Other"),
    });
    f.seed("sleep", { action: "accept" });
    f.seed("sleep", { action: "reject" });
    f.seed("other");
    await f.drop("sleep");
    const before = f.stored();

    const reply = await f.erase("sleep");

    expect(reply.error).toBeUndefined();
    expect(await f.folder()).toEqual(["other.yaml", "sleep.erased"]);
    expect(await f.file("sleep.erased")).toBe("name: Sleep and memory\n");
    expect(f.stored()).toEqual(before);
  });

  it("leaves Accept rate and Clocked but unquestioned reading as before, and the Scout off the dropped line", async () => {
    const f = await opened({ "sleep.yaml": SLEEP });
    f.seed("sleep", { action: "accept" });
    f.seed("sleep", { action: "reject" });
    await f.drop("sleep");
    const counts = await f.counts();
    const clocked = await f.clocked();

    await f.erase("sleep");

    expect(await f.counts()).toEqual(counts);
    expect(await f.clocked()).toBe(clocked);
    expect((await f.activity()).dropped).toEqual([]);
  });

  it("keeps a stub's origin resolving, marked erased", async () => {
    const f = await opened({ "sleep.yaml": SLEEP });
    f.seed("sleep");
    const [card] = await f.cards();
    const stub = await f.accept(card!.id);
    await f.drop("sleep");

    await f.erase("sleep");

    expect(await f.origin(stub.path)).toEqual({
      id: "sleep",
      name: "Sleep and memory",
      erased: true,
    });
  });

  it("writes the name as YAML says it, so a name that needs quoting reads back whole", async () => {
    const f = await opened({
      "odd.yaml": arxivScout("x").replace(
        "name: x",
        'name: "Sleep: a #1 review"'
      ),
    });
    await f.drop("odd");

    expect((await f.erase("odd")).error).toBeUndefined();

    expect((await f.activity()).dropped).toEqual([]);
    expect(await f.file("odd.erased")).toBe('name: "Sleep: a #1 review"\n');
  });

  it("refuses a Scout that is not dropped, and changes nothing", async () => {
    const f = await opened({ "sleep.yaml": SLEEP });

    const reply = await f.erase("sleep");

    expect(reply.error?.message).toBe(
      "Sleep and memory is not dropped. Drop it first; only a dropped Scout can be erased."
    );
    expect(reply.error?.data).toMatchObject({
      code: "BAD_REQUEST",
      kind: "refused",
    });
    expect(await f.folder()).toEqual(["sleep.yaml"]);
  });

  it.each(["pending", "deferred"] as const)(
    "refuses while the Scout has a %s Proposal, and changes nothing",
    async (state) => {
      const f = await opened({ "sleep.yaml": SLEEP });
      f.seed("sleep");
      if (state === "deferred") {
        f.db.prepare("UPDATE proposals SET state = 'deferred'").run();
      }
      await f.drop("sleep");
      const before = f.stored();

      const reply = await f.erase("sleep");

      expect(reply.error?.message).toBe(
        `Sleep and memory still has 1 ${state} Proposal in the Queue. Triage it${state === "pending" ? "" : ", or restore the Scout so it can look again,"} before erasing.`
      );
      expect(reply.error?.data).toMatchObject({
        code: "BAD_REQUEST",
        kind: "refused",
      });
      expect(await f.folder()).toEqual(["sleep.yaml"]);
      expect(f.stored()).toEqual(before);
    }
  );

  it("counts a Skim Proposal too, and says how many of each", async () => {
    const f = await opened({ "sleep.yaml": SLEEP });
    f.seed("sleep", { lane: "skim" });
    f.seed("sleep");
    f.seed("sleep");
    f.seed("sleep");
    f.db.prepare("UPDATE proposals SET state = 'deferred' WHERE id = 4").run();
    await f.drop("sleep");

    const reply = await f.erase("sleep");

    expect(reply.error?.message).toBe(
      "Sleep and memory still has 3 pending Proposals and 1 deferred Proposal in the Queue. Triage them, or restore the Scout so it can look again, before erasing."
    );
  });

  it("is not stopped by Proposals that were triaged or that another Scout owns", async () => {
    const f = await opened({
      "sleep.yaml": SLEEP,
      "other.yaml": arxivScout("Other"),
    });
    f.seed("sleep", { action: "accept" });
    f.seed("sleep", { action: "reject" });
    f.seed("other");
    await f.drop("sleep");

    expect((await f.erase("sleep")).error).toBeUndefined();
  });

  it("refuses a Scout that is not there, and one already erased", async () => {
    const f = await opened({ "sleep.yaml": SLEEP });
    await f.drop("sleep");
    await f.erase("sleep");

    const again = await f.erase("sleep");
    const never = await f.erase("never-was");

    expect(again.error?.message).toBe("Sleep and memory was already erased.");
    expect(never.error?.message).toBe("There is no Scout named never-was.");
    expect(await f.folder()).toEqual(["sleep.erased"]);
  });

  it("cannot be restored or dropped afterwards", async () => {
    const f = await opened({ "sleep.yaml": SLEEP });
    await f.drop("sleep");
    await f.erase("sleep");

    const reply = await f.c.mutate("scouts.restore", { scoutId: "sleep" });

    expect(reply.error?.message).toBe(
      "Sleep and memory was erased and cannot be restored."
    );
  });

  it("refuses a file that does not parse, and does not touch it", async () => {
    const broken = "name: [unclosed\n";
    const f = await opened({ "sleep.yaml": broken });

    const reply = await f.erase("sleep");

    expect(reply.error?.data).toMatchObject({
      code: "BAD_REQUEST",
      kind: "refused",
    });
    expect(await f.file("sleep.yaml")).toBe(broken);
  });

  // A real write failure, no mock: a folder that may be read and not written
  // refuses the tombstone's temp file, and the Scout must be exactly as it was.
  it("says it could not write, and leaves the file and the Scout's rows as they were", async () => {
    const f = await opened({ "sleep.yaml": SLEEP });
    f.seed("sleep", { action: "accept" });
    await f.drop("sleep");
    const file = await f.file("sleep.yaml");
    const before = f.stored();
    const folder = join(f.vault, FOLDER);
    await chmod(folder, 0o500);

    try {
      const reply = await f.erase("sleep");

      expect(reply.error?.data.kind).toBe("writeFailed");
      expect(reply.error?.message).toBe(
        "Couldn't write .vitrine/scouts/sleep.erased: EACCES: permission denied"
      );
    } finally {
      await chmod(folder, 0o700);
    }
    expect(await f.folder()).toEqual(["sleep.yaml"]);
    expect(await f.file("sleep.yaml")).toBe(file);
    expect(f.stored()).toEqual(before);
    expect((await f.activity()).dropped).toHaveLength(1);
  });

  it("serialises with a restore of the same Scout, whichever lands first", async () => {
    const f = await opened({ "sleep.yaml": SLEEP });
    await f.drop("sleep");

    // Started together: the erase has to see the Scout as the restore left it
    // (not dropped, so refused) or the restore has to see it erased (refused),
    // never a Scout file written back beside a tombstone, or neither.
    const [erased, restored] = await Promise.all([
      f.erase("sleep"),
      f.c.mutate("scouts.restore", { scoutId: "sleep" }),
    ]);

    expect([erased.error, restored.error].filter(Boolean)).toHaveLength(1);
    const names = await f.folder();
    expect(names).toEqual(erased.error ? ["sleep.yaml"] : ["sleep.erased"]);
    if (erased.error) {
      expect(erased.error.message).toMatch(/is not dropped/);
      expect((await f.activity()).dropped).toEqual([]);
    }
  });

  it("serialises with a restore started the other way round", async () => {
    const f = await opened({ "sleep.yaml": SLEEP });
    await f.drop("sleep");

    const [restored, erased] = await Promise.all([
      f.c.mutate("scouts.restore", { scoutId: "sleep" }),
      f.erase("sleep"),
    ]);

    expect(restored.error).toBeUndefined();
    expect(erased.error?.message).toMatch(/is not dropped/);
    expect(await f.folder()).toEqual(["sleep.yaml"]);
  });
});
