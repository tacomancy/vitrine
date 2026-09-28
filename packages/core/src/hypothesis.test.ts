import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HypothesisPage } from "./hypothesis.js";
import { closeCores, core, sha256, vaultWith } from "./test-core.js";

afterEach(closeCores);

type Vault = { name: string; path: string };
type Readable = Extract<HypothesisPage, { readable: true }>;

const PATH = "hypotheses/Slow-wave density predicts recall gain.md";

const FRONTMATTER = `---
id: hy4k8m2p9q
kind: hypothesis
promoted_from: "[[Does slow-wave density predict recall gain]]"
promoted: 2026-09-28T10:00:00+02:00
captured: 2026-08-14T09:12:00+01:00
context: reading
from: "[[Rasch & Born 2013]]"
page: 699
tags:
  - memory/consolidation
---
`;

/** A Hypothesis file whose `## Criteria` body is `criteria`. */
const hypothesis = (criteria: string, rest = "") => `${FRONTMATTER}
## Claim

Slow-wave density during the nap predicts next-day recall gain.

## Criteria

${criteria}
## Design notes

${rest}
## Position history

- 2026-09-28T10:00:00+02:00 · claim
  from:
`;

async function pageOf(
  files: Record<string, string>,
  path = PATH
): Promise<{ vault: string; page: HypothesisPage }> {
  const vault = await vaultWith(files);
  const c = await core();
  const opened = await c.mutate<Vault>("vault.open", { path: vault });
  expect(opened.error).toBeUndefined();
  await c.indexed();
  const reply = await c.query<HypothesisPage>("hypotheses.page", { path });
  expect(reply.error).toBeUndefined();
  return { vault, page: reply.result?.data as HypothesisPage };
}

async function readable(criteria: string): Promise<Readable> {
  const { page } = await pageOf({ [PATH]: hypothesis(criteria) });
  expect(page.readable).toBe(true);
  return page as Readable;
}

const criterion = (
  n: number,
  text: string,
  relationship: string | null,
  outcome: string | null = null,
  evidence: string[] = []
) =>
  [
    `### ${text} ^c${n}`,
    "",
    ...(relationship === null ? [] : [`relationship:: ${relationship}`]),
    ...(outcome === null ? [] : [`outcome:: ${outcome}`]),
    ...(evidence.length === 0 ? [] : ["", ...evidence]),
    "",
  ].join("\n");

// The load-bearing table (ADR 0031 decision 1; spec #327 § Testing
// Decisions). Driven through the page read rather than the rule alone, so
// it also proves the parsing the rule depends on.
describe("the derived state, through the page read", () => {
  const rows: Array<{
    name: string;
    criteria: string;
    state: "supported" | "falsified" | "inconclusive";
    clause: string;
    named?: string[];
  }> = [
    {
      name: "no criteria",
      criteria: "",
      state: "inconclusive",
      clause: "noCriteria",
    },
    {
      name: "only diagnostic criteria, one met",
      criteria:
        criterion(1, "Spindles are detected", "diagnostic", "met") +
        criterion(2, "Sleep staging agrees", "diagnostic"),
      state: "inconclusive",
      clause: "onlyDiagnostic",
    },
    {
      name: "all awaiting evidence",
      criteria:
        criterion(1, "Density predicts gain", "confirming") +
        criterion(2, "Gain vanishes when encoding is controlled", "falsifying"),
      state: "inconclusive",
      clause: "nothingTested",
    },
    {
      name: "one confirming met with a falsifying awaiting",
      criteria:
        criterion(
          1,
          "Gain vanishes when encoding is controlled",
          "falsifying"
        ) + criterion(2, "Density predicts gain", "confirming", "met"),
      state: "inconclusive",
      clause: "awaitingEvidence",
      named: ["F1"],
    },
    {
      // The case the brief's own wording gets wrong: the claim survived
      // the test written to kill it, and every confirming criterion landed.
      name: "falsifying not met with all confirming met",
      criteria:
        criterion(
          1,
          "Gain vanishes when encoding is controlled",
          "falsifying",
          "not met"
        ) +
        criterion(2, "Density predicts gain", "confirming", "met") +
        criterion(
          3,
          "The effect holds in the replication",
          "confirming",
          "met"
        ) +
        criterion(4, "Sleep staging agrees", "diagnostic", "not met"),
      state: "supported",
      clause: "allLanded",
      named: ["F1", "C2", "C3"],
    },
    {
      name: "falsifying met with everything else met",
      criteria:
        criterion(
          1,
          "Gain vanishes when encoding is controlled",
          "falsifying",
          "met"
        ) +
        criterion(2, "Density predicts gain", "confirming", "met") +
        criterion(3, "Sleep staging agrees", "diagnostic", "met"),
      state: "falsified",
      clause: "falsifyingMet",
      named: ["F1"],
    },
    {
      name: "a confirming criterion not met",
      criteria:
        criterion(
          1,
          "Gain vanishes when encoding is controlled",
          "falsifying",
          "not met"
        ) +
        criterion(2, "Density predicts gain", "confirming", "not met") +
        criterion(
          3,
          "The effect holds in the replication",
          "confirming",
          "met"
        ),
      state: "inconclusive",
      clause: "mixed",
      named: ["C2"],
    },
    {
      name: "a criterion with no relationship",
      criteria:
        criterion(1, "Density predicts gain", "confirming", "met") +
        criterion(2, "The effect holds in the replication", null, "met"),
      state: "inconclusive",
      clause: "noRelationship",
      named: ["^c2"],
    },
    {
      // Reads as absent: the same inconclusive an unset outcome gives.
      name: "an out-of-vocabulary outcome",
      criteria:
        criterion(1, "Density predicts gain", "confirming", "met") +
        criterion(
          2,
          "The effect holds in the replication",
          "confirming",
          "mett"
        ),
      state: "inconclusive",
      clause: "awaitingEvidence",
      named: ["C2"],
    },
  ];

  for (const row of rows) {
    it(`${row.name} → ${row.state} (${row.clause})`, async () => {
      const page = await readable(row.criteria);
      expect(page.derivation.state).toBe(row.state);
      expect(page.derivation.clause).toBe(row.clause);
      if (row.named !== undefined) {
        expect(page.derivation.named).toEqual(row.named);
      }
    });
  }

  it("counts the census over every criterion, diagnostic ones included", async () => {
    const page = await readable(
      criterion(1, "Gain vanishes when encoding is controlled", "falsifying") +
        criterion(2, "Density predicts gain", "confirming", "met") +
        criterion(
          3,
          "The effect holds in the replication",
          "confirming",
          "not met"
        ) +
        criterion(4, "Sleep staging agrees", "diagnostic", "inconclusive") +
        criterion(5, "Spindles are detected", "diagnostic", "met")
    );
    expect(page.derivation.census).toEqual({
      met: 2,
      notMet: 1,
      inconclusive: 1,
      awaiting: 1,
    });
  });
});

describe("hypotheses.page", () => {
  it("reads the frontmatter, the claim, the criteria as read, design notes and history, with the file's hash", async () => {
    const { vault, page } = await pageOf({
      [PATH]: hypothesis(
        criterion(1, "Density predicts gain", "confirming", "met", [
          "- [[nap-run-3]] — r = .41 across 32 participants",
          "- [[nowhere-run]] — mistyped",
        ]) +
          criterion(
            2,
            "Gain vanishes when encoding is controlled",
            "falsifying"
          ) +
          criterion(5, "Sleep staging agrees", "diagnostic", "inconclusive") +
          criterion(7, "Replication cohort", null) +
          criterion(8, "Spindles scored", "confirming", "mett"),
        "Varied: nap length. Held: learning list.\n"
      ),
      "experiments/nap-run-3/nap-run-3.md": "---\nkind: experiment\n---\n",
    });
    expect(page.readable).toBe(true);
    if (!page.readable) return;
    expect(page.hash).toBe(sha256(await readFile(join(vault, PATH))));
    expect(page.frontmatter).toEqual({
      id: "hy4k8m2p9q",
      promotedFrom: "[[Does slow-wave density predict recall gain]]",
      promoted: "2026-09-28T10:00:00+02:00",
      captured: "2026-08-14T09:12:00+01:00",
      context: "reading",
      from: "[[Rasch & Born 2013]]",
      page: 699,
      tags: ["memory/consolidation"],
    });
    expect(page.sections.claim).toEqual({
      present: true,
      text: "Slow-wave density during the nap predicts next-day recall gain.",
    });
    expect(page.sections.designNotes).toEqual({
      present: true,
      text: "Varied: nap length. Held: learning list.",
    });
    expect(page.sections.positionHistory.entries).toEqual([
      { at: "2026-09-28T10:00:00+02:00", field: "claim", why: null, from: "" },
    ]);

    const criteria = page.sections.criteria.criteria;
    expect(
      criteria.map(
        ({ id, label, relationship, outcome, outcomeUnreadable }) => ({
          id,
          label,
          relationship,
          outcome,
          outcomeUnreadable,
        })
      )
    ).toEqual([
      {
        id: "c1",
        label: "C1",
        relationship: "confirming",
        outcome: "met",
        outcomeUnreadable: null,
      },
      {
        id: "c2",
        label: "F2",
        relationship: "falsifying",
        outcome: null,
        outcomeUnreadable: null,
      },
      {
        id: "c5",
        label: "D5",
        relationship: "diagnostic",
        outcome: "inconclusive",
        outcomeUnreadable: null,
      },
      {
        id: "c7",
        label: null,
        relationship: null,
        outcome: null,
        outcomeUnreadable: null,
      },
      {
        id: "c8",
        label: "C8",
        relationship: "confirming",
        outcome: null,
        outcomeUnreadable: "mett",
      },
    ]);
    expect(criteria[0]!.text).toBe("Density predicts gain");
    const [resolved, unresolved] = criteria[0]!.evidence;
    expect(resolved).toMatchObject({
      link: {
        target: "nap-run-3",
        resolution: "resolved",
        resolvedPath: "experiments/nap-run-3/nap-run-3.md",
      },
      note: "r = .41 across 32 participants",
    });
    expect(unresolved).toMatchObject({
      link: {
        target: "nowhere-run",
        resolution: "unresolved",
        resolvedPath: null,
      },
      note: "mistyped",
    });
    expect(criteria[1]!.evidence).toEqual([]);
    // The out-of-vocabulary outcome is the file's shape problem, and says so
    // on the criterion too (above).
    expect(page.problems).toEqual([
      {
        path: PATH,
        kind: "hypothesis",
        problem: "fieldOutsideVocabulary",
        block: "c8",
      },
    ]);
  });

  it("reads what parses and names what did not: a section renamed, a criterion without an id, a history entry that does not parse", async () => {
    const file = `${FRONTMATTER}
## Claim

The claim.

## Criteria

### Density predicts gain ^c1

relationship:: confirming

### A criterion with no id

relationship:: falsifying

## Design notez

Renamed by hand.

## Position history

- a note typed under the heading
- 2026-09-28T10:00:00+02:00 · claim
  from:
`;
    const { page } = await pageOf({ [PATH]: file });
    expect(page.readable).toBe(true);
    if (!page.readable) return;
    expect(page.sections.claim.text).toBe("The claim.");
    expect(page.sections.criteria.criteria.map((c) => c.id)).toEqual(["c1"]);
    expect(page.sections.designNotes).toEqual({ present: false, text: "" });
    expect(page.sections.positionHistory.entries).toHaveLength(1);
    expect(page.problems).toEqual([
      {
        path: PATH,
        kind: "hypothesis",
        problem: "criterionWithoutId",
        block: "A criterion with no id",
      },
      {
        path: PATH,
        kind: "hypothesis",
        problem: "sectionMissing",
        block: "Design notes",
      },
      {
        path: PATH,
        kind: "hypothesis",
        problem: "historyEntryUnparsed",
        block: "- a note typed under the heading",
      },
    ]);
  });

  it("reads a hand-written file with nothing but kind and a claim", async () => {
    const { page } = await pageOf({
      [PATH]:
        "---\nkind: hypothesis\n---\n\n## Claim\n\nNaps help.\n\n## Criteria\n",
    });
    expect(page.readable).toBe(true);
    if (!page.readable) return;
    expect(page.frontmatter).toEqual({ context: "other", tags: [] });
    expect(page.sections.claim.text).toBe("Naps help.");
    expect(page.derivation.clause).toBe("noCriteria");
    expect(page.problems.map((p) => p.block)).toEqual([
      "Design notes",
      "Position history",
    ]);
  });

  it("is not readable as a page when the file is another Kind, or missing", async () => {
    const other = "questions/Q.md";
    const { page } = await pageOf(
      {
        [other]:
          '---\nkind: question\nquestion: "Q?"\ncaptured: 2026-08-01T09:00:00Z\n---\n',
      },
      other
    );
    expect(page).toEqual({
      readable: false,
      path: other,
      reason: "not a Hypothesis: kind is question",
    });
    const { page: gone } = await pageOf({}, PATH);
    expect(gone).toEqual({
      readable: false,
      path: PATH,
      reason: "missing from the vault",
    });
  });
});
