import { chmod, mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LooseEnds } from "./loose-ends.js";
import {
  closeCores,
  core,
  tmp,
  vaultWith,
  type CoreOptions,
} from "./test-core.js";

// Loose Ends' two Experiment rows (#374; spec #362 stories 73–78): a run
// complete with Artifacts and no observations, gone quiet (REP-9), and a
// linked Artifact recorded on this machine whose path is gone (REP-6).

afterEach(closeCores);

// A quiet period is counted in open days, never calendar days (#243): each
// test says which dates the vault was open on, and when the run's file last
// changed. `at` is midday in one zone throughout.
const at = (day: string) => new Date(`${day}T12:00:00+01:00`);

function days(day: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(at(day).getTime() + i * 24 * 60 * 60 * 1000);
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    );
  }
  return out;
}

const RUN = "experiments/prereg-exclusions/prereg-exclusions.md";
const HYPOTHESIS = "hypotheses/Preregistered reanalysis shrinks the effect.md";
const CLAIM = "Preregistered reanalysis will shrink the pooled effect.";

const experiment = ({
  status = "complete",
  artifacts = "- ![[forest.png]] — the forest plot",
  observations = "",
}: {
  status?: string;
  artifacts?: string;
  observations?: string;
} = {}) => `---
id: ex-prereg
kind: experiment
name: "prereg-exclusions"
status: ${status}
created: 2026-09-01T10:00:00+02:00
tags: []
---

## Purpose

## Design

## Where it ran

## Artifacts

${artifacts}

## Observations

${observations}

## Position history
`;

const hypothesis = (criteria: string) => `---
id: hy-prereg
kind: hypothesis
promoted: 2026-09-01T10:00:00+02:00
context: reading
---

## Claim

${CLAIM}

## Criteria

${criteria}

## Design notes

## Position history
`;

const F1 =
  "### The effect survives the exclusion rule ^c1\n\nrelationship:: falsifying";
const C2 =
  "### The pooled effect drops below d = 0.20 ^c2\n\nrelationship:: confirming";
const EVIDENCE = "- [[prereg-exclusions]] — it did not move";

/** A linked line as `addArtifact` writes it (ADR 0035 decision 5). */
const linked = (file: string, target: string, machine = "this-mac") =>
  `- ${file} — ${target} · 2.4 GB · 2026-09-02 · ${machine} · 2400000000:1790000000000:0123456789ab — the checkpoint`;

/**
 * The vault written, the run's file dated `changed`, then opened on the
 * first of `open` and brought to the front on each of the rest — the two
 * seams that record an open day.
 */
async function openedOn(
  files: Record<string, string>,
  open: string[],
  { changed = at("2026-09-10"), ...opts }: CoreOptions & { changed?: Date } = {}
) {
  let today = at(open[0]!);
  const vault = await vaultWith(files);
  if (files[RUN] !== undefined) {
    await utimes(join(vault, RUN), changed, changed);
  }
  const c = await core({ now: () => today, stalledOpenDays: 3, ...opts });
  const reply = await c.mutate("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  for (const day of open.slice(1)) {
    today = at(day);
    await c.focused();
  }
  return { vault, c };
}

async function rows(c: {
  query: <T>(p: string) => Promise<{ result?: { data: T }; error?: unknown }>;
}) {
  const reply = await c.query<LooseEnds>("looseEnds.rows");
  expect(reply.error).toBeUndefined();
  return reply.result!.data;
}

const kinds = (ends: LooseEnds, kind: string) =>
  ends.groups.flatMap(({ group, rows }) =>
    rows.filter((r) => r.kind === kind).map((row) => ({ group, row }))
  );

describe("looseEnds.rows — the stalled Experiment", () => {
  const files = (page = experiment()) => ({
    [RUN]: page,
    "experiments/prereg-exclusions/forest.png": "png",
  });

  it("lists a complete run with an Artifact and no observations, quiet the threshold's open days since the file last changed", async () => {
    const { c } = await openedOn(files(), days("2026-09-20", 3));
    const ends = await rows(c);
    expect(ends.problems).toEqual([]);
    expect(kinds(ends, "stalled-experiment")).toEqual([
      {
        group: "Stalled questions",
        row: {
          kind: "stalled-experiment",
          subject: "ex-prereg",
          path: RUN,
          title: "prereg-exclusions",
          quietOpenDays: 3,
          artifacts: 1,
        },
      },
    ]);
  });

  it("leaves one out while it has been quiet fewer open days than the threshold, however long ago the calendar says", async () => {
    const { c } = await openedOn(files(), days("2026-09-20", 2), {
      changed: at("2026-01-10"),
    });
    expect(kinds(await rows(c), "stalled-experiment")).toEqual([]);
  });

  it("does not count the day the file changed on", async () => {
    const { c } = await openedOn(files(), days("2026-09-20", 3), {
      changed: at("2026-09-20"),
    });
    expect(kinds(await rows(c), "stalled-experiment")).toEqual([]);
  });

  it("leaves out one with observations written", async () => {
    const { c } = await openedOn(
      files(experiment({ observations: "The effect did not move." })),
      days("2026-09-20", 3)
    );
    expect(kinds(await rows(c), "stalled-experiment")).toEqual([]);
  });

  it("leaves out one with no Artifact line: there is no result to read", async () => {
    const { c } = await openedOn(
      files(experiment({ artifacts: "" })),
      days("2026-09-20", 3)
    );
    expect(kinds(await rows(c), "stalled-experiment")).toEqual([]);
  });

  it("leaves out one whose only line under Artifacts is not an Artifact: a note is not a result", async () => {
    const { c } = await openedOn(
      files(
        experiment({ artifacts: "- plots to follow once the sweep is done" })
      ),
      days("2026-09-20", 3)
    );
    expect(kinds(await rows(c), "stalled-experiment")).toEqual([]);
  });

  it("counts only the Artifact lines, not a note beside them", async () => {
    const { c } = await openedOn(
      files(
        experiment({
          artifacts: "- ![[forest.png]] — the forest plot\n- more to come",
        })
      ),
      days("2026-09-20", 3)
    );
    expect(kinds(await rows(c), "stalled-experiment")[0]?.row).toMatchObject({
      artifacts: 1,
    });
  });

  it("leaves out one that is not complete", async () => {
    for (const status of ["planned", "running", "abandoned"]) {
      const { c } = await openedOn(
        files(experiment({ status })),
        days("2026-09-20", 3)
      );
      expect(kinds(await rows(c), "stalled-experiment")).toEqual([]);
    }
  });

  it("lists one whether or not it is Evidence: a run that never attaches is not unfinished, and one that did is still unread (HOLD-6)", async () => {
    const { c } = await openedOn(
      { ...files(), [HYPOTHESIS]: hypothesis(`${C2}\n\n${EVIDENCE}`) },
      days("2026-09-20", 3)
    );
    expect(kinds(await rows(c), "stalled-experiment")).toHaveLength(1);
  });

  it("is silenced by mark deliberate keyed by its own row kind, and back on undo", async () => {
    const { c } = await openedOn(files(), days("2026-09-20", 3));
    const row = { subject: "ex-prereg", kind: "stalled-experiment" };
    expect((await c.mutate("looseEnds.dismiss", row)).error).toBeUndefined();
    expect(kinds(await rows(c), "stalled-experiment")).toEqual([]);
    expect((await c.mutate("looseEnds.undismiss", row)).error).toBeUndefined();
    expect(kinds(await rows(c), "stalled-experiment")).toHaveLength(1);
  });
});

describe("looseEnds.rows — the missing linked Artifact", () => {
  // Opened on one day only, so the stalled row never joins in.
  const once = days("2026-09-20", 1);

  it("lists one row per Experiment naming each file recorded on this machine whose path no longer stats", async () => {
    const elsewhere = await tmp("disk");
    const here = join(elsewhere, "here.ckpt");
    await writeFile(here, "bytes");
    const { c } = await openedOn(
      {
        [RUN]: experiment({
          artifacts: [
            linked("step-1000.ckpt", join(elsewhere, "step-1000.ckpt")),
            linked("here.ckpt", here),
            linked("step-2000.ckpt", join(elsewhere, "step-2000.ckpt")),
          ].join("\n"),
        }),
      },
      once
    );
    expect(kinds(await rows(c), "missing-artifact")).toEqual([
      {
        group: "Stalled questions",
        row: {
          kind: "missing-artifact",
          subject: "ex-prereg",
          path: RUN,
          title: "prereg-exclusions",
          missing: [
            {
              file: "step-1000.ckpt",
              target: join(elsewhere, "step-1000.ckpt"),
            },
            {
              file: "step-2000.ckpt",
              target: join(elsewhere, "step-2000.ckpt"),
            },
          ],
          falsifying: [],
        },
      },
    ]);
  });

  it("never lists a link recorded on another machine, or a URL", async () => {
    const elsewhere = await tmp("disk");
    const { c } = await openedOn(
      {
        [RUN]: experiment({
          artifacts: [
            linked("a.ckpt", join(elsewhere, "a.ckpt"), "laptop"),
            "- run — https://wandb.ai/lab/run/abc · 2026-09-02 · this-mac — the W&B run",
          ].join("\n"),
        }),
      },
      once
    );
    expect(kinds(await rows(c), "missing-artifact")).toEqual([]);
  });

  it("reads a link made here as this machine's when its name had to be cleaned to fit the line", async () => {
    const elsewhere = await tmp("disk");
    const { c } = await openedOn(
      {
        // The line cannot hold its own separators, so `Studio · Mac` was
        // recorded as `Studio Mac`.
        [RUN]: experiment({
          artifacts: linked("a.ckpt", join(elsewhere, "a.ckpt"), "Studio Mac"),
        }),
      },
      once,
      { machine: "Studio · Mac" }
    );
    expect(kinds(await rows(c), "missing-artifact")).toHaveLength(1);
  });

  it("names a path it could not check rather than calling the file gone", async () => {
    const elsewhere = await tmp("disk");
    const locked = join(elsewhere, "locked");
    await mkdir(locked);
    await writeFile(join(locked, "a.ckpt"), "bytes");
    await chmod(locked, 0o000);
    try {
      const { c } = await openedOn(
        {
          [RUN]: experiment({
            artifacts: linked("a.ckpt", join(locked, "a.ckpt")),
          }),
        },
        once
      );
      const ends = await rows(c);
      expect(kinds(ends, "missing-artifact")).toEqual([]);
      expect(ends.problems).toEqual([
        expect.stringMatching(
          /^experiments\/prereg-exclusions\/prereg-exclusions\.md: a\.ckpt could not be checked/
        ),
      ]);
    } finally {
      await chmod(locked, 0o755);
    }
  });

  it("is loud, under Broken plumbing, when the run is Evidence under a falsifying Criterion with an Outcome recorded", async () => {
    const elsewhere = await tmp("disk");
    const { c } = await openedOn(
      {
        [RUN]: experiment({
          artifacts: linked("a.ckpt", join(elsewhere, "a.ckpt")),
        }),
        [HYPOTHESIS]: hypothesis(`${F1}\noutcome:: met\n\n${EVIDENCE}`),
      },
      once
    );
    const found = kinds(await rows(c), "missing-artifact");
    expect(found.map(({ group }) => group)).toEqual(["Broken plumbing"]);
    expect(found[0]?.row).toMatchObject({
      falsifying: [{ path: HYPOTHESIS, claim: CLAIM, criterion: "F1" }],
    });
  });

  it("stays under Stalled questions when the falsifying Criterion has no Outcome yet, or the Criterion is not falsifying", async () => {
    for (const criteria of [
      `${F1}\n\n${EVIDENCE}`,
      `${C2}\noutcome:: met\n\n${EVIDENCE}`,
    ]) {
      const elsewhere = await tmp("disk");
      const { c } = await openedOn(
        {
          [RUN]: experiment({
            artifacts: linked("a.ckpt", join(elsewhere, "a.ckpt")),
          }),
          [HYPOTHESIS]: hypothesis(criteria),
        },
        once
      );
      expect(
        kinds(await rows(c), "missing-artifact").map(({ group, row }) => [
          group,
          "falsifying" in row ? row.falsifying : null,
        ])
      ).toEqual([["Stalled questions", []]]);
    }
  });

  it("is silenced by mark deliberate keyed by its own row kind, leaving the stalled row about the same run, and back on undo", async () => {
    const elsewhere = await tmp("disk");
    const { c } = await openedOn(
      {
        [RUN]: experiment({
          artifacts: linked("a.ckpt", join(elsewhere, "a.ckpt")),
        }),
      },
      days("2026-09-20", 3)
    );
    const row = { subject: "ex-prereg", kind: "missing-artifact" };
    expect((await c.mutate("looseEnds.dismiss", row)).error).toBeUndefined();
    let ends = await rows(c);
    expect(kinds(ends, "missing-artifact")).toEqual([]);
    expect(kinds(ends, "stalled-experiment")).toHaveLength(1);
    expect((await c.mutate("looseEnds.undismiss", row)).error).toBeUndefined();
    ends = await rows(c);
    expect(kinds(ends, "missing-artifact")).toHaveLength(1);
  });
});
