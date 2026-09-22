import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Listing } from "./list.js";
import type { ResearchQuestionPage } from "./research-question.js";
import { closeCores, core, fingerprint, vaultWith } from "./test-core.js";

afterEach(closeCores);

// `promoted` carries the local offset, so the clock is pinned to one zone.
beforeAll(() => {
  process.env["TZ"] = "Asia/Kolkata";
});
const at = new Date("2026-09-21T10:00:00+05:30");

const QUESTION = `---
id: k7m2p9q4wx
kind: question
question: "Does slow-wave density predict recall gain?"
status: open
captured: 2026-08-14T09:12:00+01:00
context: reading
from: "[[Rasch & Born 2013]]"
page: 699
tags:
  - memory/consolidation
related:
  - "[[What counts as a reactivation event]]"
---

Some body the user wrote.
`;

const QUESTION_PATH = "questions/Does slow-wave density predict recall gain.md";
const PAGE_PATH =
  "questions/Does slow-wave density predict recall gain (RQ).md";

/** The page promotion writes: the Question's keys copied, the six headings, `related:` as lines. */
const PAGE = `---
id: rq00000001
kind: research-question
question: "Does slow-wave density predict recall gain?"
status: open
promoted_from: "[[Does slow-wave density predict recall gain]]"
promoted: 2026-09-21T10:00:00+05:30
captured: 2026-08-14T09:12:00+01:00
context: reading
from: "[[Rasch & Born 2013]]"
page: 699
tags:
  - memory/consolidation
---

## Working answer

## Supporting sources

## Opposing sources

## Related questions

- [[What counts as a reactivation event]]

## Open threads

## Position history
`;

/** The Question after: `status` in place, `promoted_to` appended, the body untouched. */
const PROMOTED = QUESTION.replace("status: open", "status: promoted").replace(
  "---\n\nSome body",
  'promoted_to: "[[Does slow-wave density predict recall gain (RQ)]]"\n---\n\nSome body'
);

async function openedVault(files: Record<string, string>) {
  const vault = await vaultWith(files);
  const c = await core({ now: () => at, newId: () => "rq00000001" });
  const opened = await c.mutate("vault.open", { path: vault });
  expect(opened.error).toBeUndefined();
  await c.indexed();
  return { vault, c };
}

describe("questions.promote", () => {
  it("writes the (RQ) file whole, then marks the Question promoted with the body byte-identical", async () => {
    const { vault, c } = await openedVault({ [QUESTION_PATH]: QUESTION });

    const reply = await c.mutate<{ path: string }>("questions.promote", {
      path: join(vault, QUESTION_PATH),
    });

    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toEqual({ path: PAGE_PATH });
    expect(await readFile(join(vault, PAGE_PATH), "utf8")).toBe(PAGE);
    expect(await readFile(join(vault, QUESTION_PATH), "utf8")).toBe(PROMOTED);
  });

  it("shows the Question as promoted in questions.list, pointing at its page, and the page reads at once", async () => {
    const { vault, c } = await openedVault({ [QUESTION_PATH]: QUESTION });
    await c.mutate("questions.promote", { path: QUESTION_PATH });

    // No wait on the watcher: the index was told of both writes.
    const listing = await c.query<Listing>("questions.list");
    expect(listing.result?.data.questions).toEqual([
      expect.objectContaining({
        path: join(vault, QUESTION_PATH),
        status: "promoted",
        promotedTo: {
          link: "[[Does slow-wave density predict recall gain (RQ)]]",
          path: PAGE_PATH,
        },
      }),
    ]);
    const page = await c.query<ResearchQuestionPage>("researchQuestions.page", {
      path: PAGE_PATH,
    });
    expect(page.result?.data.readable).toBe(true);
    if (!page.result?.data.readable) return;
    expect(page.result.data.frontmatter.promotedFrom).toBe(
      "[[Does slow-wave density predict recall gain]]"
    );
    const [related] = page.result.data.sections.related.lines;
    expect(related?.link?.target).toBe("What counts as a reactivation event");
    expect(related?.link?.resolution).toBe("unresolved");
    expect(page.result.data.problems).toEqual([]);
  });

  it("leaves the Question untouched when the page cannot be created (folder unwritable), typed writeFailed", async () => {
    const { vault, c } = await openedVault({ [QUESTION_PATH]: QUESTION });
    const before = await fingerprint(vault);
    await chmod(join(vault, "questions"), 0o555);
    try {
      const reply = await c.mutate("questions.promote", {
        path: QUESTION_PATH,
      });
      expect(reply.error?.data.kind).toBe("writeFailed");
      expect(reply.error?.message).toMatch(/Couldn't write/);
      expect(await fingerprint(vault)).toEqual(before);
    } finally {
      await chmod(join(vault, "questions"), 0o755);
    }
  });

  it("takes the next free (RQ) name when the plain one is already there", async () => {
    const { vault, c } = await openedVault({
      [QUESTION_PATH]: QUESTION,
      [PAGE_PATH]: "---\nkind: note\n---\nA note that took the name.\n",
    });
    const reply = await c.mutate<{ path: string }>("questions.promote", {
      path: QUESTION_PATH,
    });
    const taken =
      "questions/Does slow-wave density predict recall gain (RQ) (2).md";
    expect(reply.result?.data).toEqual({ path: taken });
    expect(await readFile(join(vault, taken), "utf8")).toContain(
      "kind: research-question"
    );
    expect(await readFile(join(vault, QUESTION_PATH), "utf8")).toContain(
      'promoted_to: "[[Does slow-wave density predict recall gain (RQ) (2)]]"'
    );
  });

  it("refuses a Question that is not open, typed refused, and writes nothing", async () => {
    const answered = QUESTION.replace("status: open", "status: answered");
    const { vault, c } = await openedVault({ [QUESTION_PATH]: answered });
    const before = await fingerprint(vault);
    const reply = await c.mutate("questions.promote", { path: QUESTION_PATH });
    expect(reply.error?.data.kind).toBe("refused");
    expect(reply.error?.message).toMatch(/answered/);
    expect(await fingerprint(vault)).toEqual(before);
  });

  it("copies only what the Question has: no tags or related keys means no tags key and an empty section", async () => {
    const bare =
      '---\nid: k7m2p9q4wx\nkind: question\nquestion: "Bare"\nstatus: open\ncaptured: 2026-08-14T09:12:00+01:00\ncontext: other\n---\n';
    const { vault, c } = await openedVault({ "questions/Bare.md": bare });
    await c.mutate("questions.promote", { path: "questions/Bare.md" });
    expect(await readFile(join(vault, "questions/Bare (RQ).md"), "utf8")).toBe(
      `---
id: rq00000001
kind: research-question
question: "Bare"
status: open
promoted_from: "[[Bare]]"
promoted: 2026-09-21T10:00:00+05:30
captured: 2026-08-14T09:12:00+01:00
context: other
---

## Working answer

## Supporting sources

## Opposing sources

## Related questions

## Open threads

## Position history
`
    );
  });

  it("refuses a file that is not a Question, and one that is not in the vault", async () => {
    const { c } = await openedVault({
      "notes/Plain.md": "---\nkind: note\n---\n",
    });
    const note = await c.mutate("questions.promote", {
      path: "notes/Plain.md",
    });
    expect(note.error?.data.kind).toBe("refused");
    expect(note.error?.message).toMatch(/not a Question/);
    const outside = await c.mutate("questions.promote", {
      path: "../Elsewhere.md",
    });
    expect(outside.error?.data.kind).toBe("outsideVault");
  });

  it("refuses when no vault is open", async () => {
    const c = await core();
    const reply = await c.mutate("questions.promote", { path: "x.md" });
    expect(reply.error?.data.kind).toBe("noVault");
  });
});

// A Question another tool wrote may carry `tags:` as the legacy comma string;
// the copy is a block sequence, split as § Markdown reads the legacy form.
describe("promotion copies tags as a block sequence", () => {
  it("splits a legacy comma-separated tags string", async () => {
    const legacy =
      '---\nkind: question\nquestion: "Legacy"\nstatus: open\ncaptured: 2026-08-14T09:12:00+01:00\ntags: alpha, beta/gamma\n---\n';
    const { vault, c } = await openedVault({ "questions/Legacy.md": legacy });
    await c.mutate("questions.promote", { path: "questions/Legacy.md" });
    const page = await readFile(
      join(vault, "questions/Legacy (RQ).md"),
      "utf8"
    );
    expect(page).toContain("tags:\n  - alpha\n  - beta/gamma\n---");
  });
});
