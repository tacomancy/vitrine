import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CriteriaToAttach, ExperimentPage } from "./experiment.js";
import { closeCores, core, vaultWith } from "./test-core.js";
import { localIso } from "./time.js";

// Attaching a run as Evidence from its page (#367; spec #362 stories 22–24,
// 45, 47–51, 55; TEST-12). One write under the Criterion's `^c<n>`: the
// Evidence line and the `· criterion <label>` Revision, through the
// Hypothesis's own write path, so a live Override is voided and the Derived
// state re-derived as any criterion Revision does — and no Outcome, ever.
// The page reads its attachments back from the Index's links out of
// `## Criteria` blocks, so a line written in Obsidian shows as well.

afterEach(closeCores);

type Vault = { name: string; path: string };
type Readable = Extract<ExperimentPage, { readable: true }>;
type Written =
  | { written: true; hash: string; revision: string | null }
  | { written: false; reason: string; detail: string };

const RUN = "experiments/prereg-exclusions/prereg-exclusions.md";
const OTHER_RUN = "experiments/leave-one-lab-out/leave-one-lab-out.md";
const H1 = "hypotheses/Preregistered reanalysis shrinks the effect.md";
const H2 = "hypotheses/Harmonising removes between-lab variance.md";
const PROMOTED = "2026-09-20T10:00:00+02:00";

const run = (name: string) => `---
id: ex-${name}
kind: experiment
name: "${name}"
status: complete
created: 2026-09-09T10:00:00+02:00
tags: []
---

## Purpose

## Design

## Where it ran

## Artifacts

## Observations

## Position history
`;

const entry = (when: string, field: string, from: string, why?: string) =>
  `- ${when} · ${field}\n` +
  (why === undefined ? "" : `  why: ${why}\n`) +
  "  from:" +
  (from === "" ? "" : "\n" + from.replace(/^(?!$)/gm, "    "));

const hypothesis = (claim: string, criteria: string, history?: string) => `---
id: hy-${claim.length}
kind: hypothesis
promoted: ${PROMOTED}
context: reading
---

## Claim

${claim}

## Criteria

${criteria}

## Design notes

## Position history

${history ?? entry(PROMOTED, "claim", "")}
`;

const C1 =
  "### The pooled effect drops below d = 0.20 ^c1\n\nrelationship:: confirming";
const F2 =
  "### The effect survives the exclusion rule ^c2\n\nrelationship:: falsifying";
const D3 = "### Egger's intercept moves ^c3\n\nrelationship:: diagnostic";
const C1_MET = `${C1}\noutcome:: met`;

const CLAIM_1 = "Preregistered reanalysis will shrink the pooled effect.";
const CLAIM_2 = "Harmonising the density definition removes variance.";

const t0 = new Date("2026-09-28T10:00:00+02:00");
const minute = 60_000;

async function opened(files: Record<string, string>) {
  const vault = await vaultWith({
    [RUN]: run("prereg-exclusions"),
    [OTHER_RUN]: run("leave-one-lab-out"),
    ...files,
  });
  let now = t0;
  const c = await core({
    coalesceMs: 30 * minute,
    settleMs: 40,
    now: () => now,
  });
  expect(
    (await c.mutate<Vault>("vault.open", { path: vault })).error
  ).toBeUndefined();
  await c.indexed();
  const bytes = (path: string) => readFile(join(vault, path), "utf8");
  const hashOf = async (path: string) => {
    const reply = await c.query<{ hash: string }>("hypotheses.page", { path });
    expect(reply.error).toBeUndefined();
    return reply.result!.data.hash;
  };
  const attach = async (input: {
    hypothesis?: string;
    criterion: string;
    experiment?: string;
    note: string;
  }) =>
    c.mutate<Written>("experiments.attachEvidence", {
      hypothesis: input.hypothesis ?? H1,
      criterion: input.criterion,
      experiment: input.experiment ?? RUN,
      note: input.note,
      basedOn: await hashOf(input.hypothesis ?? H1),
    });
  const page = async (path = RUN): Promise<Readable> => {
    const reply = await c.query<ExperimentPage>("experiments.page", { path });
    expect(reply.error).toBeUndefined();
    const data = reply.result?.data as ExperimentPage;
    if (!data.readable) throw new Error(data.reason);
    return data;
  };
  return {
    vault,
    c,
    bytes,
    attach,
    page,
    later: (minutes: number) => {
      now = new Date(t0.getTime() + minutes * minute);
    },
  };
}

describe("experiments.attachEvidence", () => {
  it("writes the Evidence line under ^c<n> and the criterion's Revision in one write", async () => {
    const { attach, bytes } = await opened({
      [H1]: hypothesis(CLAIM_1, `${C1}\n\n${F2}`),
    });
    const reply = await attach({
      criterion: "c2",
      note: "d = 0.41 — the effect did not move",
    });
    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toMatchObject({
      written: true,
      revision: localIso(t0),
    });
    // The bytes, because Obsidian is the other reader of this file.
    expect(await bytes(H1)).toBe(
      hypothesis(
        CLAIM_1,
        `${C1}\n\n${F2}\n\n- [[prereg-exclusions]] — d = 0.41 — the effect did not move`,
        entry(localIso(t0), "criterion F2", F2) +
          "\n" +
          entry(PROMOTED, "claim", "")
      )
    );
  });

  it("never writes or changes an Outcome", async () => {
    const { attach, bytes } = await opened({
      [H1]: hypothesis(CLAIM_1, `${C1_MET}\n\n${F2}`),
    });
    await attach({ criterion: "c1", note: "it dropped" });
    await attach({ criterion: "c2", note: "it did not survive" });
    const text = await bytes(H1);
    // Counted in `## Criteria` alone: the history's `from:` quotes C1 whole.
    const criteria = text.slice(0, text.indexOf("## Design notes"));
    expect(criteria.match(/outcome::/g)).toEqual(["outcome::"]);
    expect(text).toContain(
      `${C1_MET}\n\n- [[prereg-exclusions]] — it dropped\n\n${F2}\n\n- [[prereg-exclusions]] — it did not survive`
    );
  });

  it("voids a live Override, as any criterion Revision does", async () => {
    const OVERRIDE = entry(
      "2026-09-27T10:00:00+02:00",
      "override",
      "inconclusive",
      "F2 cannot be run on this sample"
    );
    const { attach, bytes } = await opened({
      [H1]: hypothesis(
        CLAIM_1,
        `${C1_MET}\n\n${F2}`,
        OVERRIDE + "\n" + entry(PROMOTED, "claim", "")
      ),
    });
    const reply = await attach({ criterion: "c2", note: "it can after all" });
    expect(reply.result?.data).toMatchObject({ written: true });
    const text = await bytes(H1);
    expect(text).toContain(
      entry(localIso(t0), "override voided", "2026-09-27T10:00:00+02:00")
    );
  });

  it("refuses a blank note before anything is written", async () => {
    const { attach, bytes } = await opened({
      [H1]: hypothesis(CLAIM_1, `${C1}\n\n${F2}`),
    });
    const before = await bytes(H1);
    for (const note of ["", "   ", "\n\t"]) {
      const reply = await attach({ criterion: "c2", note });
      expect(reply.error?.data.kind).toBe("refused");
      expect(reply.error?.message).toBe(
        "Evidence needs a note: what this run shows for this criterion."
      );
    }
    expect(await bytes(H1)).toBe(before);
  });

  it("collapses a note onto one line, so it cannot end the list item", async () => {
    const { attach, bytes } = await opened({
      [H1]: hypothesis(CLAIM_1, F2),
    });
    await attach({ criterion: "c2", note: "first line\n\nsecond line" });
    expect(await bytes(H1)).toContain(
      "- [[prereg-exclusions]] — first line second line\n"
    );
  });

  it("refuses a run that is not an Experiment, and a criterion the file does not carry", async () => {
    const { attach, bytes } = await opened({
      [H1]: hypothesis(CLAIM_1, F2),
      [H2]: hypothesis(CLAIM_2, C1),
    });
    const before = await bytes(H1);
    const notARun = await attach({
      criterion: "c2",
      experiment: H2,
      note: "x",
    });
    expect(notARun.error?.data.kind).toBe("refused");
    expect(notARun.error?.message).toBe(
      `${H2} is not an Experiment; only a run is Evidence.`
    );
    const gone = await attach({ criterion: "c9", note: "x" });
    expect(gone.result?.data).toMatchObject({
      written: false,
      detail: "no criterion carries ^c9",
    });
    expect(await bytes(H1)).toBe(before);
  });

  it("attaches one run to several Criteria across Hypotheses, each with its own note, and the page lists them all", async () => {
    const { attach, page } = await opened({
      [H1]: hypothesis(CLAIM_1, `${C1_MET}\n\n${F2}\n\n${D3}`),
      [H2]: hypothesis(CLAIM_2, C1),
    });
    await attach({ criterion: "c2", note: "the effect did not move" });
    await attach({ criterion: "c1", note: "significant in both sets" });
    await attach({
      hypothesis: H2,
      criterion: "c1",
      note: "held constant here, so only incidental",
    });
    const read = await page();
    expect(read.evidence).toEqual([
      {
        hypothesis: { path: H2, claim: CLAIM_2 },
        criterion: {
          id: "c1",
          label: "C1",
          text: "The pooled effect drops below d = 0.20",
          relationship: "confirming",
          outcome: null,
        },
        note: "held constant here, so only incidental",
      },
      {
        hypothesis: { path: H1, claim: CLAIM_1 },
        criterion: {
          id: "c2",
          label: "F2",
          text: "The effect survives the exclusion rule",
          relationship: "falsifying",
          outcome: null,
        },
        note: "the effect did not move",
      },
      {
        hypothesis: { path: H1, claim: CLAIM_1 },
        criterion: {
          id: "c1",
          label: "C1",
          text: "The pooled effect drops below d = 0.20",
          relationship: "confirming",
          outcome: "met",
        },
        note: "significant in both sets",
      },
    ]);
    // The other run is Evidence for nothing, and says so as an empty list.
    expect((await page(OTHER_RUN)).evidence).toEqual([]);
  });
});

describe("the page's Evidence, read from the Index", () => {
  it("shows a line written in Obsidian, and not a link to the run outside ## Criteria", async () => {
    const { page } = await opened({
      [H1]: hypothesis(
        CLAIM_1,
        `${F2}\n\n- [[prereg-exclusions]] — written by hand`
      ).replace(
        "## Design notes\n",
        "## Design notes\n\nSee [[prereg-exclusions]].\n"
      ),
    });
    expect((await page()).evidence).toEqual([
      {
        hypothesis: { path: H1, claim: CLAIM_1 },
        criterion: {
          id: "c2",
          label: "F2",
          text: "The effect survives the exclusion rule",
          relationship: "falsifying",
          outcome: null,
        },
        note: "written by hand",
      },
    ]);
  });

  it("follows an Obsidian edit once the watcher has seen it", async () => {
    const { vault, c, page } = await opened({
      [H1]: hypothesis(CLAIM_1, F2),
    });
    expect((await page()).evidence).toEqual([]);
    await writeFile(
      join(vault, H1),
      hypothesis(CLAIM_1, `${F2}\n\n- [[prereg-exclusions]] — later`)
    );
    await c.indexed();
    await expect
      .poll(async () => (await page()).evidence.map((e) => e.note))
      .toEqual(["later"]);
  });
});

describe("experiments.criteria", () => {
  it("offers every Hypothesis's Criteria, grouped by Hypothesis, falsifying first", async () => {
    const { c } = await opened({
      [H1]: hypothesis(CLAIM_1, `${C1_MET}\n\n${F2}\n\n${D3}`),
      [H2]: hypothesis(CLAIM_2, C1),
    });
    const reply = await c.query<CriteriaToAttach>("experiments.criteria", {});
    expect(reply.error).toBeUndefined();
    const groups = reply.result!.data.groups;
    expect(
      groups.map((g) => ({
        path: g.path,
        claim: g.claim,
        labels: g.criteria.map((x) => x.label),
      }))
    ).toEqual([
      { path: H2, claim: CLAIM_2, labels: ["C1"] },
      { path: H1, claim: CLAIM_1, labels: ["F2", "C1", "D3"] },
    ]);
    expect(groups[1]!.criteria[1]).toEqual({
      id: "c1",
      label: "C1",
      text: "The pooled effect drops below d = 0.20",
      relationship: "confirming",
      outcome: "met",
    });
    expect(groups.every((g) => typeof g.hash === "string")).toBe(true);
  });

  it("offers nothing when the vault has no Hypothesis", async () => {
    const { c } = await opened({});
    const reply = await c.query<CriteriaToAttach>("experiments.criteria", {});
    expect(reply.result?.data).toEqual({ groups: [], problems: [] });
  });
});
