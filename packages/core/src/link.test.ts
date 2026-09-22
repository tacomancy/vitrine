import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Linked } from "./link.js";
import type { Listing } from "./list.js";
import { closeCores, core, vaultWith } from "./test-core.js";

afterEach(closeCores);

// Link from the Inbox (#211; spec #206 story 4): one `setFrontmatter`
// through the protocol onto the selected Question's `related`, and only the
// linking side — the backlink is the index's (CONTEXT.md *Related*).

const QUESTION = `---
id: k7m2p9q4wx
kind: question
question: "Does slow-wave density predict recall gain?"
status: open
captured: 2026-08-14T09:12:00+01:00
context: other
---

Some body the user wrote.
`;

const QUESTION_PATH = "questions/Does slow-wave density predict recall gain.md";
const NOTE_PATH = "notes/Sleep and consolidation.md";

async function opened(files: Record<string, string> = {}) {
  const vault = await vaultWith({
    [QUESTION_PATH]: QUESTION,
    [NOTE_PATH]: "# Sleep and consolidation\n",
    ...files,
  });
  const c = await core();
  const reply = await c.mutate("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  return {
    vault,
    link: (input: { path: string; target: string }) =>
      c.mutate<Linked>("questions.link", input),
    list: async () => {
      const listed = await c.query<Listing>("questions.list");
      return listed.result?.data as Listing;
    },
    read: (path: string) => readFile(join(vault, path), "utf8"),
  };
}

describe("questions.link", () => {
  it("appends the target to `related` as a block sequence, keys in order, body untouched", async () => {
    const c = await opened();

    const reply = await c.link({ path: QUESTION_PATH, target: NOTE_PATH });

    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toEqual({
      path: QUESTION_PATH,
      target: "[[Sleep and consolidation]]",
      linked: true,
    });
    expect(await c.read(QUESTION_PATH)).toBe(
      QUESTION.replace(
        "context: other\n---",
        'context: other\nrelated:\n  - "[[Sleep and consolidation]]"\n---'
      )
    );
  });

  it("appends to a `related` the file already holds, and never twice to the same target", async () => {
    const c = await opened({
      [QUESTION_PATH]: QUESTION.replace(
        "context: other\n",
        'context: other\nrelated:\n  - "[[What counts as a reactivation event]]"\n'
      ),
      "questions/What counts as a reactivation event.md":
        "---\nkind: question\nquestion: q\ncaptured: 2026-01-01T00:00:00Z\n---\n",
    });

    const first = await c.link({ path: QUESTION_PATH, target: NOTE_PATH });
    expect(first.result?.data?.linked).toBe(true);
    const after = await c.read(QUESTION_PATH);
    expect(after).toContain(
      'related:\n  - "[[What counts as a reactivation event]]"\n  - "[[Sleep and consolidation]]"\n'
    );

    // The same file again, and the one that was already there: neither is
    // added twice, and neither touches the file.
    const again = await c.link({ path: QUESTION_PATH, target: NOTE_PATH });
    expect(again.result?.data).toEqual({
      path: QUESTION_PATH,
      target: "[[Sleep and consolidation]]",
      linked: false,
    });
    const already = await c.link({
      path: QUESTION_PATH,
      target: "questions/What counts as a reactivation event.md",
    });
    expect(already.result?.data?.linked).toBe(false);
    expect(await c.read(QUESTION_PATH)).toBe(after);
  });

  it("qualifies the link by path when the bare name would reach more than one file", async () => {
    const c = await opened({
      "a/Klinzing 2019.md": "---\nkind: source\n---\n",
      "b/Klinzing 2019.md": "---\nkind: source\n---\n",
    });

    const reply = await c.link({
      path: QUESTION_PATH,
      target: "b/Klinzing 2019.md",
    });

    expect(reply.result?.data?.target).toBe("[[b/Klinzing 2019]]");
    expect(await c.read(QUESTION_PATH)).toContain('- "[[b/Klinzing 2019]]"');
  });

  it("refuses a target that is not in the vault, and a Question linked to itself", async () => {
    const c = await opened();

    const gone = await c.link({ path: QUESTION_PATH, target: "notes/Gone.md" });
    expect(gone.error?.data.kind).toBe("refused");
    expect(gone.error?.message).toMatch(/notes\/Gone\.md/);

    const self = await c.link({ path: QUESTION_PATH, target: QUESTION_PATH });
    expect(self.error?.data.kind).toBe("refused");
    expect(self.error?.message).toMatch(/itself/i);

    expect(await c.read(QUESTION_PATH)).toBe(QUESTION);
  });

  it("refuses a file that is not a Question", async () => {
    const c = await opened();
    const reply = await c.link({ path: NOTE_PATH, target: QUESTION_PATH });
    expect(reply.error?.data.kind).toBe("refused");
    expect(reply.error?.message).toMatch(/not a Question/i);
  });

  it("refuses rather than dropping a `related` it cannot read as a list of links", async () => {
    const c = await opened({
      [QUESTION_PATH]: QUESTION.replace(
        "context: other\n",
        "context: other\nrelated:\n  how: a map\n"
      ),
    });

    const reply = await c.link({ path: QUESTION_PATH, target: NOTE_PATH });

    expect(reply.error?.data.kind).toBe("refused");
    expect(reply.error?.message).toMatch(/related/);
    expect(await c.read(QUESTION_PATH)).toContain("related:\n  how: a map\n");
  });

  it("takes a `related` the file holds as one scalar and keeps it", async () => {
    const c = await opened({
      [QUESTION_PATH]: QUESTION.replace(
        "context: other\n",
        'context: other\nrelated: "[[What counts as a reactivation event]]"\n'
      ),
    });

    const reply = await c.link({ path: QUESTION_PATH, target: NOTE_PATH });

    expect(reply.result?.data?.linked).toBe(true);
    expect(await c.read(QUESTION_PATH)).toContain(
      'related:\n  - "[[What counts as a reactivation event]]"\n  - "[[Sleep and consolidation]]"\n'
    );
  });

  it("tells the index at once, so the row re-reads without waiting for the watcher", async () => {
    const c = await opened();
    await c.link({ path: QUESTION_PATH, target: NOTE_PATH });
    // The Question is still one row, and still open: linking is not a
    // state change.
    const listing = await c.list();
    expect(listing.questions).toHaveLength(1);
    expect(listing.questions[0]?.status).toBe("open");
  });

  // The hazard #213 built the page's write queue for, on the Question:
  // both links read `related` before either wrote, so the second write
  // re-applies an operation that was correct when it was computed and is
  // not any more, and the first link is gone. The protocol's hash check
  // cannot catch that; only running them one at a time can. The queue is
  // `linkQuestion`'s own, not the service's, so this holds for any caller
  // — nothing outside `link.ts` has to remember to hold it.
  it("keeps both links when two arrive at once", async () => {
    const c = await opened({
      "notes/Reactivation.md": "# Reactivation\n",
    });

    const [first, second] = await Promise.all([
      c.link({ path: QUESTION_PATH, target: NOTE_PATH }),
      c.link({ path: QUESTION_PATH, target: "notes/Reactivation.md" }),
    ]);

    expect(first.error).toBeUndefined();
    expect(second.error).toBeUndefined();
    const after = await c.read(QUESTION_PATH);
    expect(after).toContain('- "[[Sleep and consolidation]]"');
    expect(after).toContain('- "[[Reactivation]]"');
  });

  it("refuses when no vault is open", async () => {
    const c = await core();
    const reply = await c.mutate<Linked>("questions.link", {
      path: QUESTION_PATH,
      target: NOTE_PATH,
    });
    expect(reply.error?.message).toMatch(/no vault/i);
  });
});
