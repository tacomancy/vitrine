import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { HypothesisPage } from "./hypothesis.js";
import type { ResearchQuestionPage } from "./research-question.js";
import { closeCores, core, fingerprint, vaultWith } from "./test-core.js";

// A Research Question sharpens into a Hypothesis from its page (#332; spec
// #327 stories 7, 8, 10, 12; ADR 0031 decision 9): the route the brief calls
// expected. The Hypothesis is written whole as a Question's promotion writes
// it, then a line joins the Research Question's `## Related questions` —
// or the Hypothesis is taken back. The Research Question stays open.

afterEach(closeCores);

// `promoted` carries the local offset, so the clock is pinned to one zone.
beforeAll(() => {
  process.env["TZ"] = "Asia/Kolkata";
});
const at = new Date("2026-09-28T10:00:00+05:30");

const PAGE_PATH =
  "questions/Does slow-wave density predict recall gain (RQ).md";

const PAGE = `---
id: rq00000001
kind: research-question
question: "Does slow-wave density predict recall gain?"
status: open
promoted_from: "[[Does slow-wave density predict recall gain]]"
promoted: 2026-09-20T10:00:00+05:30
captured: 2026-08-14T09:12:00+01:00
context: reading
from: "[[Rasch & Born 2013]]"
page: 699
tags:
  - memory/consolidation
---

## Working answer

Probably, in the nap studies.

## Supporting sources

## Opposing sources

## Related questions

- [[What counts as a reactivation event]]

## Open threads

## Position history
`;

const CLAIM = "Slow-wave density during the nap predicts next-day recall gain.";
const HYPOTHESIS_PATH =
  "hypotheses/Slow-wave density during the nap predicts next-day recall gain..md";

/**
 * The same page a Question's promotion writes, `promoted_from` naming the
 * Research Question: its Provenance and tags copied as it holds them —
 * which are the Question's, carried forward once already.
 */
const HYPOTHESIS = `---
id: hy00000001
kind: hypothesis
promoted_from: "[[Does slow-wave density predict recall gain (RQ)]]"
promoted: 2026-09-28T10:00:00+05:30
captured: 2026-08-14T09:12:00+01:00
context: reading
from: "[[Rasch & Born 2013]]"
page: 699
tags:
  - memory/consolidation
---

## Claim

${CLAIM}

## Criteria

## Design notes

## Position history

- 2026-09-28T10:00:00+05:30 · claim
  from:
`;

/** The Research Question after: still open, one line at the end of its related questions. */
const SHARPENED = PAGE.replace(
  "- [[What counts as a reactivation event]]\n",
  "- [[What counts as a reactivation event]]\n- [[Slow-wave density during the nap predicts next-day recall gain.]] — sharpened into a hypothesis, 2026-09-28\n"
);

async function openedVault(files: Record<string, string>) {
  const vault = await vaultWith(files);
  const c = await core({ now: () => at, newId: () => "hy00000001" });
  const opened = await c.mutate("vault.open", { path: vault });
  expect(opened.error).toBeUndefined();
  await c.indexed();
  return { vault, c };
}

const promote = (
  c: Awaited<ReturnType<typeof openedVault>>["c"],
  path: string,
  claim: string
) =>
  c.mutate<{ path: string }>("researchQuestions.promoteToHypothesis", {
    path,
    claim,
  });

describe("researchQuestions.promoteToHypothesis", () => {
  it("writes the Hypothesis whole, then adds the sharpened line under Related questions and leaves the page open", async () => {
    const { vault, c } = await openedVault({ [PAGE_PATH]: PAGE });

    const reply = await promote(c, PAGE_PATH, `  ${CLAIM}  `);

    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toEqual({ path: HYPOTHESIS_PATH });
    expect(await readFile(join(vault, HYPOTHESIS_PATH), "utf8")).toBe(
      HYPOTHESIS
    );
    expect(await readFile(join(vault, PAGE_PATH), "utf8")).toBe(SHARPENED);
  });

  it("puts the line under an empty Related questions heading, not after the page", async () => {
    const bare = PAGE.replace(
      "- [[What counts as a reactivation event]]\n\n",
      ""
    );
    const { vault, c } = await openedVault({ [PAGE_PATH]: bare });

    await promote(c, PAGE_PATH, CLAIM);

    expect(await readFile(join(vault, PAGE_PATH), "utf8")).toBe(
      bare.replace(
        "## Related questions\n\n",
        "## Related questions\n\n- [[Slow-wave density during the nap predicts next-day recall gain.]] — sharpened into a hypothesis, 2026-09-28\n\n"
      )
    );
  });

  it("reads both pages at once: the Hypothesis inconclusive with its claim, the Research Question open with the line", async () => {
    const { c } = await openedVault({ [PAGE_PATH]: PAGE });
    await promote(c, PAGE_PATH, CLAIM);

    // No wait on the watcher: the index was told of both writes.
    const hypothesis = await c.query<HypothesisPage>("hypotheses.page", {
      path: HYPOTHESIS_PATH,
    });
    expect(hypothesis.result?.data).toMatchObject({
      readable: true,
      frontmatter: {
        promotedFrom: "[[Does slow-wave density predict recall gain (RQ)]]",
      },
      sections: { claim: { text: CLAIM } },
      derivation: { state: "inconclusive", clause: "noCriteria" },
      problems: [],
    });
    const page = await c.query<ResearchQuestionPage>("researchQuestions.page", {
      path: PAGE_PATH,
    });
    const data = page.result?.data;
    expect(data?.readable).toBe(true);
    if (!data?.readable) return;
    expect(data.frontmatter.status).toBe("open");
    expect(data.sections.related.lines.map((l) => l.note)).toEqual([
      "",
      "sharpened into a hypothesis, 2026-09-28",
    ]);
    expect(data.sections.related.lines[1]?.link).toMatchObject({
      resolution: "resolved",
      resolvedPath: HYPOTHESIS_PATH,
      resolvedKind: "hypothesis",
    });
  });

  it("refuses an empty claim, a page that is not open, and a taken name, writing nothing", async () => {
    const answered = PAGE.replace("status: open", "status: answered");
    const { vault, c } = await openedVault({
      [PAGE_PATH]: PAGE,
      "questions/Answered (RQ).md": answered,
      "hypotheses/Taken.md":
        "---\nkind: note\n---\nA note that took the name.\n",
    });
    const before = await fingerprint(vault);

    const blank = await promote(c, PAGE_PATH, "   ");
    expect(blank.error?.data.kind).toBe("refused");
    expect(blank.error?.message).toMatch(/claim/);

    const closed = await promote(c, "questions/Answered (RQ).md", CLAIM);
    expect(closed.error?.data.kind).toBe("refused");
    expect(closed.error?.message).toMatch(/answered/);

    const taken = await promote(c, PAGE_PATH, "Taken");
    expect(taken.error?.data.kind).toBe("refused");
    expect(taken.error?.message).toBe(
      "Couldn't write hypotheses/Taken.md: a file by that name is already in the vault"
    );

    expect(await fingerprint(vault)).toEqual(before);
  });

  it("refuses a file that is not a Research Question", async () => {
    const { vault, c } = await openedVault({
      "questions/A question.md":
        '---\nkind: question\nquestion: "A question?"\nstatus: open\n---\n',
    });
    const before = await fingerprint(vault);

    const reply = await promote(c, "questions/A question.md", CLAIM);

    expect(reply.error?.data.kind).toBe("refused");
    expect(reply.error?.message).toMatch(/not a Research Question/);
    expect(await fingerprint(vault)).toEqual(before);
  });

  it("takes the Hypothesis back when the Research Question cannot take its line, and says why", async () => {
    const { vault, c } = await openedVault({ [PAGE_PATH]: PAGE });
    const before = await fingerprint(vault);
    // The Hypothesis lands in hypotheses/; the page's write, in a folder it
    // cannot write, is the one that fails.
    await chmod(join(vault, "questions"), 0o555);
    try {
      const reply = await promote(c, PAGE_PATH, CLAIM);
      expect(reply.error?.data.kind).toBe("writeFailed");
      expect(reply.error?.message).toMatch(
        /^Couldn't write questions\/Does slow-wave density predict recall gain \(RQ\)\.md: EACCES/
      );
      expect(reply.error?.message).not.toContain(vault);
    } finally {
      await chmod(join(vault, "questions"), 0o755);
    }
    // The hypotheses/ folder the write made may stay, empty: no file is
    // left in it, which is what "no Hypothesis behind" means.
    expect(
      (await fingerprint(vault)).filter((entry) => entry !== "hypotheses/")
    ).toEqual(before);
  });

  it("refuses when no vault is open", async () => {
    const c = await core();
    const reply = await c.mutate("researchQuestions.promoteToHypothesis", {
      path: "x.md",
      claim: CLAIM,
    });
    expect(reply.error?.data.kind).toBe("noVault");
  });
});
