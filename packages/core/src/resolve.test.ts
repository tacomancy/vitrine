import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Listing } from "./list.js";
import type {
  ResearchQuestionPage,
  ResolveResult,
} from "./research-question.js";
import type { WriteResult } from "./vault-files.js";
import { closeCores, core, vaultWith } from "./test-core.js";

afterEach(closeCores);

// `answered` carries the local offset, so the clock is pinned to one zone.
beforeAll(() => {
  process.env["TZ"] = "Asia/Kolkata";
});
const at = new Date("2026-09-21T10:00:00+05:30");

const QUESTION_PATH = "questions/Does slow-wave density predict recall gain.md";
const PAGE_PATH =
  "questions/Does slow-wave density predict recall gain (RQ).md";

/** The Question as promotion left it: promoted, pointing at the page, with a body of its own. */
const QUESTION = `---
id: k7m2p9q4wx
kind: question
question: "Does slow-wave density predict recall gain?"
status: promoted
captured: 2026-08-14T09:12:00+01:00
context: reading
from: "[[Rasch & Born 2013]]"
page: 699
promoted_to: "[[Does slow-wave density predict recall gain (RQ)]]"
---

Some body the user wrote.
`;

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
---

## Working answer

Probably both, but the dissociation designs are underpowered.

## Supporting sources

- [[rasch2013]] — TMR effects survive encoding controls.

## Opposing sources

## Related questions

## Open threads

- [x] Is TMR orthogonal to encoding?

## Position history

- 2026-09-21T09:00:00+05:30 · working answer
  from:
`;

async function opened(files: Record<string, string>) {
  const vault = await vaultWith(files);
  const c = await core({ now: () => at });
  const reply = await c.mutate("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  return { vault, c };
}

const bothFiles = { [QUESTION_PATH]: QUESTION, [PAGE_PATH]: PAGE };

describe("researchQuestions.resolve", () => {
  it("sets the page's keys, then the Question's, and appends the line to the Question's lead", async () => {
    const { vault, c } = await opened(bothFiles);

    const reply = await c.mutate<ResolveResult>("researchQuestions.resolve", {
      path: PAGE_PATH,
      status: "answered",
    });

    expect(reply.error).toBeUndefined();
    expect(reply.result?.data.page).toMatchObject({ written: true });
    expect(reply.result?.data.question).toEqual({
      written: true,
      path: QUESTION_PATH,
    });
    // The page: the two keys, everything else byte-identical.
    expect(await readFile(join(vault, PAGE_PATH), "utf8")).toBe(
      PAGE.replace("status: open\n", "status: answered\n").replace(
        "page: 699\n---",
        "page: 699\nanswered: 2026-09-21T10:00:00+05:30\n---"
      )
    );
    // The Question: the two keys, and the line at the end of its lead.
    expect(await readFile(join(vault, QUESTION_PATH), "utf8")).toBe(
      QUESTION.replace("status: promoted\n", "status: answered\n")
        .replace(
          'promoted_to: "[[Does slow-wave density predict recall gain (RQ)]]"\n',
          'promoted_to: "[[Does slow-wave density predict recall gain (RQ)]]"\nanswered: 2026-09-21T10:00:00+05:30\n'
        )
        .replace(
          "Some body the user wrote.\n",
          "Some body the user wrote.\n\nAnswered by [[Does slow-wave density predict recall gain (RQ)]] — 2026-09-21\n"
        )
    );
  });

  it("turns the Inbox row from promoted to answered, and the page reads answered at once", async () => {
    const { c } = await opened(bothFiles);
    await c.mutate("researchQuestions.resolve", {
      path: PAGE_PATH,
      status: "answered",
    });

    // No wait on the watcher: the index was told of both writes.
    const listing = await c.query<Listing>("questions.list");
    expect(listing.result?.data.questions).toEqual([
      expect.objectContaining({ status: "answered" }),
    ]);
    const page = await c.query<ResearchQuestionPage>("researchQuestions.page", {
      path: PAGE_PATH,
    });
    expect(page.result?.data).toMatchObject({
      readable: true,
      frontmatter: {
        status: "answered",
        answered: "2026-09-21T10:00:00+05:30",
      },
    });
  });

  it("abandons both files with the abandoned wording and no answered date", async () => {
    const { vault, c } = await opened(bothFiles);

    const reply = await c.mutate<ResolveResult>("researchQuestions.resolve", {
      path: PAGE_PATH,
      status: "abandoned",
    });

    expect(reply.result?.data.question).toEqual({
      written: true,
      path: QUESTION_PATH,
    });
    const page = await readFile(join(vault, PAGE_PATH), "utf8");
    expect(page).toContain("status: abandoned");
    expect(page).not.toContain("answered:");
    const question = await readFile(join(vault, QUESTION_PATH), "utf8");
    expect(question).toContain("status: abandoned");
    expect(question).not.toContain("answered:");
    expect(question).toContain(
      "Some body the user wrote.\n\nAbandoned with [[Does slow-wave density predict recall gain (RQ)]] — 2026-09-21\n"
    );
  });

  it("puts the line in the lead of a Question whose body has a ## section, never inside it", async () => {
    const withSection = QUESTION.replace(
      "Some body the user wrote.\n",
      "Some body the user wrote.\n\n## Notes\n\n- something I read later\n"
    );
    const { vault, c } = await opened({
      ...bothFiles,
      [QUESTION_PATH]: withSection,
    });

    await c.mutate("researchQuestions.resolve", {
      path: PAGE_PATH,
      status: "answered",
    });

    expect(await readFile(join(vault, QUESTION_PATH), "utf8")).toContain(
      "Some body the user wrote.\n\nAnswered by [[Does slow-wave density predict recall gain (RQ)]] — 2026-09-21\n\n## Notes\n\n- something I read later\n"
    );
  });

  it("reports the refusal and leaves the page resolved when the Question is missing", async () => {
    const { vault, c } = await opened({ [PAGE_PATH]: PAGE });

    const reply = await c.mutate<ResolveResult>("researchQuestions.resolve", {
      path: PAGE_PATH,
      status: "answered",
    });

    expect(reply.result?.data.page).toMatchObject({ written: true });
    expect(reply.result?.data.question).toMatchObject({ written: false });
    expect(
      (reply.result?.data.question as { reason: string }).reason
    ).toContain("Does slow-wave density predict recall gain");
    expect(await readFile(join(vault, PAGE_PATH), "utf8")).toContain(
      "status: answered"
    );
  });

  it("refuses to write back to a file that is not a Question, leaving it untouched", async () => {
    const note = "questions/Does slow-wave density predict recall gain.md";
    const notAQuestion = "---\nkind: note\n---\n\nA note by that name.\n";
    const { vault, c } = await opened({
      [note]: notAQuestion,
      [PAGE_PATH]: PAGE,
    });

    const reply = await c.mutate<ResolveResult>("researchQuestions.resolve", {
      path: PAGE_PATH,
      status: "answered",
    });

    expect(reply.result?.data.question).toMatchObject({ written: false });
    expect(await readFile(join(vault, note), "utf8")).toBe(notAQuestion);
  });

  it("refuses a file that is not a Research Question, writing nothing", async () => {
    const note = "notes/plan.md";
    const content =
      "---\nkind: note\n---\n\n## Working answer\n\nnot a page.\n";
    const { vault, c } = await opened({ [note]: content });

    const reply = await c.mutate<ResolveResult>("researchQuestions.resolve", {
      path: note,
      status: "answered",
    });

    expect(reply.result?.data.page).toMatchObject({
      written: false,
      reason: "unreadable",
    });
    expect(reply.result?.data.question).toMatchObject({ written: false });
    expect(await readFile(join(vault, note), "utf8")).toBe(content);
  });
});

describe("researchQuestions.reopen", () => {
  it("restores open on the page with the body and history byte-identical, and the Question's line still there", async () => {
    const { vault, c } = await opened(bothFiles);
    await c.mutate("researchQuestions.resolve", {
      path: PAGE_PATH,
      status: "answered",
    });
    const question = await readFile(join(vault, QUESTION_PATH), "utf8");

    const reply = await c.mutate<WriteResult>("researchQuestions.reopen", {
      path: PAGE_PATH,
    });

    expect(reply.result?.data).toMatchObject({ written: true });
    const page = await readFile(join(vault, PAGE_PATH), "utf8");
    expect(page).toContain("status: open");
    // The body is what it was before resolving: every section, and the history.
    expect(page.slice(page.indexOf("## Working answer"))).toBe(
      PAGE.slice(PAGE.indexOf("## Working answer"))
    );
    // `answered` stays: it is the day the page was last resolved, and the
    // next resolve overwrites it (CONTEXT.md *Reopen* of a Research Question).
    expect(page).toContain("answered: 2026-09-21T10:00:00+05:30");
    // The Question is not rewritten: its own reopen is the Inbox's (#212).
    expect(await readFile(join(vault, QUESTION_PATH), "utf8")).toBe(question);
  });

  it("reads back as open on the page and refuses a file that is not a Research Question", async () => {
    const { c } = await opened(bothFiles);
    await c.mutate("researchQuestions.resolve", {
      path: PAGE_PATH,
      status: "abandoned",
    });
    await c.mutate("researchQuestions.reopen", { path: PAGE_PATH });

    const page = await c.query<ResearchQuestionPage>("researchQuestions.page", {
      path: PAGE_PATH,
    });
    expect(page.result?.data).toMatchObject({
      readable: true,
      frontmatter: { status: "open" },
    });

    const refused = await c.mutate<WriteResult>("researchQuestions.reopen", {
      path: QUESTION_PATH,
    });
    expect(refused.result?.data).toMatchObject({
      written: false,
      reason: "unreadable",
    });
  });
});
