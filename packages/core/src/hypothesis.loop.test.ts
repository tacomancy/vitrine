import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { HypothesisPage } from "./hypothesis.js";
import type { Listing } from "./list.js";
import type { ResearchQuestionPage } from "./research-question.js";
import { closeCores, core, vaultWith } from "./test-core.js";

// Closing the loop (#338; spec #327 stories 64–70, 74, 75; ADR 0031
// decision 8): the result written one hop up, to the object the Hypothesis
// was promoted from, and nothing written to the Hypothesis. A Question
// becomes *answered* with one line in its lead; a Research Question gains
// the line under `## Related questions` and keeps its Status. Whether the
// loop is closed is read back from that line. Asserted on the reply, the
// page read, the Inbox listing, and the bytes on disk.

afterEach(closeCores);

// `answered` carries the local offset, so the clock is pinned to one zone.
beforeAll(() => {
  process.env["TZ"] = "Asia/Kolkata";
});
const at = new Date("2026-09-30T10:00:00+05:30");

type Readable = Extract<HypothesisPage, { readable: true }>;

const QUESTION_PATH =
  "questions/Does the reanalysis shrink the pooled effect.md";
const QUESTION = `---
id: q000000001
kind: question
question: "Does the reanalysis shrink the pooled effect?"
status: promoted
captured: 2026-08-14T09:12:00+05:30
context: other
promoted_to: "[[The pooled effect is mostly small-study bias]]"
---
`;

const RQ_PATH = "questions/Why do the effects disperse (RQ).md";
const RQ = `---
id: rq00000001
kind: research-question
question: "Why do the effects disperse?"
status: open
promoted_from: "[[Why do the effects disperse]]"
promoted: 2026-09-01T10:00:00+05:30
captured: 2026-08-14T09:12:00+05:30
context: other
---

## Working answer

Probably small studies.

## Supporting sources

## Opposing sources

## Related questions

- [[The pooled effect is mostly small-study bias]] — sharpened into a hypothesis, 2026-09-20

## Open threads

## Position history
`;

const PATH = "hypotheses/The pooled effect is mostly small-study bias.md";

const C1 =
  "### The trim-and-fill estimate stays above 0.2 ^c1\n\nrelationship:: confirming";
const F2 =
  "### The effect vanishes in the large-study stratum ^c2\n\nrelationship:: falsifying";

/** The criteria for each result word, and one that is not yet closable. */
const FALSIFIED = `${C1}\noutcome:: met\n\n${F2}\noutcome:: met`;
const SUPPORTED = `${C1}\noutcome:: met\n\n${F2}\noutcome:: not met`;
const TESTED_UNDECIDED = `${C1}\noutcome:: inconclusive\n\n${F2}\noutcome:: not met`;
const AWAITING = `${C1}\noutcome:: met\n\n${F2}`;

const OVERRIDE = `- 2026-09-29T10:00:00+05:30 · override
  why: the large-study stratum cannot be run on this sample
  from:
    inconclusive
`;

const hypothesis = (
  criteria: string,
  {
    from = "[[Does the reanalysis shrink the pooled effect]]",
    history = "",
  } = {}
) => `---
id: hy00000001
kind: hypothesis
${from === "" ? "" : `promoted_from: "${from}"\n`}promoted: 2026-09-20T10:00:00+05:30
context: other
---

## Claim

The pooled effect is mostly small-study bias.

## Criteria

${criteria}

## Design notes

## Position history

${history}- 2026-09-20T10:00:00+05:30 · claim
  from:
`;

async function opened(files: Record<string, string>) {
  const vault = await vaultWith(files);
  let now = at;
  const c = await core({ now: () => now });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const bytes = (path: string) => readFile(join(vault, path), "utf8");
  const page = async (): Promise<Readable> => {
    const reply = await c.query<HypothesisPage>("hypotheses.page", {
      path: PATH,
    });
    expect(reply.error).toBeUndefined();
    const data = reply.result?.data as HypothesisPage;
    if (!data.readable) throw new Error(data.reason);
    return data;
  };
  const close = async () =>
    c.mutate<{ path: string }>("hypotheses.closeLoop", {
      path: PATH,
      basedOn: (await page()).hash,
    });
  return {
    vault,
    c,
    bytes,
    page,
    close,
    later: (days: number) => {
      now = new Date(at.getTime() + days * 86_400_000);
    },
  };
}

describe("hypotheses.closeLoop to a Question", () => {
  it("marks the Question answered with one line in its lead, and writes nothing to the Hypothesis", async () => {
    const h = await opened({
      [QUESTION_PATH]: QUESTION,
      [PATH]: hypothesis(FALSIFIED),
    });
    const before = await h.bytes(PATH);

    const reply = await h.close();

    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toEqual({ path: QUESTION_PATH });
    expect(await h.bytes(QUESTION_PATH)).toBe(
      QUESTION.replace("status: promoted", "status: answered").replace(
        'promoted_to: "[[The pooled effect is mostly small-study bias]]"\n---\n',
        'promoted_to: "[[The pooled effect is mostly small-study bias]]"\nanswered: 2026-09-30T10:00:00+05:30\n---\nAnswered by [[The pooled effect is mostly small-study bias]] — falsified, 2026-09-30\n'
      )
    );
    expect(await h.bytes(PATH)).toBe(before);
  });

  it("shows on the Inbox row as answered with the result", async () => {
    const h = await opened({
      [QUESTION_PATH]: QUESTION,
      [PATH]: hypothesis(FALSIFIED),
    });
    await h.close();

    const listing = await h.c.query<Listing>("questions.list");
    const row = listing.result?.data.questions.find((q) =>
      q.path.endsWith(QUESTION_PATH)
    );
    expect(row?.status).toBe("answered");
    expect(row?.answeredWith).toBe("falsified");
  });

  it("drops the result from the row once the Question is reopened", async () => {
    const h = await opened({
      [QUESTION_PATH]: QUESTION,
      [PATH]: hypothesis(FALSIFIED),
    });
    await h.close();
    expect(
      (await h.c.mutate("questions.reopen", { path: QUESTION_PATH })).error
    ).toBeUndefined();

    const listing = await h.c.query<Listing>("questions.list");
    const row = listing.result?.data.questions.find((q) =>
      q.path.endsWith(QUESTION_PATH)
    );
    expect(row?.status).toBe("open");
    expect(row?.answeredWith).toBeUndefined();
  });

  it("reads no result from a line that names something other than a Hypothesis, or that a newer answer follows", async () => {
    const byHand = QUESTION.replace("status: promoted", "status: answered")
      .replace(
        'promoted_to: "[[The pooled effect is mostly small-study bias]]"\n',
        ""
      )
      .concat("Answered by [[Some note]] \u2014 supported, 2026-09-01\n");
    const superseded = QUESTION.replace(
      "status: promoted",
      "status: answered"
    ).concat(
      "Answered by [[The pooled effect is mostly small-study bias]] \u2014 falsified, 2026-09-01\n\nAnswered by [[Why do the effects disperse (RQ)]] \u2014 2026-09-20\n"
    );
    const h = await opened({
      ["questions/By hand.md"]: byHand,
      [QUESTION_PATH]: superseded,
      ["Some note.md"]: "A note.\n",
      [RQ_PATH]: RQ,
      [PATH]: hypothesis(FALSIFIED),
    });

    const listing = await h.c.query<Listing>("questions.list");
    const rows = listing.result?.data.questions ?? [];
    expect(rows.map((q) => [q.status, q.answeredWith])).toEqual([
      ["answered", undefined],
      ["answered", undefined],
    ]);
  });

  it("reads the loop closed on the page, from the Question's line", async () => {
    const h = await opened({
      [QUESTION_PATH]: QUESTION,
      [PATH]: hypothesis(FALSIFIED),
    });
    expect((await h.page()).loop).toEqual({
      status: "open",
      parent: { path: QUESTION_PATH, kind: "question" },
      refusal: null,
      result: "falsified",
    });

    await h.close();

    expect((await h.page()).loop).toEqual({
      status: "closed",
      parent: { path: QUESTION_PATH, kind: "question" },
      refusal: null,
      result: "falsified",
      written: { result: "falsified", date: "2026-09-30" },
    });
  });
});

describe("hypotheses.closeLoop to a Research Question", () => {
  it("appends the line under Related questions and leaves the Status alone", async () => {
    const h = await opened({
      [RQ_PATH]: RQ,
      [PATH]: hypothesis(SUPPORTED, {
        from: "[[Why do the effects disperse (RQ)]]",
      }),
    });

    const reply = await h.close();

    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toEqual({ path: RQ_PATH });
    expect(await h.bytes(RQ_PATH)).toBe(
      RQ.replace(
        "sharpened into a hypothesis, 2026-09-20\n",
        "sharpened into a hypothesis, 2026-09-20\n- [[The pooled effect is mostly small-study bias]] — supported, 2026-09-30\n"
      )
    );
    const rq = await h.c.query<ResearchQuestionPage>("researchQuestions.page", {
      path: RQ_PATH,
    });
    expect(rq.result?.data).toMatchObject({ frontmatter: { status: "open" } });
    // The sharpened line names the Hypothesis too, and is not a result.
    expect((await h.page()).loop).toMatchObject({
      status: "closed",
      written: { result: "supported", date: "2026-09-30" },
    });
  });
});

describe("the result word", () => {
  it.each([
    ["falsified", FALSIFIED, ""],
    ["supported", SUPPORTED, ""],
    [
      "supported (override)",
      AWAITING.replace(`${F2}`, `${F2}\noutcome:: inconclusive`),
      OVERRIDE,
    ],
    ["inconclusive", TESTED_UNDECIDED, ""],
  ])("writes %s", async (word, criteria, history) => {
    const h = await opened({
      [QUESTION_PATH]: QUESTION,
      [PATH]: hypothesis(criteria, { history }),
    });

    expect((await h.close()).error).toBeUndefined();

    expect(await h.bytes(QUESTION_PATH)).toContain(
      `---\nAnswered by [[The pooled effect is mostly small-study bias]] — ${word}, 2026-09-30\n`
    );
  });
});

describe("refusals", () => {
  it("refuses a Hypothesis that is not closable — something still awaits evidence", async () => {
    const h = await opened({
      [QUESTION_PATH]: QUESTION,
      [PATH]: hypothesis(AWAITING),
    });
    const refusal =
      "A criterion still awaits evidence: not yet tested is not an answer.";
    expect((await h.page()).loop).toMatchObject({ status: "open", refusal });

    const reply = await h.close();

    expect(reply.error?.data.kind).toBe("refused");
    expect(reply.error?.message).toBe(refusal);
    expect(await h.bytes(QUESTION_PATH)).toBe(QUESTION);
  });

  it("refuses a Hypothesis with no criteria written", async () => {
    const h = await opened({
      [QUESTION_PATH]: QUESTION,
      [PATH]: hypothesis(""),
    });
    const refusal = "No criteria are written: not yet tested is not an answer.";
    expect((await h.page()).loop).toMatchObject({ status: "open", refusal });

    const reply = await h.close();

    expect(reply.error?.data.kind).toBe("refused");
    expect(reply.error?.message).toBe(refusal);
    expect(await h.bytes(QUESTION_PATH)).toBe(QUESTION);
  });

  it("says once, quietly, that a Hypothesis with no promoted_from has nothing to write back to, and refuses the write", async () => {
    const h = await opened({ [PATH]: hypothesis(FALSIFIED, { from: "" }) });

    expect((await h.page()).loop).toEqual({
      status: "none",
      refusal: null,
      result: "falsified",
    });
    const reply = await h.close();
    expect(reply.error?.data.kind).toBe("refused");
    expect(reply.error?.message).toMatch(/nothing to write back to/);
  });

  it("refuses a parent that no longer resolves, with the reason", async () => {
    const h = await opened({ [PATH]: hypothesis(FALSIFIED) });

    expect((await h.page()).loop).toMatchObject({
      status: "unresolved",
      reason:
        "[[Does the reanalysis shrink the pooled effect]] matches no file in the vault",
    });
    const reply = await h.close();
    expect(reply.error?.data.kind).toBe("refused");
    expect(reply.error?.message).toMatch(/matches no file in the vault/);
  });

  it("refuses a parent that resolves to more than one file", async () => {
    const h = await opened({
      [QUESTION_PATH]: QUESTION,
      ["elsewhere/Does the reanalysis shrink the pooled effect.md"]: QUESTION,
      [PATH]: hypothesis(FALSIFIED),
    });

    const reply = await h.close();

    expect(reply.error?.data.kind).toBe("refused");
    expect(reply.error?.message).toMatch(/matches more than one file/);
    expect(await h.bytes(QUESTION_PATH)).toBe(QUESTION);
  });

  it("refuses a close made on a page read the Hypothesis has since moved past", async () => {
    const h = await opened({
      [QUESTION_PATH]: QUESTION,
      [PATH]: hypothesis(FALSIFIED),
    });

    const reply = await h.c.mutate("hypotheses.closeLoop", {
      path: PATH,
      basedOn: "not the hash",
    });

    expect(reply.error?.data.kind).toBe("refused");
    expect(await h.bytes(QUESTION_PATH)).toBe(QUESTION);
  });
});

describe("the state moved since", () => {
  it("says the written line no longer matches, and closing again appends rather than rewrites", async () => {
    const h = await opened({
      [QUESTION_PATH]: QUESTION,
      [PATH]: hypothesis(FALSIFIED),
    });
    await h.close();

    // F2 corrected in Obsidian: the reanalysis did not in fact kill it.
    await writeFile(join(h.vault, PATH), hypothesis(SUPPORTED));
    await h.c.indexed();
    expect((await h.page()).loop).toMatchObject({
      status: "closed",
      result: "supported",
      written: { result: "falsified", date: "2026-09-30" },
    });

    h.later(1);
    expect((await h.close()).error).toBeUndefined();

    const question = await h.bytes(QUESTION_PATH);
    expect(question).toContain(
      "\nAnswered by [[The pooled effect is mostly small-study bias]] — falsified, 2026-09-30\n\nAnswered by [[The pooled effect is mostly small-study bias]] — supported, 2026-10-01\n"
    );
    expect(question).toContain("answered: 2026-10-01T10:00:00+05:30\n");
    expect((await h.page()).loop).toMatchObject({
      status: "closed",
      result: "supported",
      written: { result: "supported", date: "2026-10-01" },
    });
  });
});
