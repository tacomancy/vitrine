import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { HypothesisPage } from "./hypothesis.js";
import type { Question } from "./questions.js";
import { closeCores, core, fingerprint, vaultWith } from "./test-core.js";

// The follow-up question and the related rail (#339; spec #327 stories 18,
// 71–74; ADR 0031 decision 11). A capture on a Hypothesis's page is the one
// capture path with the page as its `from:` — `resolving` for the follow-up
// the result raised, `pursuing` for anything else — and nothing is written
// onto the page: the rail is a query over the Questions that name it.

afterEach(closeCores);

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

const PATH = "hypotheses/The pooled effect is mostly small-study bias.md";
const NAME = "[[The pooled effect is mostly small-study bias]]";

const hypothesis = (from: string) => `---
id: hy00000001
kind: hypothesis
${from === "" ? "" : `promoted_from: "${from}"\n`}context: other
---

## Claim

The pooled effect is mostly small-study bias.

## Criteria

### The effect vanishes in the large-study stratum ^c1

relationship:: falsifying
outcome:: met

## Design notes

## Position history
`;

/** A Question written by another hand, naming whatever `from` says. */
const question = (id: string, text: string, from: string, context: string) =>
  `---
id: ${id}
kind: question
question: "${text}"
status: open
captured: 2026-09-2${id.at(-1)}T09:00:00+05:30
from: "${from}"
context: ${context}
---
`;

async function opened(files: Record<string, string>) {
  const vault = await vaultWith(files);
  const c = await core({ now: () => at });
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
  const capture = (text: string, provenance: Record<string, string>) =>
    c.mutate<Question>("questions.capture", { text, provenance });
  return { vault, c, bytes, page, capture };
}

describe("a capture on a Hypothesis's page", () => {
  it("writes the follow-up with `from:` the Hypothesis and `context: resolving`, and nothing onto the page", async () => {
    const h = await opened({
      [QUESTION_PATH]: QUESTION,
      [PATH]: hypothesis("[[Does the reanalysis shrink the pooled effect]]"),
    });
    const before = await h.bytes(PATH);

    const reply = await h.capture("What produces the dispersion, then?", {
      context: "resolving",
      hypothesis: PATH,
    });

    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toMatchObject({
      question: "What produces the dispersion, then?",
      status: "open",
      from: NAME,
      context: "resolving",
    });
    expect(await h.bytes("questions/What produces the dispersion, then.md"))
      .toBe(`---
id: ${reply.result?.data.id}
kind: question
question: "What produces the dispersion, then?"
status: open
captured: 2026-09-30T10:00:00+05:30
from: "${NAME}"
context: resolving
---
`);
    expect(await h.bytes(PATH)).toBe(before);
  });

  it("writes any other capture as a sub-question, `context: pursuing`, and nothing onto the page", async () => {
    const h = await opened({ [PATH]: hypothesis("") });
    const before = await h.bytes(PATH);

    const reply = await h.capture("Is the stratum boundary arbitrary?", {
      context: "pursuing",
      page: PATH,
    });

    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toMatchObject({
      from: NAME,
      context: "pursuing",
    });
    expect(await h.bytes(PATH)).toBe(before);
  });

  it("takes the follow-up on a Hypothesis promoted from nothing", async () => {
    const h = await opened({ [PATH]: hypothesis("") });

    const reply = await h.capture("What next?", {
      context: "resolving",
      hypothesis: PATH,
    });

    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toMatchObject({ context: "resolving" });
  });

  it("refuses a follow-up whose page is not a Hypothesis, writing nothing", async () => {
    const h = await opened({ [QUESTION_PATH]: QUESTION });
    const before = await fingerprint(h.vault);

    const reply = await h.capture("Orphaned?", {
      context: "resolving",
      hypothesis: QUESTION_PATH,
    });

    expect(reply.error?.data.kind).toBe("writeFailed");
    expect(reply.error?.message).toContain(
      `${QUESTION_PATH} is not a Hypothesis`
    );
    expect(await fingerprint(h.vault)).toEqual(before);
  });

  it("refuses a pursuing capture on a page that is neither a Research Question nor a Hypothesis, writing nothing", async () => {
    const h = await opened({ [QUESTION_PATH]: QUESTION });
    const before = await fingerprint(h.vault);

    const reply = await h.capture("Orphaned?", {
      context: "pursuing",
      page: QUESTION_PATH,
    });

    expect(reply.error?.data.kind).toBe("writeFailed");
    expect(reply.error?.message).toContain(
      `${QUESTION_PATH} is not a Research Question or a Hypothesis`
    );
    expect(await fingerprint(h.vault)).toEqual(before);
  });
});

describe("the related rail", () => {
  it("names the object promoted from, and every Question whose `from:` names the page, newest first", async () => {
    const h = await opened({
      [QUESTION_PATH]: QUESTION,
      [PATH]: hypothesis("[[Does the reanalysis shrink the pooled effect]]"),
      "questions/Raised while designing.md": question(
        "q000000002",
        "Raised while designing?",
        NAME,
        "pursuing"
      ),
      "questions/The follow-up.md": question(
        "q000000003",
        "The follow-up?",
        NAME,
        "resolving"
      ),
      // Naming a different page, and naming nothing: neither is a neighbour.
      "questions/Elsewhere.md": question(
        "q000000004",
        "Elsewhere?",
        "[[Does the reanalysis shrink the pooled effect]]",
        "pursuing"
      ),
      "questions/Free text.md": question(
        "q000000005",
        "Free text?",
        "The pooled effect is mostly small-study bias",
        "other"
      ),
    });

    const { related } = await h.page();

    expect(related.promotedFrom).toEqual({
      link: "[[Does the reanalysis shrink the pooled effect]]",
      path: QUESTION_PATH,
      kind: "question",
      display: "Does the reanalysis shrink the pooled effect?",
      reason: null,
    });
    expect(related.questions).toEqual([
      {
        path: "questions/The follow-up.md",
        question: "The follow-up?",
        status: "open",
        context: "resolving",
        captured: "2026-09-23T09:00:00+05:30",
      },
      {
        path: "questions/Raised while designing.md",
        question: "Raised while designing?",
        status: "open",
        context: "pursuing",
        captured: "2026-09-22T09:00:00+05:30",
      },
    ]);
  });

  it("lists a capture made on the page at once", async () => {
    const h = await opened({ [PATH]: hypothesis("") });
    await h.capture("What next?", { context: "resolving", hypothesis: PATH });

    expect((await h.page()).related.questions).toMatchObject([
      { question: "What next?", context: "resolving" },
    ]);
  });

  it("has no parent for a Hypothesis promoted from nothing, and names one that does not resolve rather than dropping it", async () => {
    const none = await opened({ [PATH]: hypothesis("") });
    expect((await none.page()).related.promotedFrom).toBeNull();

    const gone = await opened({ [PATH]: hypothesis("[[Nowhere]]") });
    expect((await gone.page()).related.promotedFrom).toEqual({
      link: "[[Nowhere]]",
      path: null,
      kind: null,
      display: null,
      reason: "[[Nowhere]] matches no file in the vault",
    });
  });
});
