import { afterEach, describe, expect, it } from "vitest";
import type { QuestionGroup } from "./scouts.js";
import { arxivScout, openedWithQueue } from "./scout-queue-seed.js";
import { closeCores } from "./test-core.js";

afterEach(closeCores);

// Group by Question (#645; ADR 0044 decision 10): a Proposal is in every
// Assigned Question's group, in *Unassigned* when its Scouts have none, and a
// triaged card leaves them all because the groups are read from what is pending.

const scout = (name: string, assigned: string[]) =>
  arxivScout(name) +
  (assigned.length > 0
    ? `assigned:\n${assigned.map((q) => `  - ${q}\n`).join("")}`
    : "");

async function opened(scouts: Record<string, string>) {
  const q = await openedWithQueue(scouts);
  const ids = () =>
    (
      q.db.prepare("SELECT id FROM proposals ORDER BY id").all() as Array<{
        id: number;
      }>
    ).map((r) => r.id);
  const groups = async () => {
    const r = await q.c.query<QuestionGroup[]>("scouts.questionGroups");
    expect(r.error).toBeUndefined();
    return r.result!.data;
  };
  return { ...q, ids, groups };
}

const keyed = (groups: QuestionGroup[]) =>
  groups.map((g) => [g.question?.id ?? null, g.proposalIds]);

describe("groups by Question", () => {
  it("lists a paper in each Assigned Question's group", async () => {
    const q = await opened({ "a.yaml": scout("a", ["q1", "q2"]) });
    q.seed("a");
    const [p] = q.ids();

    expect(keyed(await q.groups())).toEqual([
      ["q1", [p]],
      ["q2", [p]],
    ]);
  });

  it("puts a paper found by Scouts with different Questions in both groups", async () => {
    const q = await opened({
      "a.yaml": scout("a", ["q1"]),
      "b.yaml": scout("b", ["q2"]),
    });
    q.seed("a", { firstBy: "b" });
    q.seed("a");
    const [shared, alone] = q.ids();

    expect(keyed(await q.groups())).toEqual([
      ["q1", [shared, alone]],
      ["q2", [shared]],
    ]);
  });

  it("catches papers whose Scouts have no Questions in Unassigned, last", async () => {
    const q = await opened({
      "a.yaml": scout("a", ["q1"]),
      "b.yaml": scout("b", []),
    });
    q.seed("a");
    q.seed("b");
    const [assigned, loose] = q.ids();

    expect(keyed(await q.groups())).toEqual([
      ["q1", [assigned]],
      [null, [loose]],
    ]);
  });

  it("does not list Unassigned when nothing is in it", async () => {
    const q = await opened({ "a.yaml": scout("a", ["q1"]) });
    q.seed("a");

    expect((await q.groups()).some((g) => g.question === null)).toBe(false);
  });

  it("drops a card from every group once it is triaged", async () => {
    const q = await opened({ "a.yaml": scout("a", ["q1", "q2"]) });
    q.seed("a");
    q.seed("a");
    const [first, second] = q.ids();

    expect(
      (await q.c.mutate("scouts.reject", { proposalId: first })).error
    ).toBeUndefined();

    expect(keyed(await q.groups())).toEqual([
      ["q1", [second]],
      ["q2", [second]],
    ]);
  });

  it("leaves Skim out, as the stack does", async () => {
    const q = await opened({ "a.yaml": scout("a", ["q1"]) });
    q.seed("a", { lane: "skim" });

    expect(await q.groups()).toEqual([]);
  });
});
