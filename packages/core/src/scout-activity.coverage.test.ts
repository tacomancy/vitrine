import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { GAP_ROWS, type ScoutActivity } from "./scout-activity.js";
import {
  arxivScout,
  daysAgo,
  openedWithQueue,
  watchedScout,
} from "./scout-queue-seed.js";
import { closeCores } from "./test-core.js";
import { NO_KEY } from "./watched.js";

afterEach(closeCores);

// Coverage gaps (#519; ADR 0042 decision 4): the open Map rows no Scout is
// looking for. The Questions are files in the vault and the Scouts are files
// with seeded runs; what is asserted is what the block says.

const question = (
  id: string | null,
  text: string,
  captured = "2026-09-01T10:00:00Z"
) =>
  `---\n${id === null ? "" : `id: ${id}\n`}kind: question\nquestion: "${text}"\nstatus: open\ncaptured: ${captured}\ncontext: other\n---\n`;

/** A Question that has been promoted, and the open page that folds it in. */
const PROMOTED = {
  "q/fold.md": `---\nid: q-fold\nkind: question\nquestion: "Folded?"\nstatus: promoted\ncaptured: 2026-09-01T10:00:00Z\n---\n`,
  "q/page.md": `---\nid: rq-fold\nkind: research-question\nquestion: "Folded?"\nstatus: open\npromoted_from: "[[fold]]"\npromoted: 2026-09-10T10:00:00Z\ncaptured: 2026-09-01T10:00:00Z\n---\n\n## Working answer\n`,
};

/** The fixture vault's own two open rows: a Question, and a Research Question whose Question file is gone. */
const FIXTURE_IDS = ["k7m2p9q4wx", "rq2b7x9mk4"];

const withAssigned = (scout: string, ids: string[]) =>
  `${scout}assigned:\n${ids.map((id) => `  - ${id}`).join("\n")}\n`;

/** A finished run, newest yesterday: `failed` gives it the fault a Scout's Voice is read from. */
const insertRun = (
  db: DatabaseSync,
  scout: string,
  failed?: { kind: string; message: string }
) =>
  db
    .prepare(
      `INSERT INTO scout_runs (scout_id, started, finished, outcome, error_kind, error_message, window_from, window_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      scout,
      daysAgo(1),
      daysAgo(1),
      failed === undefined ? "ok" : "failed",
      failed?.kind ?? null,
      failed?.message ?? null,
      daysAgo(2),
      daysAgo(1)
    );

async function opened(
  scouts: Record<string, string>,
  files: Record<string, string> = {}
) {
  const { c, db } = await openedWithQueue(scouts, files);
  return {
    db,
    coverage: async () => {
      const r = await c.query<ScoutActivity>("scouts.activity");
      expect(r.error).toBeUndefined();
      return r.result!.data.coverageGaps;
    },
    /** The gaps listed, or a failure naming what the block said instead. */
    gaps: async () => {
      const r = await c.query<ScoutActivity>("scouts.activity");
      expect(r.error).toBeUndefined();
      const coverage = r.result!.data.coverageGaps;
      if (coverage.kind !== "gaps") throw new Error("expected gaps");
      return coverage;
    },
  };
}

describe("scouts.activity — coverage gaps", () => {
  it("is a gap when no Scout is Assigned, or its only Scout is paused or waiting on a key — and not when its only Scout is broken", async () => {
    const f = await opened(
      {
        "paused.yaml": `${withAssigned(arxivScout("paused"), ["q-paused"])}paused: true\n`,
        "keyless.yaml": withAssigned(watchedScout("keyless"), ["q-keyless"]),
        "broken.yaml": withAssigned(arxivScout("broken"), ["q-broken"]),
        // Looks at the fixture's rows, so only the four below can be gaps.
        "looking.yaml": withAssigned(arxivScout("looking"), FIXTURE_IDS),
      },
      {
        "q/none.md": question("q-none", "Nobody assigned?"),
        "q/paused.md": question("q-paused", "Only a paused Scout?"),
        "q/keyless.md": question("q-keyless", "Only a keyless Scout?"),
        "q/broken.md": question("q-broken", "Only a broken Scout?"),
      }
    );
    insertRun(f.db, "keyless", { kind: "credentials", message: NO_KEY });
    insertRun(f.db, "broken", { kind: "http", message: "HTTP 503" });
    insertRun(f.db, "looking");

    const { shown, notShown } = await f.gaps();

    expect(notShown).toBe(0);
    expect(
      shown.map(({ question, notLooking }) => [question, notLooking])
    ).toEqual(
      expect.arrayContaining([
        ["Nobody assigned?", []],
        [
          "Only a paused Scout?",
          [{ id: "paused", name: "paused", reason: "paused" }],
        ],
        [
          "Only a keyless Scout?",
          [{ id: "keyless", name: "keyless", reason: "waiting on a key" }],
        ],
      ])
    );
    expect(shown).toHaveLength(3);
  });

  it("is not a gap while one of its Scouts is looking, whatever its other Scouts are doing", async () => {
    const f = await opened(
      {
        "looking.yaml": withAssigned(arxivScout("looking"), [
          ...FIXTURE_IDS,
          "q-shared",
        ]),
        "resting.yaml": `${withAssigned(arxivScout("resting"), ["q-shared"])}paused: true\n`,
      },
      { "q/shared.md": question("q-shared", "Shared?") }
    );
    insertRun(f.db, "looking");

    expect(await f.coverage()).toMatchObject({ kind: "covered" });
  });

  // A dropped Scout is retired and covers nothing (ADR 0042 decisions 1 and 4,
  // #521): the Question it was Assigned to is a gap that names it, and one a
  // Scout that is looking shares with it is not.
  it("is a gap when its only Scout is dropped, naming it, and not one while a Scout that is looking shares it", async () => {
    const f = await opened(
      {
        "gone.yaml": `${withAssigned(arxivScout("gone"), ["q-gone", "q-shared"])}dropped: 2026-09-20T00:00:00Z\n`,
        "looking.yaml": withAssigned(arxivScout("looking"), [
          ...FIXTURE_IDS,
          "q-shared",
        ]),
      },
      {
        "q/gone.md": question("q-gone", "Only a dropped Scout?"),
        "q/shared.md": question("q-shared", "Shared with a dropped one?"),
      }
    );
    insertRun(f.db, "looking");

    const { shown, notShown } = await f.gaps();

    expect(notShown).toBe(0);
    expect(
      shown.map(({ question, notLooking }) => [question, notLooking])
    ).toEqual([
      [
        "Only a dropped Scout?",
        [{ id: "gone", name: "gone", reason: "dropped" }],
      ],
    ]);
  });

  it("claims coverage over the Scouts that are looking without counting or naming one that is dropped", async () => {
    const f = await opened({
      "looking.yaml": withAssigned(arxivScout("looking"), FIXTURE_IDS),
      "gone.yaml": `${arxivScout("gone")}dropped: 2026-09-20T00:00:00Z\n`,
    });
    insertRun(f.db, "looking");

    expect(await f.coverage()).toEqual({
      kind: "covered",
      warrant: { questions: 2, scouts: 1 },
      notLooking: [],
    });
  });

  it("covers a Scout that has not run yet: it is due at its next check", async () => {
    const f = await opened({
      "new.yaml": withAssigned(arxivScout("new"), FIXTURE_IDS),
    });

    expect(await f.coverage()).toEqual({
      kind: "covered",
      warrant: { questions: 2, scouts: 1 },
      notLooking: [],
    });
  });

  it("lists a promoted Question folded into its Research Question once, naming the Question the form can offer", async () => {
    const f = await opened(
      {
        "looking.yaml": withAssigned(arxivScout("looking"), FIXTURE_IDS),
      },
      PROMOTED
    );

    const { shown } = await f.gaps();

    expect(shown).toEqual([
      expect.objectContaining({
        path: "q/page.md",
        question: "Folded?",
        assign: "q-fold",
      }),
    ]);
  });

  it.each([
    ["the Question's id", "q-fold"],
    ["the page's own id", "rq-fold"],
  ])("is covered by a Scout Assigned to %s", async (_, id) => {
    const f = await opened(
      { "s.yaml": withAssigned(arxivScout("s"), [...FIXTURE_IDS, id]) },
      PROMOTED
    );

    expect(await f.coverage()).toMatchObject({
      kind: "covered",
      warrant: { questions: 3, scouts: 1 },
    });
  });

  it("is still a gap for a row with no id, which no Scout can be Assigned to, and says there is none to Assign", async () => {
    const f = await opened(
      { "looking.yaml": withAssigned(arxivScout("looking"), FIXTURE_IDS) },
      { "q/anon.md": question(null, "Nobody could be Assigned?") }
    );

    expect((await f.gaps()).shown).toEqual([
      expect.objectContaining({
        path: "q/anon.md",
        assign: null,
        notLooking: [],
      }),
    ]);
  });

  it("offers a Research Question's own id when no Question stands behind it", async () => {
    const f = await opened({
      "looking.yaml": withAssigned(arxivScout("looking"), ["k7m2p9q4wx"]),
    });

    expect((await f.gaps()).shown).toEqual([
      expect.objectContaining({ assign: "rq2b7x9mk4" }),
    ]);
  });

  it("does not count a Scout file that will not parse as looking: what it is Assigned to is not known", async () => {
    const f = await opened(
      {
        "torn.yaml": "name: [unclosed\nassigned: [k7m2p9q4wx]\n",
        "looking.yaml": withAssigned(arxivScout("looking"), ["rq2b7x9mk4"]),
      },
      {}
    );
    insertRun(f.db, "looking");

    expect((await f.gaps()).shown.map((g) => g.assign)).toEqual(["k7m2p9q4wx"]);
  });

  it("cuts a long list at a stated length, newest first, says how many are not shown, and never totals the gaps", async () => {
    const files: Record<string, string> = {};
    const made = GAP_ROWS + 4;
    for (let i = 0; i < made; i++) {
      files[`q/${i}.md`] = question(
        `q${i}`,
        `Question ${i}?`,
        `2026-09-0${i + 1}T10:00:00Z`
      );
    }
    const f = await opened(
      { "looking.yaml": withAssigned(arxivScout("looking"), FIXTURE_IDS) },
      files
    );

    const coverage = await f.gaps();

    // The Map's own order, so the cut hides the oldest and ranks nothing.
    expect(coverage.shown.map((g) => g.question)).toEqual(
      Array.from({ length: GAP_ROWS }, (_, i) => `Question ${made - 1 - i}?`)
    );
    expect(coverage.notShown).toBe(made - GAP_ROWS);
    expect(JSON.stringify(coverage)).not.toMatch(/total/i);
  });

  it("carries each gap's age as the phrase a run uses", async () => {
    const f = await opened(
      { "looking.yaml": withAssigned(arxivScout("looking"), FIXTURE_IDS) },
      { "q/old.md": question("q-old", "Old?", daysAgo(3)) }
    );

    expect((await f.gaps()).shown[0]).toMatchObject({
      question: "Old?",
      age: "3 days ago",
    });
  });

  it("with no gaps is a claim that counts what it checked and names any Scout not looking", async () => {
    const f = await opened({
      "looking.yaml": withAssigned(arxivScout("looking"), FIXTURE_IDS),
      "resting.yaml": `${arxivScout("resting")}paused: true\n`,
    });
    insertRun(f.db, "looking");

    expect(await f.coverage()).toEqual({
      kind: "covered",
      warrant: { questions: 2, scouts: 1 },
      notLooking: [{ id: "resting", name: "resting", reason: "paused" }],
    });
  });
});
