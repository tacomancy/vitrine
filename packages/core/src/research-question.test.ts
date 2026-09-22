import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { ResearchQuestionPage } from "./research-question.js";
import { localIso } from "./time.js";
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
            resolvedKind: "source",
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
            resolvedKind: "source-stub",
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
            resolvedKind: null,
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
      text: "- [[What counts as a reactivation event]] — shares 2 sources\n- [[Nowhere]]",
      lines: [
        {
          text: "[[What counts as a reactivation event]] — shares 2 sources",
          link: {
            target: "What counts as a reactivation event",
            blockId: null,
            resolution: "resolved",
            resolvedPath: "questions/What counts as a reactivation event.md",
            resolvedKind: "question",
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
            resolvedKind: null,
          },
          note: "",
        },
      ],
    });
    expect(sections.openThreads).toEqual({
      present: true,
      text: "- [ ] Have not read Cordi & Rasch 2021 past the abstract.\n- [x] Is TMR orthogonal to encoding?\n- a thread that is not a task",
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
      entries: [
        {
          at: "2026-09-21T09:00:00+02:00",
          field: "working answer",
          why: null,
          from: "",
        },
      ],
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
      related: { present: true, text: "", lines: [] },
      openThreads: { present: true, text: "", threads: [] },
      positionHistory: { present: true, text: "", entries: [] },
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

  it("an item under the history that is not an entry is left out of the entries and reported as a shape problem naming its first line", async () => {
    const path = "questions/hand (RQ).md";
    const hand =
      FRONTMATTER +
      "\n## Working answer\n\n## Supporting sources\n\n## Opposing sources\n\n## Related questions\n\n## Open threads\n\n## Position history\n\n- 2026-09-21T09:00:00+02:00 · working answer\n  from:\n- a note someone typed\n  on two lines\n";
    const { page } = await openedPage({ [path]: hand }, path);
    expect(page.readable).toBe(true);
    if (!page.readable) return;
    expect(page.sections.positionHistory.entries.length).toBe(1);
    expect(page.problems).toEqual([
      {
        path,
        kind: "research-question",
        problem: "historyEntryUnparsed",
        block: "- a note someone typed",
      },
    ]);
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

// Editing the working answer records a Revision (#213; ADR 0020 decisions
// 1–2, ADR 0006 decision 5). One write per save: `## Working answer`
// replaced, the entry prepended — or the head re-stamped inside the window.
// Asserted on the bytes on disk, never on how the core got there.
describe("researchQuestions.saveWorkingAnswer", () => {
  const path = "questions/fresh (RQ).md";
  const REST =
    "\n## Supporting sources\n\n## Opposing sources\n\n## Related questions\n\n## Open threads\n\n## Position history\n";
  const fresh = FRONTMATTER + "\n## Working answer\n" + REST;
  const minute = 60_000;
  const t0 = new Date("2026-09-21T10:00:00+02:00");
  const at = (offsetMinutes: number) =>
    new Date(t0.getTime() + offsetMinutes * minute);

  type Saved =
    | { written: true; hash: string }
    | { written: false; reason: string; detail: string };

  async function opened(now: () => Date, files = { [path]: fresh }) {
    const vault = await vaultWith(files);
    const c = await core({ now, coalesceMs: 30 * minute });
    const openedVault = await c.mutate<Vault>("vault.open", { path: vault });
    expect(openedVault.error).toBeUndefined();
    await c.indexed();
    const page = async () => {
      const reply = await c.query<ResearchQuestionPage>(
        "researchQuestions.page",
        { path }
      );
      expect(reply.error).toBeUndefined();
      const data = reply.result?.data as ResearchQuestionPage;
      if (!data.readable) throw new Error(data.reason);
      return data;
    };
    const save = async (text: string, basedOn?: string) => {
      const reply = await c.mutate<Saved>(
        "researchQuestions.saveWorkingAnswer",
        {
          path,
          text,
          basedOn: basedOn ?? (await page()).hash,
        }
      );
      expect(reply.error).toBeUndefined();
      return reply.result?.data as Saved;
    };
    const file = () => readFile(join(vault, path), "utf8");
    return { vault, c, page, save, file };
  }

  const entry = (when: Date, from: string) =>
    `- ${localIso(when)} · working answer\n  from:${from === "" ? "" : "\n" + from.replace(/^(?!$)/gm, "    ")}`;

  it("two saves inside the window are one entry stamped with the second and holding the text from before the first; a third after the window is a second entry; the first entry of a fresh page has an empty from:", async () => {
    let now = t0;
    const { page, save, file } = await opened(() => now);

    const first = await save("Probably both.");
    expect(first).toMatchObject({ written: true });
    expect(await file()).toBe(
      FRONTMATTER +
        "\n## Working answer\n\nProbably both.\n" +
        REST +
        "\n" +
        entry(t0, "") +
        "\n"
    );
    // The reply's hash is the page's next basedOn.
    expect((await page()).hash).toBe((first as { hash: string }).hash);

    now = at(10);
    await save("Probably both, but the designs are underpowered.");
    expect(await file()).toBe(
      FRONTMATTER +
        "\n## Working answer\n\nProbably both, but the designs are underpowered.\n" +
        REST +
        "\n" +
        entry(at(10), "") +
        "\n"
    );

    now = at(41);
    await save("Encoding strength, mostly.\n\nA second paragraph.");
    expect(await file()).toBe(
      FRONTMATTER +
        "\n## Working answer\n\nEncoding strength, mostly.\n\nA second paragraph.\n" +
        REST +
        "\n" +
        entry(at(41), "Probably both, but the designs are underpowered.") +
        "\n" +
        entry(at(10), "") +
        "\n"
    );

    // The page reads the entries back, newest first, and the answer as saved.
    const after = await page();
    expect(after.sections.workingAnswer.text).toBe(
      "Encoding strength, mostly.\n\nA second paragraph."
    );
    expect(after.sections.positionHistory.entries).toEqual([
      {
        at: localIso(at(41)),
        field: "working answer",
        why: null,
        from: "Probably both, but the designs are underpowered.",
      },
      { at: localIso(at(10)), field: "working answer", why: null, from: "" },
    ]);
  });

  it("every other section is byte-identical across the saves, including what is written by hand under the history; the positions row follows the save", async () => {
    let now = t0;
    const filled =
      FRONTMATTER +
      "\n## Working answer\n\nFirst.\n\n## Supporting sources\n\n- [[rasch2013#^h4]] — TMR effects survive encoding controls.\n\n## Opposing sources\n\n## Related questions\n\n- [[What counts as a reactivation event]]\n\n## Open threads\n\n- [ ] Read Cordi.\n\n## Position history\n\na note typed by hand\n\n- 2026-09-20T12:00:00+02:00 · working answer\n  from:\n\nand another below\n";
    const { vault, page, save, file } = await opened(() => now, {
      [path]: filled,
    });

    await save("Second.");
    expect(await file()).toBe(
      filled
        .replace("First.", "Second.")
        .replace(
          "## Position history\n\n",
          `## Position history\n\n${entry(t0, "First.")}\n\n`
        )
    );
    // Inside the window: the new head is re-stamped in place, the hand-typed lines stay.
    now = at(5);
    await save("Third.");
    expect(await file()).toBe(
      filled
        .replace("First.", "Third.")
        .replace(
          "## Position history\n\n",
          `## Position history\n\n${entry(at(5), "First.")}\n\n`
        )
    );
    expect((await page()).sections.positionHistory.entries.length).toBe(2);

    const db = new DatabaseSync(join(vault, ".vitrine", "index.sqlite"), {
      readOnly: true,
    });
    const rows = db
      .prepare("SELECT field, text FROM positions WHERE path = ?")
      .all(path);
    db.close();
    expect(rows).toEqual([{ field: "working answer", text: "Third." }]);
  });

  it("saves in flight together leave one entry and the last text, whichever order they land in", async () => {
    const { page, save, file } = await opened(() => t0);
    // Both carry the hash the page was given — it saved twice before the
    // first reply came back. This is the invariant, not a proof of the
    // queue in `writeOwn`: the interleaving that would break it (both
    // planning from the file before either wrote) could not be forced
    // through this seam, and the assertion holds without the queue too.
    const hash = (await page()).hash;
    const replies = await Promise.all([
      save("First typing.", hash),
      save("Second typing.", hash),
    ]);
    expect(replies.every((r) => r.written)).toBe(true);

    const after = await page();
    expect(after.sections.positionHistory.entries).toEqual([
      { at: localIso(t0), field: "working answer", why: null, from: "" },
    ]);
    expect(after.sections.workingAnswer.text).toBe("Second typing.");
    expect(await file()).toContain("Second typing.");
  });

  it("saving the text the file already holds writes nothing and records no Revision", async () => {
    const { page, save, file } = await opened(() => t0, {
      [path]: fresh.replace(
        "## Working answer\n",
        "## Working answer\n\nSame.\n"
      ),
    });
    const before = await file();
    const { hash } = await page();
    // The reply is a write result like every other page write's; the hash
    // it carries is the file's, so the page's next save is based on it.
    expect(await save("Same.")).toMatchObject({ written: true, hash });
    expect(await file()).toBe(before);
  });

  it("a stale basedOn over a file that changed elsewhere re-applies and lands (ADR 0008 decision 3); a file that is gone is a refusal with its reason", async () => {
    const { vault, page, save, file } = await opened(() => t0);
    const stale = (await page()).hash;
    // Obsidian touched another section since the page read the file.
    await writeFile(
      join(vault, path),
      (await file()).replace(
        "## Open threads\n",
        "## Open threads\n\n- [ ] Read Cordi.\n"
      )
    );
    expect(await save("Typed.", stale)).toMatchObject({ written: true });
    expect(await file()).toContain("- [ ] Read Cordi.");
    expect(await file()).toContain("\nTyped.\n");

    await rm(join(vault, path));
    expect(await save("Later.", stale)).toMatchObject({
      written: false,
      reason: "unreadable",
    });
  });
});

/** The file's bytes outside one `##` section: what a section save must leave byte-identical. */
function outside(
  content: string,
  section: string
): [before: string, after: string] {
  const start = content.indexOf(`\n## ${section}\n`);
  if (start === -1) throw new Error(`no ## ${section}`);
  const next = content.indexOf("\n## ", start + 1);
  return [content.slice(0, start), next === -1 ? "" : content.slice(next)];
}

describe("researchQuestions.tickThread", () => {
  const path = "questions/Does slow-wave density predict recall gain (RQ).md";

  it("ticks a thread in place and rewrites only ## Open threads", async () => {
    const { vault, c } = await openedPage(
      { ...NEIGHBOURS, [path]: WELL_FORMED },
      path
    );
    const before = await readFile(join(vault, path), "utf8");
    const reply = await c.mutate<{ written: boolean }>(
      "researchQuestions.tickThread",
      {
        path,
        text: "Have not read Cordi & Rasch 2021 past the abstract.",
        done: true,
      }
    );
    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toMatchObject({ written: true });
    const after = await readFile(join(vault, path), "utf8");
    expect(after).toContain(
      "## Open threads\n\n- [x] Have not read Cordi & Rasch 2021 past the abstract.\n- [x] Is TMR orthogonal to encoding?\n- a thread that is not a task\n\n## Position history"
    );
    expect(outside(after, "Open threads")).toEqual(
      outside(before, "Open threads")
    );
    // The page reads the tick back, and the index saw the app's own write.
    const page = await c.query<ResearchQuestionPage>("researchQuestions.page", {
      path,
    });
    expect(page.result?.data).toMatchObject({
      sections: {
        openThreads: {
          threads: [
            {
              text: "Have not read Cordi & Rasch 2021 past the abstract.",
              done: true,
            },
            { text: "Is TMR orthogonal to encoding?", done: true },
            { text: "a thread that is not a task", done: null },
          ],
        },
      },
    });
  });

  it("unticks a thread, never deleting it", async () => {
    const { vault, c } = await openedPage(
      { ...NEIGHBOURS, [path]: WELL_FORMED },
      path
    );
    await c.mutate("researchQuestions.tickThread", {
      path,
      text: "Is TMR orthogonal to encoding?",
      done: false,
    });
    const after = await readFile(join(vault, path), "utf8");
    expect(after).toContain(
      "- [ ] Have not read Cordi & Rasch 2021 past the abstract.\n- [ ] Is TMR orthogonal to encoding?\n"
    );
  });

  it("refuses two threads with one text rather than guessing which was meant", async () => {
    const twice = WELL_FORMED.replace(
      "- [x] Is TMR orthogonal to encoding?\n",
      "- [x] Is TMR orthogonal to encoding?\n- [ ] Is TMR orthogonal to encoding?\n"
    );
    const { vault, c } = await openedPage(
      { ...NEIGHBOURS, [path]: twice },
      path
    );
    const reply = await c.mutate<{ written: boolean; detail?: string }>(
      "researchQuestions.tickThread",
      { path, text: "Is TMR orthogonal to encoding?", done: true }
    );
    expect(reply.result?.data).toMatchObject({
      written: false,
      detail: '2 open threads read "Is TMR orthogonal to encoding?"',
    });
    expect(await readFile(join(vault, path), "utf8")).toBe(twice);
  });

  it("refuses a file that is not a Research Question, whatever headings it has", async () => {
    const note = "notes/plan.md";
    const { vault, c } = await openedPage(
      { [note]: "## Open threads\n\n- [ ] a thread\n" },
      note
    );
    const reply = await c.mutate<{ written: boolean; reason?: string }>(
      "researchQuestions.tickThread",
      { path: note, text: "a thread", done: true }
    );
    expect(reply.result?.data).toMatchObject({
      written: false,
      reason: "unreadable",
    });
    expect(await readFile(join(vault, note), "utf8")).toBe(
      "## Open threads\n\n- [ ] a thread\n"
    );
  });

  it("refuses when the thread is not in the section, writing nothing", async () => {
    const { vault, c } = await openedPage(
      { ...NEIGHBOURS, [path]: WELL_FORMED },
      path
    );
    const before = await readFile(join(vault, path), "utf8");
    const reply = await c.mutate<{ written: boolean; reason?: string }>(
      "researchQuestions.tickThread",
      { path, text: "a thread that is not a task", done: true }
    );
    expect(reply.result?.data).toMatchObject({
      written: false,
      reason: "changedAndUnreapplyable",
    });
    expect(await readFile(join(vault, path), "utf8")).toBe(before);
  });
});

describe("researchQuestions.saveSection", () => {
  const path = "questions/Does slow-wave density predict recall gain (RQ).md";

  it("adding a related line with a note rewrites only ## Related questions, basedOn the page's hash", async () => {
    const { vault, c, page } = await openedPage(
      { ...NEIGHBOURS, [path]: WELL_FORMED },
      path
    );
    if (!page.readable) throw new Error("unreadable");
    // The page hands the field the section's text, and the field hands back what was typed.
    expect(page.sections.related.text).toBe(
      "- [[What counts as a reactivation event]] — shares 2 sources\n- [[Nowhere]]"
    );
    const before = await readFile(join(vault, path), "utf8");
    const reply = await c.mutate<{ written: boolean; hash?: string }>(
      "researchQuestions.saveSection",
      {
        path,
        section: "Related questions",
        body:
          page.sections.related.text +
          "\n- [[What counts as a reactivation event]] — the same edge, twice",
        basedOn: page.hash,
      }
    );
    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toMatchObject({ written: true });
    const after = await readFile(join(vault, path), "utf8");
    expect(after).toContain(
      "## Related questions\n\n- [[What counts as a reactivation event]] — shares 2 sources\n- [[Nowhere]]\n- [[What counts as a reactivation event]] — the same edge, twice\n\n## Open threads"
    );
    expect(outside(after, "Related questions")).toEqual(
      outside(before, "Related questions")
    );
    expect(reply.result?.data.hash).toBe(sha256(after));
    // Read back: the new line resolves, and says what Kind it lands on.
    const read = await c.query<ResearchQuestionPage>("researchQuestions.page", {
      path,
    });
    if (!read.result?.data.readable) throw new Error("unreadable");
    expect(read.result.data.sections.related.lines[2]).toEqual({
      text: "[[What counts as a reactivation event]] — the same edge, twice",
      link: {
        target: "What counts as a reactivation event",
        blockId: null,
        resolution: "resolved",
        resolvedPath: "questions/What counts as a reactivation event.md",
        resolvedKind: "question",
      },
      note: "the same edge, twice",
    });
  });

  it("saves ## Open threads with a line added, ticks kept, and no Revision recorded", async () => {
    const { vault, c, page } = await openedPage(
      { ...NEIGHBOURS, [path]: WELL_FORMED },
      path
    );
    if (!page.readable) throw new Error("unreadable");
    const before = await readFile(join(vault, path), "utf8");
    await c.mutate("researchQuestions.saveSection", {
      path,
      section: "Open threads",
      body:
        page.sections.openThreads.text +
        "\n- [ ] Does the effect survive a nap?",
      basedOn: page.hash,
    });
    const after = await readFile(join(vault, path), "utf8");
    expect(after).toContain(
      "- [x] Is TMR orthogonal to encoding?\n- a thread that is not a task\n- [ ] Does the effect survive a nap?\n\n## Position history\n\n- 2026-09-21T09:00:00+02:00 · working answer\n  from:\n"
    );
    expect(outside(after, "Open threads")).toEqual(
      outside(before, "Open threads")
    );
  });

  it("refuses a section that is not an Edited section as an input error", async () => {
    const { vault, c, page } = await openedPage(
      { ...NEIGHBOURS, [path]: WELL_FORMED },
      path
    );
    if (!page.readable) throw new Error("unreadable");
    const before = await readFile(join(vault, path), "utf8");
    const reply = await c.mutate("researchQuestions.saveSection", {
      path,
      section: "Position history",
      body: "",
      basedOn: page.hash,
    });
    expect(reply.error).toBeDefined();
    expect(await readFile(join(vault, path), "utf8")).toBe(before);
  });
});
