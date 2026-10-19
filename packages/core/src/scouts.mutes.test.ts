import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Card } from "./scouts.js";
import type { Group } from "./triage.js";
import type { ScoutActivity } from "./scout-activity.js";
import type { Muted } from "./mutes.js";
import { arxivScout, openedWithQueue, type Seed } from "./scout-queue-seed.js";
import { closeCores } from "./test-core.js";

afterEach(closeCores);

// Mute rules (#646; ADR 0044 decision 4): a vault-wide file read as found and
// applied in the Queue's reads, so a Proposal is never marked. What is
// asserted is what the Queue returns and what `queue.sqlite` holds after.

async function opened() {
  const s = await openedWithQueue({ "a.yaml": arxivScout("a") });
  const read = async <T>(path: string, input?: unknown): Promise<T> => {
    const r = await s.c.query<T>(path, input);
    expect(r.error).toBeUndefined();
    return r.result!.data;
  };
  const titles = (cards: Card[]) => cards.map((c) => c.title).sort();
  return {
    ...s,
    review: async () => titles(await read<Card[]>("scouts.queue")),
    skim: async () =>
      titles((await read<{ recent: Card[] }>("scouts.skim")).recent),
    muted: () => read<Muted>("scouts.muted"),
    reach: async (kind: string, value: string) =>
      (await read<{ count: number }>("scouts.muteReach", { kind, value }))
        .count,
    mute: async (kind: string, value: string) => {
      const r = await s.c.mutate("scouts.mute", { kind, value });
      expect(r.error).toBeUndefined();
    },
    unmute: async (kind: string, value: string) => {
      const r = await s.c.mutate("scouts.unmute", { kind, value });
      expect(r.error).toBeUndefined();
    },
    /** Give a seeded Proposal words to be matched on. */
    words: (n: number, title: string, abstract = "") =>
      s.db
        .prepare("UPDATE proposals SET title = ?, abstract = ? WHERE id = ?")
        .run(title, abstract, n),
    depth: async () => (await read<ScoutActivity>("scouts.activity")).review,
    groups: () => read<Group[]>("scouts.groups"),
  };
}

const review = (over: Seed = {}) => ({ lane: "review" as const, ...over });

describe("what a rule matches", () => {
  it("matches an author exactly after trim and case-fold, and never a longer name", async () => {
    const q = await opened();
    q.seed("a", review({ authors: ["Ada Lovelace"] }));
    q.seed("a", review({ authors: ["Ada Lovelace Jr"] }));
    q.seed("a", review({ authors: ["B. Other", "ADA LOVELACE"] }));

    await q.mute("author", "  ada lovelace ");

    expect(await q.review()).toEqual(["T2"]);
  });

  it("matches a venue exactly after trim and case-fold, and never a paper with none", async () => {
    const q = await opened();
    q.seed("a", review({ venue: "Nature Machine Intelligence" }));
    q.seed("a", review({ venue: "Nature" }));
    q.seed("a", review({ venue: null }));

    await q.mute("venue", " NATURE ");

    expect(await q.review()).toEqual(["T1", "T3"]);
  });

  it("matches a keyword as a case-insensitive substring of the title or the abstract", async () => {
    const q = await opened();
    for (let i = 0; i < 4; i++) q.seed("a", review());
    q.words(1, "On Mesa-Optimizers");
    q.words(2, "Something else", "…about mesa-optimization in general");
    q.words(3, "Unrelated", "nothing here");
    q.words(4, "Another", "a mesa");

    await q.mute("keyword", "MESA-OPT");

    expect(await q.review()).toEqual(["Another", "Unrelated"]);
  });

  it("refuses an empty rule and one that is not an author, venue or keyword", async () => {
    const q = await opened();
    expect(
      (await q.c.mutate("scouts.mute", { kind: "author", value: "   " })).error
    ).toBeDefined();
    expect(
      (await q.c.mutate("scouts.mute", { kind: "title", value: "x" })).error
    ).toBeDefined();
  });
});

describe("where a rule reaches", () => {
  it("catches what is already pending and what arrives later, in both Lanes, and deleting it returns them", async () => {
    const q = await opened();
    q.seed("a", review({ authors: ["Ada"] }));
    q.seed("a", { lane: "skim", authors: ["Ada"] });
    q.seed("a", review({ authors: ["Bo"] }));

    await q.mute("author", "Ada");
    expect(await q.review()).toEqual(["T3"]);
    expect(await q.skim()).toEqual([]);

    // A later arrival is caught with no further act: the rule is read, not applied once.
    q.seed("a", review({ authors: ["Ada"] }));
    q.seed("a", { lane: "skim", authors: ["Ada"] });
    expect(await q.review()).toEqual(["T3"]);
    expect(await q.skim()).toEqual([]);

    await q.unmute("author", "ada");
    expect(await q.review()).toEqual(["T1", "T3", "T4"]);
    expect(await q.skim()).toEqual(["T2", "T5"]);
  });

  it("catches a deferred Proposal, and it is still muted when its deferral ends", async () => {
    const q = await opened();
    q.seed("a", review({ authors: ["Ada"] }));
    q.db.prepare("UPDATE proposals SET state = 'deferred'").run();

    await q.mute("author", "Ada");
    expect((await q.muted()).items.map((i) => i.title)).toEqual(["T1"]);

    q.db.prepare("UPDATE proposals SET state = 'pending'").run();
    expect(await q.review()).toEqual([]);
    expect((await q.muted()).items.map((i) => i.title)).toEqual(["T1"]);
  });

  it("never mutes an accepted, rejected or held Proposal", async () => {
    const q = await opened();
    q.seed("a", review({ authors: ["Ada"], action: "accept" }));
    q.seed("a", review({ authors: ["Ada"], action: "reject" }));
    q.seed("a", review({ authors: ["Ada"], held: true }));
    q.seed("a", review({ authors: ["Ada"] }));

    await q.mute("author", "Ada");

    expect((await q.muted()).items.map((i) => i.title)).toEqual(["T4"]);
    expect(await q.reach("author", "Ada")).toBe(0);
  });
});

describe("the reach count", () => {
  it("equals what the saved rule then catches, and writes nothing before it is saved", async () => {
    const q = await opened();
    q.seed("a", review({ venue: "V" }));
    q.seed("a", { lane: "skim", venue: "V" });
    q.seed("a", review({ venue: "V", action: "reject" }));
    q.seed("a", review({ venue: "W" }));
    q.db.prepare("UPDATE proposals SET state = 'deferred' WHERE id = 1").run();

    const before = await q.reach("venue", "v");
    expect((await q.muted()).items).toEqual([]);
    expect(before).toBe(2);

    await q.mute("venue", "v");
    expect((await q.muted()).items).toHaveLength(before);
  });

  it("does not count what another rule already holds", async () => {
    const q = await opened();
    q.seed("a", review({ authors: ["Ada"], venue: "V" }));
    q.seed("a", review({ authors: ["Bo"], venue: "V" }));
    await q.mute("author", "Ada");

    expect(await q.reach("venue", "V")).toBe(1);
  });
});

describe("the muted view", () => {
  it("names the rule that caught each item", async () => {
    const q = await opened();
    q.seed("a", review({ authors: ["Ada"] }));
    q.seed("a", { lane: "skim", venue: "V" });
    q.seed("a", review());
    q.words(3, "T3 about mesa");
    await q.mute("author", "Ada");
    await q.mute("venue", "v");
    await q.mute("keyword", "mesa");

    const { items, rules, problem } = await q.muted();
    expect(problem).toBeNull();
    expect(rules).toEqual([
      { kind: "author", value: "Ada" },
      { kind: "venue", value: "v" },
      { kind: "keyword", value: "mesa" },
    ]);
    expect(items.map((i) => [i.title, i.lane, i.rule]).sort()).toEqual([
      ["T1", "review", { kind: "author", value: "Ada" }],
      ["T2", "skim", { kind: "venue", value: "v" }],
      ["T3 about mesa", "review", { kind: "keyword", value: "mesa" }],
    ]);
  });

  it("names the first rule when two catch the same item, and returns it to the other when one is deleted", async () => {
    const q = await opened();
    q.seed("a", review({ authors: ["Ada"], venue: "V" }));
    await q.mute("author", "Ada");
    await q.mute("venue", "V");
    expect((await q.muted()).items[0]!.rule).toEqual({
      kind: "author",
      value: "Ada",
    });

    await q.unmute("author", "Ada");
    expect((await q.muted()).items[0]!.rule).toEqual({
      kind: "venue",
      value: "V",
    });
    expect(await q.review()).toEqual([]);
  });

  it("holds a rule once however often it is added", async () => {
    const q = await opened();
    await q.mute("author", "Ada");
    await q.mute("author", " ADA ");
    expect((await q.muted()).rules).toEqual([{ kind: "author", value: "Ada" }]);
  });
});

describe("what a muted item counts toward", () => {
  it("is out of Review depth, the past-window count and the group's figures", async () => {
    const q = await opened();
    q.seed("a", review({ authors: ["Ada"], ago: 30 }));
    q.seed("a", review({ authors: ["Ada"] }));
    q.seed("a", review({ authors: ["Bo"] }));
    q.seed("a", review({ authors: ["Ada"] }));
    q.db.prepare("UPDATE proposals SET state = 'deferred' WHERE id = 4").run();
    // `seed` gives each Proposal a run of its own; a group's figure reads the
    // Scout's newest run, so they have to share it.
    q.db
      .prepare(
        "UPDATE appearances SET run_id = (SELECT MAX(id) FROM scout_runs)"
      )
      .run();

    const open = await q.depth();
    expect(open).toMatchObject({ pending: 3, pastWindow: 1, deferred: 1 });
    const [groupBefore] = await q.groups();
    expect(groupBefore).toMatchObject({ runPending: 3, deferred: 1 });

    await q.mute("author", "Ada");

    expect(await q.depth()).toMatchObject({
      pending: 1,
      pastWindow: 0,
      deferred: 0,
    });
    const [group] = await q.groups();
    expect(group).toMatchObject({ runPending: 1, deferred: 0 });
  });

  it("writes no triage row and leaves every Proposal's state alone", async () => {
    const q = await opened();
    q.seed("a", review({ authors: ["Ada"] }));
    q.seed("a", review({ authors: ["Ada"], action: "accept" }));
    const rows = () =>
      q.db.prepare("SELECT id, state, lane FROM proposals ORDER BY id").all();
    const triage = () => q.db.prepare("SELECT * FROM triage").all();
    const [stateBefore, triageBefore] = [rows(), triage()];

    await q.mute("author", "Ada");
    await q.review();
    await q.unmute("author", "Ada");

    expect(rows()).toEqual(stateBefore);
    expect(triage()).toEqual(triageBefore);
  });

  it("leaves Accept rate on the acts that were made", async () => {
    const q = await opened();
    for (let i = 0; i < 3; i++) {
      q.seed("a", review({ authors: ["Ada"], action: "accept" }));
    }
    q.seed("a", review({ authors: ["Ada"] }));
    const counts = () => q.c.query("scouts.acceptCounts");

    const before = await counts();
    await q.mute("author", "Ada");

    expect(await counts()).toEqual(before);
  });
});

describe("the rules file", () => {
  const file = (vault: string) => join(vault, ".vitrine/mutes.yaml");

  it("is read as found: a hand edit counts, with no write by the app", async () => {
    const q = await opened();
    q.seed("a", review({ authors: ["Ada"] }));
    await mkdir(join(q.vault, ".vitrine"), { recursive: true });
    await writeFile(file(q.vault), "authors:\n  - ada\n# mine\n");

    expect(await q.review()).toEqual([]);
    expect(await readFile(file(q.vault), "utf8")).toContain("# mine");
  });

  it("names a file that does not parse, and a Queue that reads it still reads", async () => {
    const q = await opened();
    q.seed("a", review({ authors: ["Ada"] }));
    for (const bad of [
      "authors: [unclosed",
      "- just\n- a list\n",
      "author:\n  - Ada\n",
      "authors:\n  - 3\n",
    ]) {
      await writeFile(file(q.vault), bad);
      const { problem, rules } = await q.muted();
      expect(problem).toContain(".vitrine/mutes.yaml");
      expect(rules).toEqual([]);
      // Not read as no rules, and not read as every rule: the Queue is as it was.
      expect(await q.review()).toEqual(["T1"]);
    }
  });

  it("refuses to add or delete over a file it cannot read, leaving it as found", async () => {
    const q = await opened();
    await writeFile(file(q.vault), "authors: [unclosed");

    for (const act of ["scouts.mute", "scouts.unmute"]) {
      const r = await q.c.mutate(act, { kind: "author", value: "Ada" });
      expect(r.error?.message).toContain(".vitrine/mutes.yaml");
    }
    expect(await readFile(file(q.vault), "utf8")).toBe("authors: [unclosed");
  });
});
