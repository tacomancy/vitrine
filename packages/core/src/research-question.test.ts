import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { ResearchQuestionPage } from "./research-question.js";
import { closeCores, core, sha256, tmp, vaultWith } from "./test-core.js";

afterEach(closeCores);

type Vault = { name: string; path: string };

const FRONTMATTER = `---
id: rq7m2p9q4w
kind: research-question
question: "Does slow-wave density predict recall gain?"
status: open
promoted_from: "[[Does slow-wave density predict recall gain]]"
promoted: 2026-09-20T10:00:00+02:00
captured: 2026-08-14T09:12:00+01:00
context: reading
from: "[[Rasch & Born 2013]]"
page: 699
tags:
  - memory/consolidation
---
`;

const WELL_FORMED = `${FRONTMATTER}
## Working answer

Probably both, but the dissociation designs are underpowered.

## Supporting sources

- [[rasch2013#^h4]] — TMR effects survive encoding controls.
- [[klinzing2019]]

## Opposing sources

- [[wamsley2019]] — Waking rest produces a comparable benefit.
- a line that is not a source

## Related questions

- [[What counts as a reactivation event]] — shares 2 sources
- [[Nowhere]]

## Open threads

- [ ] Have not read Cordi & Rasch 2021 past the abstract.
- [x] Is TMR orthogonal to encoding?
- a thread that is not a task

## Position history

- 2026-09-21T09:00:00+02:00 · working answer
  from:
`;

/** The vault around the page: the sources and questions its lines point at. */
const NEIGHBOURS = {
  "sources/rasch2013.md":
    '---\nkind: source\ncitekey: rasch2013\n---\n\n## Annotations\n\n- p.699 · "overnight retention" ^h4\n',
  "sources/klinzing2019.md":
    "---\nkind: source-stub\ncitekey: klinzing2019\n---\n",
  "questions/What counts as a reactivation event.md":
    '---\nkind: question\nquestion: "What counts as a reactivation event?"\ncaptured: 2026-08-01T09:00:00+01:00\n---\n',
  // Two files by one name make `[[wamsley2019]]` ambiguous.
  "sources/wamsley2019.md": "---\nkind: source\n---\n",
  "a/wamsley2019.md": "note\n",
};

async function openedPage(files: Record<string, string>, path: string) {
  const vault = await vaultWith(files);
  const c = await core();
  const opened = await c.mutate<Vault>("vault.open", { path: vault });
  expect(opened.error).toBeUndefined();
  await c.indexed();
  const reply = await c.query<ResearchQuestionPage>("researchQuestions.page", {
    path,
  });
  expect(reply.error).toBeUndefined();
  return { vault, c, page: reply.result?.data as ResearchQuestionPage };
}

describe("researchQuestions.page", () => {
  it("reads a well-formed page: frontmatter, six sections with their line grammars, no problems, the file's hash", async () => {
    const path = "questions/Does slow-wave density predict recall gain (RQ).md";
    const { vault, page } = await openedPage(
      { ...NEIGHBOURS, [path]: WELL_FORMED },
      path
    );
    expect(page.readable).toBe(true);
    if (!page.readable) return;
    expect(page.path).toBe(path);
    expect(page.hash).toBe(sha256(await readFile(join(vault, path))));
    expect(page.frontmatter).toEqual({
      id: "rq7m2p9q4w",
      question: "Does slow-wave density predict recall gain?",
      status: "open",
      promotedFrom: "[[Does slow-wave density predict recall gain]]",
      promoted: "2026-09-20T10:00:00+02:00",
      captured: "2026-08-14T09:12:00+01:00",
      context: "reading",
      from: "[[Rasch & Born 2013]]",
      page: 699,
      tags: ["memory/consolidation"],
    });
    expect(page.problems).toEqual([]);

    const { sections } = page;
    expect(sections.workingAnswer).toEqual({
      present: true,
      text: "Probably both, but the dissociation designs are underpowered.",
    });
    expect(sections.supporting).toEqual({
      present: true,
      lines: [
        {
          text: "[[rasch2013#^h4]] — TMR effects survive encoding controls.",
          link: {
            target: "rasch2013",
            blockId: "h4",
            resolution: "resolved",
            resolvedPath: "sources/rasch2013.md",
          },
          note: "TMR effects survive encoding controls.",
        },
        {
          text: "[[klinzing2019]]",
          link: {
            target: "klinzing2019",
            blockId: null,
            resolution: "resolved",
            resolvedPath: "sources/klinzing2019.md",
          },
          note: "",
        },
      ],
    });
    // An ambiguous citekey and a line with no link are both kept and said.
    expect(sections.opposing).toEqual({
      present: true,
      lines: [
        {
          text: "[[wamsley2019]] — Waking rest produces a comparable benefit.",
          link: {
            target: "wamsley2019",
            blockId: null,
            resolution: "ambiguous",
            resolvedPath: null,
          },
          note: "Waking rest produces a comparable benefit.",
        },
        {
          text: "a line that is not a source",
          link: null,
          note: "a line that is not a source",
        },
      ],
    });
    expect(sections.related).toEqual({
      present: true,
      lines: [
        {
          text: "[[What counts as a reactivation event]] — shares 2 sources",
          link: {
            target: "What counts as a reactivation event",
            blockId: null,
            resolution: "resolved",
            resolvedPath: "questions/What counts as a reactivation event.md",
          },
          note: "shares 2 sources",
        },
        {
          text: "[[Nowhere]]",
          link: {
            target: "Nowhere",
            blockId: null,
            resolution: "unresolved",
            resolvedPath: null,
          },
          note: "",
        },
      ],
    });
    expect(sections.openThreads).toEqual({
      present: true,
      threads: [
        {
          text: "Have not read Cordi & Rasch 2021 past the abstract.",
          done: false,
        },
        { text: "Is TMR orthogonal to encoding?", done: true },
        { text: "a thread that is not a task", done: null },
      ],
    });
    expect(sections.positionHistory).toEqual({
      present: true,
      text: "- 2026-09-21T09:00:00+02:00 · working answer\n  from:",
    });
  });

  it("reads a freshly promoted page: every section present and empty", async () => {
    const path = "questions/fresh (RQ).md";
    const fresh =
      FRONTMATTER +
      "\n## Working answer\n\n## Supporting sources\n\n## Opposing sources\n\n## Related questions\n\n## Open threads\n\n## Position history\n";
    const { page } = await openedPage({ [path]: fresh }, path);
    expect(page.readable).toBe(true);
    if (!page.readable) return;
    expect(page.problems).toEqual([]);
    expect(page.sections).toEqual({
      workingAnswer: { present: true, text: "" },
      supporting: { present: true, lines: [] },
      opposing: { present: true, lines: [] },
      related: { present: true, lines: [] },
      openThreads: { present: true, threads: [] },
      positionHistory: { present: true, text: "" },
    });
  });

  it("a retyped heading is a missing section and a duplicated owned section is a problem, beside what parses", async () => {
    const path = "questions/retyped (RQ).md";
    const retyped =
      FRONTMATTER +
      "\n## Working answers\n\nTyped under the wrong heading.\n\n## Supporting sources\n\n- [[rasch2013]]\n\n## Opposing sources\n\n## Related questions\n\n## Open threads\n\n## Position history\n\n## Position history\n";
    const { page } = await openedPage({ ...NEIGHBOURS, [path]: retyped }, path);
    expect(page.readable).toBe(true);
    if (!page.readable) return;
    expect(page.problems).toEqual([
      {
        path,
        kind: "research-question",
        problem: "ownedSectionDuplicated",
        block: "Position history",
      },
      {
        path,
        kind: "research-question",
        problem: "sectionMissing",
        block: "Working answer",
      },
    ]);
    expect(page.sections.workingAnswer).toEqual({ present: false, text: "" });
    expect(page.sections.supporting.lines.map((l) => l.link?.target)).toEqual([
      "rasch2013",
    ]);
  });

  it("a section present twice uses the first and says so", async () => {
    const path = "questions/twice (RQ).md";
    const twice =
      FRONTMATTER +
      "\n## Working answer\n\nfirst\n\n## Working answer\n\nsecond\n\n## Supporting sources\n\n## Opposing sources\n\n## Related questions\n\n## Open threads\n\n## Position history\n";
    const { page } = await openedPage({ [path]: twice }, path);
    expect(page.readable).toBe(true);
    if (!page.readable) return;
    expect(page.problems).toEqual([
      {
        path,
        kind: "research-question",
        problem: "sectionDuplicated",
        block: "Working answer",
      },
    ]);
    expect(page.sections.workingAnswer.text).toBe("first");
  });

  it("a file that is not a Research Question, or lacks its question, is not readable as a page", async () => {
    const question = "questions/q.md";
    const noQuestion = "questions/noq (RQ).md";
    const { c } = await openedPage(
      {
        [question]:
          '---\nkind: question\nquestion: "q"\ncaptured: 2026-08-01T09:00:00+01:00\n---\n',
        [noQuestion]: "---\nkind: research-question\n---\n",
      },
      question
    );
    const asQuestion = await c.query<ResearchQuestionPage>(
      "researchQuestions.page",
      { path: question }
    );
    expect(asQuestion.result?.data).toEqual({
      readable: false,
      path: question,
      reason: "not a Research Question: kind is question",
    });
    const missing = await c.query<ResearchQuestionPage>(
      "researchQuestions.page",
      { path: noQuestion }
    );
    expect(missing.result?.data).toEqual({
      readable: false,
      path: noQuestion,
      reason: "question is missing",
    });
    const gone = await c.query<ResearchQuestionPage>("researchQuestions.page", {
      path: "questions/gone (RQ).md",
    });
    expect(gone.result?.data).toMatchObject({
      readable: false,
      path: "questions/gone (RQ).md",
    });
  });

  it("refuses a path outside the vault as an input error, typed outsideVault", async () => {
    const { c } = await openedPage({ "a.md": "" }, "a.md");
    const reply = await c.query<ResearchQuestionPage>(
      "researchQuestions.page",
      {
        path: "../elsewhere.md",
      }
    );
    expect(reply.error?.data.kind).toBe("outsideVault");
  });
});

describe("the Research Question Kind on the positionsOf seam", () => {
  it("after a build the positions table carries `working answer` for every Research Question and nothing for a Question", async () => {
    const vault = await tmp("positions");
    await mkdir(join(vault, "questions"));
    await writeFile(
      join(vault, "questions", "one (RQ).md"),
      FRONTMATTER +
        "\n## Working answer\n\nProbably both.\n\nA second paragraph.\n\n## Supporting sources\n\n## Position history\n"
    );
    await writeFile(
      join(vault, "questions", "blank (RQ).md"),
      FRONTMATTER + "\n## Working answer\n\n## Supporting sources\n"
    );
    await writeFile(
      join(vault, "questions", "q.md"),
      '---\nkind: question\nquestion: "q"\ncaptured: 2026-08-01T09:00:00+01:00\n---\n\n## Working answer\n\nnot a position\n'
    );
    const c = await core();
    const opened = await c.mutate<Vault>("vault.open", { path: vault });
    expect(opened.error).toBeUndefined();
    await c.indexed();
    const db = new DatabaseSync(join(vault, ".vitrine", "index.sqlite"), {
      readOnly: true,
    });
    const rows = db
      .prepare("SELECT path, field, text FROM positions ORDER BY path")
      .all();
    db.close();
    expect(rows).toEqual([
      { path: "questions/blank (RQ).md", field: "working answer", text: "" },
      {
        path: "questions/one (RQ).md",
        field: "working answer",
        text: "Probably both.\n\nA second paragraph.",
      },
    ]);
  });
});
