import { readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Destinations } from "./destinations.js";
import type { HypothesisPage } from "./hypothesis.js";
import type { Listing } from "./list.js";
import type { ResearchQuestionPage } from "./research-question.js";
import { closeCores, core, vaultWith, type CoreOptions } from "./test-core.js";

// A Hypothesis is named by its current claim (#340; spec #327 stories 77,
// 78; `docs/architecture.md` § Hypothesis view, Address and name). The
// file is named once, from the claim as typed, and never renamed; what is
// on screen is what it claims now — in the Global command, on the Inbox
// row it was promoted from, and on the Research Question it sharpened.

afterEach(closeCores);

const TYPED = "Slow-wave density predicts recall gain.";
const PATH = `hypotheses/${TYPED}.md`;
const REVISED =
  "Spindle-coupled slow waves, not density alone, predict next-day recall gain.";

const hypothesis = (claim: string | null) =>
  `---
id: hy00000001
kind: hypothesis
promoted_from: "[[Does slow-wave density predict recall gain]]"
promoted: 2026-09-28T10:00:00+02:00
context: reading
---
${claim === null ? "" : `\n## Claim\n\n${claim}\n`}
## Criteria

## Design notes

## Position history

- 2026-09-28T10:00:00+02:00 · claim
  from:
`;

const QUESTION = `---
id: q000000001
kind: question
question: "Does slow-wave density predict recall gain?"
status: promoted
captured: 2026-09-20T09:00:00+02:00
context: reading
promoted_to: "[[${TYPED}]]"
---
`;

const RESEARCH_QUESTION = `---
id: rq00000001
kind: research-question
question: "What does sleep do for memory?"
status: open
promoted: 2026-09-20T10:00:00+02:00
context: reading
---

## Working answer

## Supporting sources

## Opposing sources

## Related questions

- [[${TYPED}]] — sharpened into a hypothesis, 2026-09-28

## Open threads

## Position history
`;

async function opened(
  files: Record<string, string> = {
    [PATH]: hypothesis(TYPED),
    "Does slow-wave density predict recall gain.md": QUESTION,
    "questions/What does sleep do for memory.md": RESEARCH_QUESTION,
  },
  opts: CoreOptions = {}
) {
  const vault = await vaultWith(files);
  const c = await core(opts);
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const data = async <T>(
    reply: Promise<{ result?: { data: unknown }; error?: unknown }>
  ) => {
    const r = await reply;
    expect(r.error).toBeUndefined();
    return r.result?.data as T;
  };
  return {
    vault,
    c,
    /** Every Hypothesis row the Global command shows for `query`, as `<path> <display>`. */
    found: async (query: string) =>
      (
        await data<Destinations>(
          c.query("globalCommand.destinations", { query })
        )
      ).rows
        .filter((r) => r.kind === "hypothesis")
        .map((r) => `${r.path} ${r.display}`),
    /** What the promoted Question's row points at. */
    pointer: async () =>
      (await data<Listing>(c.query("questions.list"))).questions[0]?.promotedTo,
    /** The Research Question's sharpened line, as the page reads it. */
    sharpened: async () => {
      const page = await data<ResearchQuestionPage>(
        c.query("researchQuestions.page", {
          path: "questions/What does sleep do for memory.md",
        })
      );
      if (!page.readable) throw new Error(page.reason);
      return page.sections.related.lines[0]?.link;
    },
    revise: async (claim: string) => {
      const page = await data<HypothesisPage>(
        c.query("hypotheses.page", { path: PATH })
      );
      if (!page.readable) throw new Error(page.reason);
      const saved = await data<{ written: boolean }>(
        c.mutate("hypotheses.savePosition", {
          path: PATH,
          field: "claim",
          text: claim,
          basedOn: page.hash,
          was: page.sections.claim.text,
        })
      );
      expect(saved.written).toBe(true);
    },
  };
}

describe("a Hypothesis's Display name", () => {
  it("is its claim, and the Global command finds it by a word only the claim holds", async () => {
    const h = await opened({ [PATH]: hypothesis(REVISED) });
    // `spindle` is nowhere in the file name, which was cut from the claim
    // as first typed.
    expect(await h.found("spindle")).toEqual([`${PATH} ${REVISED}`]);
  });

  it("is the file name when the file holds no claim to read", async () => {
    const h = await opened({ [PATH]: hypothesis(null) });
    expect(await h.found("slow wave")).toEqual([`${PATH} ${TYPED}`]);
  });

  it("is the file name when the claim is empty, never a blank row", async () => {
    const h = await opened({ [PATH]: hypothesis("") });
    expect(await h.found("")).toEqual([`${PATH} ${TYPED}`]);
  });

  it("follows a revised claim, and revising it never renames the file", async () => {
    const h = await opened();
    await h.revise(REVISED);

    expect(await h.found("spindle")).toEqual([`${PATH} ${REVISED}`]);
    // The claim as first typed is no longer what it is called.
    expect(await h.found("slow wave density predicts")).toEqual([]);
    expect(await readdir(join(h.vault, "hypotheses"))).toEqual([`${TYPED}.md`]);
  });

  it("names the Hypothesis by its current claim on the Inbox row it was promoted from", async () => {
    const h = await opened();
    expect(await h.pointer()).toMatchObject({ path: PATH, display: TYPED });

    await h.revise(REVISED);
    expect(await h.pointer()).toMatchObject({
      path: PATH,
      kind: "hypothesis",
      display: REVISED,
    });
  });

  it("names the Hypothesis by its current claim on the Research Question it sharpened", async () => {
    const h = await opened();
    await h.revise(REVISED);
    expect(await h.sharpened()).toMatchObject({
      resolvedPath: PATH,
      resolvedKind: "hypothesis",
      resolvedDisplay: REVISED,
    });
  });

  it("keeps the claim as its name when the file is renamed", async () => {
    // A rename moves the `files` row rather than re-outlining the file
    // (#189), so the name is recomputed from the rows the index holds —
    // which must include the claim, or a moved Hypothesis would be called
    // by its new file name.
    const h = await opened({ [PATH]: hypothesis(REVISED) }, { settleMs: 200 });
    const stream = await h.c.events();
    await rename(join(h.vault, PATH), join(h.vault, "hypotheses/Moved.md"));
    expect((await stream.next("vaultChanged")).renamed).toHaveLength(1);

    expect(await h.found("spindle")).toEqual([
      `hypotheses/Moved.md ${REVISED}`,
    ]);
    stream.close();
  });

  it("follows a claim revised in Obsidian, on every surface that names it", async () => {
    // The watcher's path, not the app's own write: the file changes on
    // disk and the index re-reads it, so the name must come from that
    // re-read rather than from anything the page's save did.
    const h = await opened(undefined, { settleMs: 40 });
    const stream = await h.c.events();
    await writeFile(join(h.vault, PATH), hypothesis(REVISED));
    await stream.next("vaultChanged");

    expect(await h.found("spindle")).toEqual([`${PATH} ${REVISED}`]);
    expect(await h.pointer()).toMatchObject({ display: REVISED });
    expect(await h.sharpened()).toMatchObject({ resolvedDisplay: REVISED });
    expect(await readdir(join(h.vault, "hypotheses"))).toEqual([`${TYPED}.md`]);
    stream.close();
  });
});
