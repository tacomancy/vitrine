import { chmod, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { HypothesisPage } from "./hypothesis.js";
import type { Listing } from "./list.js";
import { closeCores, core, fingerprint, vaultWith } from "./test-core.js";

// Promote to Hypothesis from the Inbox (#331; spec #327 stories 1–6, 10–13;
// ADR 0031 decision 9): the claim typed on the row names the file, the page
// is written whole — Claim, Criteria, Design notes, Position history — and
// then the Question is marked, or the page is taken back.

afterEach(closeCores);

// `promoted` carries the local offset, so the clock is pinned to one zone.
beforeAll(() => {
  process.env["TZ"] = "Asia/Kolkata";
});
const at = new Date("2026-09-28T10:00:00+05:30");

const QUESTION = `---
id: k7m2p9q4wx
kind: question
question: "Does slow-wave density predict recall gain?"
status: open
captured: 2026-08-14T09:12:00+01:00
context: reading
from: "[[Rasch & Born 2013]]"
page: 699
annotation: h12
tags:
  - memory/consolidation
related:
  - "[[What counts as a reactivation event]]"
---

Some body the user wrote.
`;

const QUESTION_PATH = "questions/Does slow-wave density predict recall gain.md";
const CLAIM = "Slow-wave density during the nap predicts next-day recall gain.";
// The Question's rule, unchanged: it strips `?` but keeps a trailing `.`,
// so a claim written as a sentence names its file `….md` with two dots.
const HYPOTHESIS_PATH =
  "hypotheses/Slow-wave density during the nap predicts next-day recall gain..md";

/**
 * The page promotion writes: the Provenance copied as the Question holds it,
 * the tags, no `question:` and no related lines — and the claim's first
 * Revision, its `from:` empty because the claim did not exist before.
 */
const PAGE = `---
id: hy00000001
kind: hypothesis
promoted_from: "[[Does slow-wave density predict recall gain]]"
promoted: 2026-09-28T10:00:00+05:30
captured: 2026-08-14T09:12:00+01:00
context: reading
from: "[[Rasch & Born 2013]]"
page: 699
annotation: h12
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

/** The Question after: `status` in place, `promoted_to` appended, the body untouched. */
const PROMOTED = QUESTION.replace("status: open", "status: promoted").replace(
  "---\n\nSome body",
  'promoted_to: "[[Slow-wave density during the nap predicts next-day recall gain.]]"\n---\n\nSome body'
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
  c.mutate<{ path: string }>("questions.promoteToHypothesis", { path, claim });

describe("questions.promoteToHypothesis", () => {
  it("writes the Hypothesis whole, named from the claim, then marks the Question with its body byte-identical", async () => {
    const { vault, c } = await openedVault({ [QUESTION_PATH]: QUESTION });

    const reply = await promote(c, join(vault, QUESTION_PATH), CLAIM);

    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toEqual({ path: HYPOTHESIS_PATH });
    expect(await readFile(join(vault, HYPOTHESIS_PATH), "utf8")).toBe(PAGE);
    expect(await readFile(join(vault, QUESTION_PATH), "utf8")).toBe(PROMOTED);
  });

  it("trims the claim as typed, and names the file by the Question's rule with no suffix", async () => {
    const { vault, c } = await openedVault({ [QUESTION_PATH]: QUESTION });

    const reply = await promote(
      c,
      QUESTION_PATH,
      "  Density: predicts recall?  "
    );

    // `:` and `?` stripped from the name, never from the claim.
    const path = "hypotheses/Density predicts recall.md";
    expect(reply.result?.data).toEqual({ path });
    const written = await readFile(join(vault, path), "utf8");
    expect(written).toContain("## Claim\n\nDensity: predicts recall?\n\n##");
  });

  it("shows the Question as promoted, pointing at the Hypothesis, and the page reads at once", async () => {
    const { vault, c } = await openedVault({ [QUESTION_PATH]: QUESTION });
    await promote(c, QUESTION_PATH, CLAIM);

    // No wait on the watcher: the index was told of both writes.
    const listing = await c.query<Listing>("questions.list");
    expect(listing.result?.data.questions).toEqual([
      expect.objectContaining({
        path: join(vault, QUESTION_PATH),
        status: "promoted",
        promotedTo: {
          link: "[[Slow-wave density during the nap predicts next-day recall gain.]]",
          path: HYPOTHESIS_PATH,
          kind: "hypothesis",
        },
      }),
    ]);
    const page = await c.query<HypothesisPage>("hypotheses.page", {
      path: HYPOTHESIS_PATH,
    });
    expect(page.result?.data.readable).toBe(true);
    if (!page.result?.data.readable) return;
    expect(page.result.data.sections.claim.text).toBe(CLAIM);
    expect(page.result.data.derivation).toMatchObject({
      state: "inconclusive",
      clause: "noCriteria",
    });
    expect(page.result.data.sections.positionHistory.entries).toEqual([
      { at: "2026-09-28T10:00:00+05:30", field: "claim", why: null, from: "" },
    ]);
    expect(page.result.data.problems).toEqual([]);
  });

  it("refuses when a file already holds the name, and writes nothing", async () => {
    const { vault, c } = await openedVault({
      [QUESTION_PATH]: QUESTION,
      [HYPOTHESIS_PATH]: "---\nkind: note\n---\nA note that took the name.\n",
    });
    const before = await fingerprint(vault);

    const reply = await promote(c, QUESTION_PATH, CLAIM);

    expect(reply.error?.data.kind).toBe("refused");
    expect(reply.error?.message).toBe(
      `Couldn't write ${HYPOTHESIS_PATH}: a file by that name is already in the vault`
    );
    expect(await fingerprint(vault)).toEqual(before);
  });

  it("refuses an empty claim, and a Question that is not open, writing nothing", async () => {
    const answered = QUESTION.replace("status: open", "status: answered");
    const { vault, c } = await openedVault({
      [QUESTION_PATH]: QUESTION,
      "questions/Answered.md": answered,
    });
    const before = await fingerprint(vault);

    const blank = await promote(c, QUESTION_PATH, "   ");
    expect(blank.error?.data.kind).toBe("refused");
    expect(blank.error?.message).toMatch(/claim/);

    const closed = await promote(c, "questions/Answered.md", CLAIM);
    expect(closed.error?.data.kind).toBe("refused");
    expect(closed.error?.message).toMatch(/answered/);

    expect(await fingerprint(vault)).toEqual(before);
  });

  it("takes the Hypothesis back when the Question cannot be marked, and says why", async () => {
    const { vault, c } = await openedVault({ [QUESTION_PATH]: QUESTION });
    const before = await fingerprint(vault);
    // The Hypothesis lands in hypotheses/; the Question's write, in a
    // folder it cannot write, is the one that fails.
    await chmod(join(vault, "questions"), 0o555);
    try {
      const reply = await promote(c, QUESTION_PATH, CLAIM);
      expect(reply.error?.data.kind).toBe("writeFailed");
      expect(reply.error?.message).toMatch(
        /^Couldn't write questions\/Does slow-wave density predict recall gain\.md: EACCES/
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

  it("copies only what the Question has: no Provenance keys or tags beyond those present", async () => {
    const bare =
      '---\nid: k7m2p9q4wx\nkind: question\nquestion: "Bare"\nstatus: open\ncaptured: 2026-08-14T09:12:00+01:00\ncontext: other\n---\n';
    const { vault, c } = await openedVault({ "questions/Bare.md": bare });
    await promote(c, "questions/Bare.md", "Bare claim");
    expect(
      await readFile(join(vault, "hypotheses/Bare claim.md"), "utf8")
    ).toBe(
      `---
id: hy00000001
kind: hypothesis
promoted_from: "[[Bare]]"
promoted: 2026-09-28T10:00:00+05:30
captured: 2026-08-14T09:12:00+01:00
context: other
---

## Claim

Bare claim

## Criteria

## Design notes

## Position history

- 2026-09-28T10:00:00+05:30 · claim
  from:
`
    );
  });

  it("refuses when no vault is open", async () => {
    const c = await core();
    const reply = await c.mutate("questions.promoteToHypothesis", {
      path: "x.md",
      claim: CLAIM,
    });
    expect(reply.error?.data.kind).toBe("noVault");
  });
});
