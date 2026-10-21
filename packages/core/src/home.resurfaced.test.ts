import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ListedQuestion } from "./list.js";
import { closeCores, core, vaultWith } from "./test-core.js";

// From the notebook (spec #728, #732): the resurfaced Questions are a seeded
// pick from the open Questions old enough to have been forgotten, and a
// dismissal takes one out of that rotation and nothing else.

afterEach(closeCores);

const DAY = 24 * 60 * 60 * 1000;
// Midday, so a day counted in the machine's own zone is the day it looks.
const TODAY = new Date("2026-10-21T12:00:00+01:00");
const daysAgo = (n: number, from = TODAY) =>
  new Date(from.getTime() - n * DAY).toISOString();

const question = (
  name: string,
  {
    captured,
    status,
    id = `q-${name}`,
    extra = "",
  }: { captured: string; status?: string; id?: string | null; extra?: string }
) => `---
${id === null ? "" : `id: ${id}\n`}kind: question
question: "${name}?"
${status === undefined ? "" : `status: ${status}\n`}captured: ${captured}
context: other
${extra}---
`;

async function open(files: Record<string, string>, now = () => TODAY) {
  const vault = await vaultWith(files);
  const c = await core({ now, stalledOpenDays: 3 });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  return { vault, c };
}

type Core = Awaited<ReturnType<typeof open>>["c"];

async function resurfaced(c: Core, seed?: number) {
  const reply = await c.query<{ questions: ListedQuestion[] }>(
    "home.resurfaced",
    seed === undefined ? undefined : { seed }
  );
  expect(reply.error).toBeUndefined();
  return reply.result!.data;
}

const names = (data: { questions: ListedQuestion[] }) =>
  data.questions.map((q) => q.question);

/** Twelve eligible Questions: enough that two different picks are checkable. */
const crowd = () =>
  Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      `q${i}.md`,
      question(`crowd ${i}`, { captured: daysAgo(100 + i) }),
    ])
  );

describe("home.resurfaced — the pool", () => {
  it("leaves a Question out at 59 days and takes it at 60", async () => {
    const { c } = await open({
      "fifty-nine.md": question("fifty-nine", { captured: daysAgo(59) }),
      "sixty.md": question("sixty", { captured: daysAgo(60) }),
    });
    expect(names(await resurfaced(c))).toEqual(["sixty?"]);
  });

  it("takes a Question with no status, which is open", async () => {
    const { c } = await open({
      "bare.md": question("bare", { captured: daysAgo(90) }),
    });
    expect(names(await resurfaced(c))).toEqual(["bare?"]);
  });

  it("leaves out a promoted, answered or abandoned Question however old", async () => {
    const { c } = await open({
      "open.md": question("open", { captured: daysAgo(90), status: "open" }),
      "promoted.md": question("promoted", {
        captured: daysAgo(90),
        status: "promoted",
      }),
      "answered.md": question("answered", {
        captured: daysAgo(90),
        status: "answered",
      }),
      "abandoned.md": question("abandoned", {
        captured: daysAgo(90),
        status: "abandoned",
      }),
    });
    expect(names(await resurfaced(c))).toEqual(["open?"]);
  });

  it("leaves out a Partial file and an Unreadable one", async () => {
    const { c } = await open({
      "good.md": question("good", { captured: daysAgo(90) }),
      // No `captured`: Partial.
      "partial.md": `---\nid: q-partial\nkind: question\nquestion: "partial?"\ncontext: other\n---\n`,
      // A status outside the vocabulary: Unreadable.
      "unreadable.md": question("unreadable", {
        captured: daysAgo(90),
        status: "someday",
      }),
    });
    expect(names(await resurfaced(c))).toEqual(["good?"]);
  });
});

describe("home.resurfaced — the choice", () => {
  it("gives the same three for the same date and seed", async () => {
    const { c } = await open(crowd());
    const first = names(await resurfaced(c, 0));
    expect(first).toHaveLength(3);
    expect(names(await resurfaced(c, 0))).toEqual(first);
    expect(names(await resurfaced(c))).toEqual(first);
  });

  it("gives another three for another seed", async () => {
    const { c } = await open(crowd());
    const picks = new Set<string>();
    for (const seed of [0, 1, 2, 3, 4]) {
      picks.add(names(await resurfaced(c, seed)).join("|"));
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it("gives another three tomorrow", async () => {
    let now = TODAY;
    const { c } = await open(crowd(), () => now);
    const picks = new Set<string>();
    for (let day = 0; day < 5; day++) {
      now = new Date(TODAY.getTime() + day * DAY);
      picks.add(names(await resurfaced(c)).join("|"));
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it("shows what exists when fewer than three are eligible", async () => {
    const { c } = await open({
      "a.md": question("a", { captured: daysAgo(70) }),
      "b.md": question("b", { captured: daysAgo(80) }),
    });
    expect((await resurfaced(c)).questions).toHaveLength(2);
  });

  it("returns nothing for an empty pool", async () => {
    const { c } = await open({
      "new.md": question("new", { captured: daysAgo(2) }),
    });
    expect((await resurfaced(c)).questions).toEqual([]);
  });

  it("carries the Inbox's row and no count of the pool", async () => {
    const { vault, c } = await open({
      "old.md": question("old", {
        captured: daysAgo(100),
        extra: "from: Staresina 2015\npage: 7\n",
      }),
      ...crowd(),
    });
    const data = await resurfaced(c);
    expect(Object.keys(data)).toEqual(["questions"]);
    const listed = (
      await c.query<{ questions: ListedQuestion[] }>("questions.list", {
        order: "newest",
      })
    ).result!.data.questions;
    for (const q of data.questions) {
      expect(q).toEqual(listed.find((l) => l.path === q.path));
      expect(q.path.startsWith(vault)).toBe(true);
    }
  });
});

describe("home.dismissResurfaced", () => {
  const files = () => ({
    "keep.md": question("keep", { captured: daysAgo(90) }),
    "gone.md": question("gone", { captured: daysAgo(91) }),
  });

  it("leaves the Question's file byte-identical and takes it out of the next read", async () => {
    const { vault, c } = await open(files());
    const path = join(vault, "gone.md");
    const before = await readFile(path);

    const reply = await c.mutate("home.dismissResurfaced", { path });

    expect(reply.error).toBeUndefined();
    expect(Buffer.compare(await readFile(path), before)).toBe(0);
    expect(names(await resurfaced(c))).toEqual(["keep?"]);
  });

  it("is written under the resurfaced row kind, keyed by the Question's id", async () => {
    const { vault, c } = await open(files());
    await c.mutate("home.dismissResurfaced", { path: join(vault, "gone.md") });
    const written: unknown = JSON.parse(
      await readFile(join(vault, ".vitrine/dismissals.json"), "utf8")
    );
    expect(written).toEqual({
      "q-gone": { resurfaced: TODAY.toISOString() },
    });
  });

  it("keys a Question with no id by its vault-relative path", async () => {
    const { vault, c } = await open({
      "no-id.md": question("no-id", { captured: daysAgo(90), id: null }),
    });
    await c.mutate("home.dismissResurfaced", { path: join(vault, "no-id.md") });
    const written = JSON.parse(
      await readFile(join(vault, ".vitrine/dismissals.json"), "utf8")
    ) as Record<string, unknown>;
    expect(Object.keys(written)).toEqual(["no-id.md"]);
    expect((await resurfaced(c)).questions).toEqual([]);
  });

  it("is undone by home.undismissResurfaced", async () => {
    const { vault, c } = await open(files());
    const path = join(vault, "gone.md");
    await c.mutate("home.dismissResurfaced", { path });

    const reply = await c.mutate("home.undismissResurfaced", { path });

    expect(reply.error).toBeUndefined();
    expect(names(await resurfaced(c)).sort()).toEqual(["gone?", "keep?"]);
  });

  it("is not silenced by a Loose Ends dismissal of the same Question, of any kind", async () => {
    const { vault, c } = await open(files());
    for (const kind of [
      "stalled-research-question",
      "no-source",
      "failed-scout",
    ]) {
      await c.mutate("looseEnds.dismiss", { subject: "q-gone", kind });
    }
    expect(names(await resurfaced(c)).sort()).toEqual(["gone?", "keep?"]);

    // And it is not the Loose Ends procedures that undo it.
    await c.mutate("home.dismissResurfaced", { path: join(vault, "gone.md") });
    await c.mutate("looseEnds.undismiss", {
      subject: "q-gone",
      kind: "stalled-research-question",
    });
    expect(names(await resurfaced(c))).toEqual(["keep?"]);
  });

  it("does not silence a Loose Ends row about an object with the same key", async () => {
    // Keys are ids, and a Question and a Research Question that share one
    // are the case where only the row kind tells the two dismissals apart.
    const stalled = `---
id: q-gone
kind: research-question
question: "stale?"
status: open
promoted_from: "[[stale]]"
promoted: 2026-01-05T09:00:00+01:00
context: other
---

## Working answer

## Supporting sources

## Opposing sources

## Related questions

## Open threads

## Position history
`;
    let now = TODAY;
    const { vault, c } = await open(
      { ...files(), "q/stale (RQ).md": stalled },
      () => now
    );
    for (let day = 1; day <= 3; day++) {
      now = new Date(TODAY.getTime() + day * DAY);
      await c.focused();
    }
    await c.mutate("home.dismissResurfaced", { path: join(vault, "gone.md") });

    const reply = await c.query<{ groups: Array<{ rows: unknown[] }> }>(
      "looseEnds.rows"
    );
    expect(reply.result!.data.groups.flatMap((g) => g.rows)).toHaveLength(1);
  });

  it("does not rewrite a dismissals.json that does not parse", async () => {
    const { vault, c } = await open(files());
    const file = join(vault, ".vitrine/dismissals.json");
    await writeFile(file, "{ not json");

    const reply = await c.mutate("home.dismissResurfaced", {
      path: join(vault, "gone.md"),
    });

    expect(reply.error?.data.kind).toBe("writeFailed");
    expect(await readFile(file, "utf8")).toBe("{ not json");
  });

  it("refuses a path that is not a Question in the vault", async () => {
    const { vault, c } = await open(files());
    const reply = await c.mutate("home.dismissResurfaced", {
      path: join(vault, "nowhere.md"),
    });
    expect(reply.error).toBeDefined();
  });
});
