import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HypothesisPage } from "./hypothesis.js";
import { closeCores, core, vaultWith, type CoreOptions } from "./test-core.js";
import { localIso } from "./time.js";

// Criteria written from the page (#334; spec #327 stories 21, 23, 26,
// 29–31, 45, 46, 53; ADR 0031 decisions 3, 4, 6). Every write goes through
// the closed operation set — `setInlineField` for an Outcome or a
// Relationship, `appendToSection` to add, `## Criteria` replaced whole to
// reword or delete — and carries its criterion Revision, plus a `· state`
// entry exactly when the Derived state moves. Asserted on the reply and the
// bytes on disk.

afterEach(closeCores);

type Vault = { name: string; path: string };
type Readable = Extract<HypothesisPage, { readable: true }>;
type Written =
  | { written: true; hash: string; revision: string | null }
  | { written: false; reason: string; detail: string };

const PATH = "hypotheses/Slow-wave density predicts recall gain.md";
const CLAIM = "Slow-wave density during the nap predicts next-day recall gain.";
const PROMOTED = "2026-09-28T10:00:00+02:00";

const FRONTMATTER = `---
id: hy4k8m2p9q
kind: hypothesis
promoted_from: "[[Does slow-wave density predict recall gain]]"
promoted: ${PROMOTED}
context: reading
---
`;

const C1 = "### Recall gain tracks density across the sample ^c1";
const C1_BLOCK = `${C1}\n\nrelationship:: confirming`;

/** A Hypothesis with `criteria` under `## Criteria` and `history` under `## Position history`. */
const file = (criteria: string, history = `- ${PROMOTED} · claim\n  from:\n`) =>
  `${FRONTMATTER}
## Claim

${CLAIM}

## Criteria
${criteria === "" ? "" : `\n${criteria}\n`}
## Design notes

## Position history

${history}`;

const minute = 60_000;
const t0 = new Date("2026-09-29T10:00:00+02:00");
const at = (offsetMinutes: number) =>
  new Date(t0.getTime() + offsetMinutes * minute);

/** The entry a write records, its previous text indented. */
const entry = (when: Date | string, field: string, from: string) =>
  `- ${typeof when === "string" ? when : localIso(when)} · ${field}\n  from:` +
  (from === "" ? "" : "\n" + from.replace(/^(?!$)/gm, "    "));

const PROMOTION = entry(PROMOTED, "claim", "");

async function opened(
  criteria: string,
  history?: string,
  opts: CoreOptions = {}
) {
  const vault = await vaultWith({ [PATH]: file(criteria, history) });
  let now = t0;
  const c = await core({ coalesceMs: 30 * minute, now: () => now, ...opts });
  expect(
    (await c.mutate<Vault>("vault.open", { path: vault })).error
  ).toBeUndefined();
  await c.indexed();
  const page = async (): Promise<Readable> => {
    const reply = await c.query<HypothesisPage>("hypotheses.page", {
      path: PATH,
    });
    expect(reply.error).toBeUndefined();
    const data = reply.result?.data as HypothesisPage;
    if (!data.readable) throw new Error(data.reason);
    return data;
  };
  /** A criterion write as the page makes it: against the hash it read. */
  const call = async (procedure: string, input: Record<string, unknown>) =>
    c.mutate<Written>(`hypotheses.${procedure}`, {
      path: PATH,
      basedOn: (await page()).hash,
      ...input,
    });
  const wrote = async (procedure: string, input: Record<string, unknown>) => {
    const reply = await call(procedure, input);
    expect(reply.error).toBeUndefined();
    return reply.result?.data as Written;
  };
  return {
    vault,
    c,
    page,
    call,
    wrote,
    setNow: (d: Date) => {
      now = d;
    },
    bytes: () => readFile(join(vault, PATH), "utf8"),
  };
}

describe("hypotheses.addCriterion", () => {
  it("appends the heading and its relationship to ## Criteria, numbered one past the highest, and records the criterion's first Revision", async () => {
    const { wrote, bytes, page } = await opened(C1_BLOCK);

    const reply = await wrote("addCriterion", {
      text: "No gain when density is shuffled across subjects",
      relationship: "falsifying",
    });
    expect(reply).toMatchObject({ written: true, revision: localIso(t0) });
    expect(await bytes()).toBe(
      file(
        C1_BLOCK +
          "\n\n### No gain when density is shuffled across subjects ^c2\n\nrelationship:: falsifying",
        [entry(t0, "criterion F2", ""), PROMOTION].join("\n") + "\n"
      )
    );
    const read = await page();
    expect(read.sections.criteria.criteria.map((c) => c.label)).toEqual([
      "C1",
      "F2",
    ]);
    expect(read.hash).toBe((reply as { hash: string }).hash);
  });

  it("writes the first criterion into an empty ## Criteria as c1", async () => {
    const { wrote, bytes } = await opened("");
    await wrote("addCriterion", {
      text: "Recall gain tracks density across the sample",
      relationship: "confirming",
    });
    expect(await bytes()).toBe(
      file(
        C1_BLOCK,
        [entry(t0, "criterion C1", ""), PROMOTION].join("\n") + "\n"
      )
    );
  });

  it("requires a relationship — there is no default (TEST-1)", async () => {
    const { call, bytes } = await opened(C1_BLOCK);
    const before = await bytes();
    const reply = await call("addCriterion", { text: "A criterion" });
    expect(reply.error).toBeDefined();
    const wrong = await call("addCriterion", {
      text: "A criterion",
      relationship: "supporting",
    });
    expect(wrong.error).toBeDefined();
    expect(await bytes()).toBe(before);
  });

  it("refuses an empty criterion, writing nothing", async () => {
    const { call, bytes } = await opened(C1_BLOCK);
    const before = await bytes();
    const reply = await call("addCriterion", {
      text: "  ",
      relationship: "diagnostic",
    });
    expect(reply.error?.message).toMatch(/criterion is empty/);
    expect(await bytes()).toBe(before);
  });

  it("never reuses a number the history names, whether as a label or as a bare id", async () => {
    const history =
      [
        entry(
          "2026-09-28T12:00:00+02:00",
          "criterion D7",
          "### Gone ^c7\n\nrelationship:: diagnostic"
        ),
        entry(
          "2026-09-28T11:00:00+02:00",
          "criterion ^c9",
          "### Also gone ^c9"
        ),
        PROMOTION,
      ].join("\n") + "\n";
    const { wrote, page } = await opened(C1_BLOCK, history);
    await wrote("addCriterion", { text: "Next", relationship: "diagnostic" });
    expect((await page()).sections.criteria.criteria.map((c) => c.id)).toEqual([
      "c1",
      "c10",
    ]);
  });

  it("moves the state on the record when the new criterion changes the derivation", async () => {
    // C1 met alone is supported; a new confirming criterion awaiting
    // evidence makes it inconclusive again.
    const { wrote, bytes, page } = await opened(`${C1_BLOCK}\noutcome:: met`);
    expect((await page()).derivation.state).toBe("supported");
    await wrote("addCriterion", {
      text: "The effect survives a second night",
      relationship: "confirming",
    });
    expect(await bytes()).toContain(
      [
        entry(t0, "state", "supported"),
        entry(t0, "criterion C2", ""),
        PROMOTION,
      ].join("\n")
    );
    expect((await page()).derivation.state).toBe("inconclusive");
  });
});

describe("hypotheses.setCriterionField", () => {
  it("records a first outcome by adding the field line, with the criterion's Revision and — the state having moved — a state entry above it", async () => {
    const { wrote, bytes, page } = await opened(C1_BLOCK);
    const reply = await wrote("setCriterionField", {
      id: "c1",
      field: "outcome",
      value: "met",
    });
    expect(reply).toMatchObject({ written: true, revision: localIso(t0) });
    expect(await bytes()).toBe(
      file(
        `${C1_BLOCK}\noutcome:: met`,
        [
          entry(t0, "state", "inconclusive"),
          entry(t0, "criterion C1", C1_BLOCK),
          PROMOTION,
        ].join("\n") + "\n"
      )
    );
    const read = await page();
    expect(read.derivation.state).toBe("supported");
    expect(read.sections.criteria.criteria[0]?.outcome).toBe("met");
  });

  it("writes no state entry when the state does not move", async () => {
    const both = `${C1_BLOCK}\n\n### A second confirming ^c2\n\nrelationship:: confirming`;
    const { wrote, bytes } = await opened(both);
    await wrote("setCriterionField", {
      id: "c1",
      field: "outcome",
      value: "met",
    });
    const written = await bytes();
    expect(written).toContain(
      [entry(t0, "criterion C1", C1_BLOCK), PROMOTION].join("\n")
    );
    expect(written).not.toContain("· state");
  });

  it("changes the relationship in place: the label's letter moves, its number stays, and the entry names the label as it stood", async () => {
    const { wrote, bytes, page } = await opened(`${C1_BLOCK}\noutcome:: met`);
    await wrote("setCriterionField", {
      id: "c1",
      field: "relationship",
      value: "falsifying",
    });
    expect(await bytes()).toBe(
      file(
        `${C1}\n\nrelationship:: falsifying\noutcome:: met`,
        [
          entry(t0, "state", "supported"),
          entry(t0, "criterion C1", `${C1_BLOCK}\noutcome:: met`),
          PROMOTION,
        ].join("\n") + "\n"
      )
    );
    const read = await page();
    expect(read.sections.criteria.criteria[0]?.label).toBe("F1");
    expect(read.derivation.state).toBe("falsified");
  });

  it("gives a criterion written without a relationship its first one", async () => {
    const { wrote, page } = await opened(`${C1}`);
    await wrote("setCriterionField", {
      id: "c1",
      field: "relationship",
      value: "diagnostic",
    });
    const read = await page();
    expect(read.sections.criteria.criteria[0]?.label).toBe("D1");
    expect(read.sections.positionHistory.entries[0]).toMatchObject({
      field: "criterion ^c1",
      from: C1,
    });
  });

  it("coalesces changes to one criterion within the window, and opens a new entry after it", async () => {
    const both = `${C1_BLOCK}\n\n### A second confirming ^c2\n\nrelationship:: confirming`;
    const { wrote, bytes, setNow } = await opened(both);
    await wrote("setCriterionField", {
      id: "c1",
      field: "outcome",
      value: "inconclusive",
    });
    setNow(at(10));
    await wrote("setCriterionField", {
      id: "c1",
      field: "outcome",
      value: "met",
    });
    expect(await bytes()).toContain(
      [entry(at(10), "criterion C1", C1_BLOCK), PROMOTION].join("\n")
    );
    setNow(at(60));
    await wrote("setCriterionField", {
      id: "c1",
      field: "outcome",
      value: "not met",
    });
    expect(await bytes()).toContain(
      [
        entry(at(60), "criterion C1", `${C1_BLOCK}\noutcome:: met`),
        entry(at(10), "criterion C1", C1_BLOCK),
      ].join("\n")
    );
  });

  it("refuses a criterion the file no longer carries, or carries twice, writing nothing", async () => {
    const twice = `${C1_BLOCK}\n\n### The same id again ^c1\n\nrelationship:: diagnostic`;
    const { wrote, bytes } = await opened(twice);
    const before = await bytes();
    expect(
      await wrote("setCriterionField", {
        id: "c1",
        field: "outcome",
        value: "met",
      })
    ).toEqual({
      written: false,
      reason: "changedAndUnreapplyable",
      detail: "2 criteria carry ^c1",
      revision: null,
    });
    expect(
      await wrote("setCriterionField", {
        id: "c4",
        field: "outcome",
        value: "met",
      })
    ).toEqual({
      written: false,
      reason: "changedAndUnreapplyable",
      detail: "no criterion carries ^c4",
      revision: null,
    });
    expect(await bytes()).toBe(before);
  });
});

describe("hypotheses.editCriterion", () => {
  it("rewords the criterion's heading, keeping its id, every other byte of ## Criteria, and records its Revision", async () => {
    const both = `${C1_BLOCK}\n\n### A second confirming ^c2\n\nrelationship:: confirming`;
    const { wrote, bytes, page } = await opened(both);
    const reply = await wrote("editCriterion", {
      id: "c1",
      text: "Recall gain tracks density within each subject",
      was: "Recall gain tracks density across the sample",
    });
    expect(reply).toMatchObject({ written: true, revision: localIso(t0) });
    expect(await bytes()).toBe(
      file(
        "### Recall gain tracks density within each subject ^c1\n\nrelationship:: confirming\n\n### A second confirming ^c2\n\nrelationship:: confirming",
        [entry(t0, "criterion C1", C1_BLOCK), PROMOTION].join("\n") + "\n"
      )
    );
    expect((await page()).sections.criteria.criteria[0]?.text).toBe(
      "Recall gain tracks density within each subject"
    );
  });

  it("refuses when the criterion's text changed underneath, writing nothing", async () => {
    const { vault, wrote, bytes } = await opened(C1_BLOCK);
    const reply = await wrote("editCriterion", {
      id: "c1",
      text: "Mine",
      was: "What the page read, before an edit in Obsidian",
    });
    expect(reply).toMatchObject({
      written: false,
      reason: "changedAndUnreapplyable",
    });
    expect(await bytes()).toBe(file(C1_BLOCK));
    expect(vault).toBeDefined();
  });

  it("refuses an empty text, writing nothing", async () => {
    const { call, bytes } = await opened(C1_BLOCK);
    const reply = await call("editCriterion", {
      id: "c1",
      text: " ",
      was: "Recall gain tracks density across the sample",
    });
    expect(reply.error?.message).toMatch(/criterion is empty/);
    expect(await bytes()).toBe(file(C1_BLOCK));
  });
});

describe("hypotheses.deleteCriterion", () => {
  it("removes a criterion with no evidence, and its number is never reused — the highest included", async () => {
    const both = `${C1_BLOCK}\n\n### A second confirming ^c2\n\nrelationship:: confirming`;
    const { wrote, bytes, page, setNow } = await opened(both);
    const reply = await wrote("deleteCriterion", { id: "c2" });
    expect(reply).toMatchObject({ written: true, revision: localIso(t0) });
    expect(await bytes()).toBe(
      file(
        C1_BLOCK,
        [
          entry(
            t0,
            "criterion C2",
            "### A second confirming ^c2\n\nrelationship:: confirming"
          ),
          PROMOTION,
        ].join("\n") + "\n"
      )
    );

    setNow(at(1));
    await wrote("addCriterion", {
      text: "A third",
      relationship: "confirming",
    });
    expect(
      (await page()).sections.criteria.criteria.map((c) => c.label)
    ).toEqual(["C1", "C3"]);
  });

  it("records a state entry when deleting moves the state", async () => {
    const both = `${C1_BLOCK}\noutcome:: met\n\n### Awaiting ^c2\n\nrelationship:: confirming`;
    const { wrote, bytes, page } = await opened(both);
    expect((await page()).derivation.state).toBe("inconclusive");
    await wrote("deleteCriterion", { id: "c2" });
    expect(await bytes()).toContain(
      [
        entry(t0, "state", "inconclusive"),
        entry(
          t0,
          "criterion C2",
          "### Awaiting ^c2\n\nrelationship:: confirming"
        ),
      ].join("\n")
    );
    expect((await page()).derivation.state).toBe("supported");
  });

  it("refuses a criterion with evidence under it — once something tests it, it is no longer a draft", async () => {
    const withRun = `${C1_BLOCK}\n\n- [[run-14]] — gain tracked density`;
    const { call, bytes } = await opened(withRun);
    const reply = await call("deleteCriterion", { id: "c1" });
    expect(reply.error?.message).toBe(
      "C1 has evidence under it; a tested criterion leaves the rule by becoming diagnostic, not by being deleted"
    );
    expect(await bytes()).toBe(file(withRun));
  });

  it("folds in a Revision parked by an Obsidian edit, which lands below the page's own entry", async () => {
    const { vault, c, wrote, bytes, setNow } = await opened(
      C1_BLOCK,
      undefined,
      { settleMs: 40 }
    );
    const stream = await c.events();
    setNow(at(5));
    await writeFile(
      join(vault, PATH),
      file(C1_BLOCK).replace(CLAIM, "Reworded in Obsidian.")
    );
    await stream.next("vaultChanged");
    setNow(at(8));
    await wrote("setCriterionField", {
      id: "c1",
      field: "outcome",
      value: "not met",
    });
    expect(await bytes()).toBe(
      file(`${C1_BLOCK}\noutcome:: not met`, "")
        .replace(CLAIM, "Reworded in Obsidian.")
        .replace(
          /## Position history\n\n$/,
          "## Position history\n\n" +
            [
              entry(at(8), "criterion C1", C1_BLOCK),
              entry(at(5), "claim", CLAIM),
              PROMOTION,
            ].join("\n") +
            "\n"
        )
    );
  });
});
