import { utimes } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactCheck } from "./artifact.js";
import type { ExperimentListing, ExperimentPage } from "./experiment.js";
import type { LooseEnds } from "./loose-ends.js";
import {
  closeCores,
  core,
  fixtureCopy,
  type CoreOptions,
} from "./test-core.js";

// The fixture vault's Experiments (#375): the four runs beat 4's closing demo
// is driven over, and that `docs/agents/run.md` offers any later run. Each
// is here for one state the surface draws, so a change that stops a run
// reading as its state fails here, not in the next demo:
// - `sw-density-recall` — complete, written up, and Evidence under the
//   Hypothesis's falsifying Criterion with an Outcome recorded; stored
//   Artifacts inline, and one linked on the lab machine;
// - `spindle-replay-rerun` — complete with a plot and no observations;
// - `overnight-vs-wake` — running, with a plot in its folder and no line;
// - `closed-loop-boost` — planned, *came from* the Hypothesis.

afterEach(closeCores);

const RUN = "experiments/sw-density-recall/sw-density-recall.md";
const UNREAD = "experiments/spindle-replay-rerun/spindle-replay-rerun.md";
const IN_FOLDER = "experiments/overnight-vs-wake/overnight-vs-wake.md";
const PLANNED = "experiments/closed-loop-boost/closed-loop-boost.md";
const HYPOTHESIS =
  "hypotheses/Slow-wave density on the retention night predicts overnight recall gain beyond.md";
const LAB = "Lab iMac";

type Readable = Extract<ExperimentPage, { readable: true }>;

async function opened(
  opts: CoreOptions = {},
  before: (vault: string) => Promise<void> = async () => {}
) {
  const vault = await fixtureCopy("obsidian-vault");
  await before(vault);
  const c = await core({ machine: "Studio Mac", ...opts });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const data = async <T>(
    reply: Promise<{ result?: { data: T }; error?: unknown }>
  ) => {
    const r = await reply;
    expect(r.error).toBeUndefined();
    return r.result!.data;
  };
  const page = async (path: string): Promise<Readable> => {
    const read = await data(
      c.query<ExperimentPage>("experiments.page", { path })
    );
    if (!read.readable) throw new Error(read.reason);
    return read;
  };
  return { vault, c, data, page };
}

describe("the fixture vault's Experiments", () => {
  it("puts only the complete run nobody has read in the Experiment Inbox, and every run under its status", async () => {
    const { c, data } = await opened();
    const inbox = await data(
      c.query<ExperimentListing>("experiments.inbox", {
        facet: "inbox",
        sort: "newest",
      })
    );
    expect(inbox.unreadable).toEqual([]);
    expect(inbox.runs).toBe(4);
    expect(inbox.experiments.map((r) => [r.path, r.reading])).toEqual([
      [UNREAD, "not yet read"],
    ]);

    const all = await data(
      c.query<ExperimentListing>("experiments.inbox", {
        facet: "status",
        sort: "oldest",
      })
    );
    expect(all.experiments.map((r) => [r.name, r.status, r.reading])).toEqual([
      ["sw-density-recall", "complete", "attached"],
      ["spindle-replay-rerun", "complete", "not yet read"],
      ["overnight-vs-wake", "running", "not yet read"],
      ["closed-loop-boost", "planned", "not yet read"],
    ]);
    expect(all.projects).toEqual([
      "github.com/sleep-lab/spindles",
      "github.com/sleep-lab/sw-density",
    ]);
  });

  it("draws the complete run's stored Artifacts inline beside its lab-machine link, Evidence under the falsifying Criterion", async () => {
    const { page } = await opened();
    const run = await page(RUN);
    expect(run.problems).toEqual([]);
    expect(run.sections.artifacts.inFolder).toEqual([]);
    expect(
      run.sections.artifacts.items.map((a) =>
        a.kind === "stored"
          ? [a.kind, a.file, a.image, a.rows, a.size !== null]
          : a.kind === "linked"
            ? [a.kind, a.file, a.machine, a.url]
            : [a.kind]
      )
    ).toEqual([
      ["stored", "recall-vs-density.png", true, false, true],
      ["stored", "per-subject.csv", false, true, true],
      ["linked", "bootstrap-draws.parquet", LAB, false],
    ]);
    expect(run.evidence).toEqual([
      {
        hypothesis: {
          path: HYPOTHESIS,
          claim:
            "Slow-wave density on the retention night predicts overnight recall gain beyond encoding strength.",
        },
        criterion: expect.objectContaining({
          id: "c2",
          relationship: "falsifying",
          outcome: "not met",
        }),
        note: "partialling out evening recall leaves r = 0.36 — the correlation does not vanish",
      },
    ]);
    // A design revised after it was first written, with its why.
    expect(
      run.sections.positionHistory.entries.map((e) => [e.field, e.why])
    ).toEqual([
      ["observations", null],
      [
        "design",
        "the first draft never said artefacted epochs are dropped, or which covariate stands for encoding",
      ],
      ["design", null],
    ]);
  });

  it("says the lab machine's link is on another machine, named, when checked anywhere else (TEST-13)", async () => {
    const { c, data } = await opened();
    expect(
      await data(
        c.query<{ checks: ArtifactCheck[] }>("experiments.checkArtifacts", {
          path: RUN,
        })
      )
    ).toEqual({
      checks: [
        {
          file: "bootstrap-draws.parquet",
          target: "/Users/lab/runs/sw-density/bootstrap-draws.parquet",
          machine: LAB,
          outcome: "elsewhere",
        },
      ],
    });
  });

  it("offers the plot a script left in a run's folder as in the folder, not on the page", async () => {
    const { page } = await opened();
    const run = await page(IN_FOLDER);
    expect(run.sections.artifacts.items).toEqual([]);
    expect(run.sections.artifacts.inFolder).toEqual([
      expect.objectContaining({
        file: "retention-curves.png",
        image: true,
      }),
    ]);
  });

  it("keeps a planned run's empty regions empty, and names the Hypothesis it came from", async () => {
    const { page } = await opened();
    const run = await page(PLANNED);
    expect(run.frontmatter.status).toBe("planned");
    expect(run.sections.design.text).toBe("");
    expect(run.sections.artifacts.items).toEqual([]);
    expect(run.evidence).toEqual([]);
    expect(run.cameFrom).toMatchObject({
      path: HYPOTHESIS,
      kind: "hypothesis",
    });
  });
});

describe("the fixture vault's Experiments on Loose Ends", () => {
  const day = (d: string) => new Date(`${d}T12:00:00+01:00`);

  async function rows(machine: string) {
    let today = day("2026-09-28");
    // The unread run last changed well before the three open days counted.
    const { c, data } = await opened(
      { machine, now: () => today, stalledOpenDays: 3 },
      (vault) =>
        utimes(join(vault, UNREAD), day("2026-09-23"), day("2026-09-23"))
    );
    for (const d of ["2026-09-29", "2026-09-30"]) {
      today = day(d);
      await c.focused();
    }
    const ends = await data(c.query<LooseEnds>("looseEnds.rows"));
    return ends.groups.flatMap(({ group, rows }) =>
      rows
        .filter(
          (r) => r.kind.endsWith("experiment") || r.kind === "missing-artifact"
        )
        .map((r) => [group, r.kind, r.path])
    );
  }

  it("raises the unread run once quiet, and never the lab machine's link from here", async () => {
    expect(await rows("Studio Mac")).toEqual([
      ["Stalled questions", "stalled-experiment", UNREAD],
    ]);
  });

  it("raises the lab machine's own missing link loud, under Broken plumbing, since a falsification rests on it", async () => {
    expect(await rows(LAB)).toEqual([
      ["Broken plumbing", "missing-artifact", RUN],
      ["Stalled questions", "stalled-experiment", UNREAD],
    ]);
  });
});
