import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HypothesisPage } from "./hypothesis.js";
import { closeCores, core, vaultWith, type CoreOptions } from "./test-core.js";
import { localIso } from "./time.js";

// Criterion edits made in Obsidian (#336; spec #327 stories 51, 52, 86, 87;
// ADR 0031 decisions 4–6). The guard must not depend on which tool was used:
// when the Revisions an Obsidian edit parked are spliced, the same write adds
// the edited-after-evidence suffix, the loud *deleted after evidence* entry,
// and a `· state` entry when the derived state moved — judged by the core
// against the file's previous text. Obsidian's edits are plain `fs` writes;
// every wait is on the index or the event stream, never a timer, and the
// splice is fired by the app's next write or by vault close.

afterEach(closeCores);

type Vault = { name: string; path: string };
type Readable = Extract<HypothesisPage, { readable: true }>;

const PATH = "hypotheses/Slow-wave density predicts recall gain.md";
const CLAIM = "Slow-wave density during the nap predicts next-day recall gain.";
const PROMOTED = "2026-09-28T10:00:00+02:00";

const FRONTMATTER = `---
id: hy4k8m2p9q
kind: hypothesis
promoted_from: "[[Does slow-wave density predict recall gain]]"
promoted: ${PROMOTED}
context: reading
---
`;

const C1 = "### Recall gain tracks density across the sample ^c1";
const C1_BLOCK = `${C1}\n\nrelationship:: confirming`;
const F2 = "### No gain when density is shuffled across subjects ^c2";
const F2_BLOCK = `${F2}\n\nrelationship:: falsifying`;
const EVIDENCE = "- [[sweep-14]] — gain holds at every density bin";

/** A Hypothesis with `criteria` under `## Criteria` and `history` under `## Position history`. */
const file = (criteria: string, history = `- ${PROMOTED} · claim\n  from:\n`) =>
  `${FRONTMATTER}
## Claim

${CLAIM}

## Criteria
${criteria === "" ? "" : `\n${criteria}\n`}
## Design notes

## Position history

${history}`;

const minute = 60_000;
const t0 = new Date("2026-09-29T10:00:00+02:00");
const at = (offsetMinutes: number) =>
  new Date(t0.getTime() + offsetMinutes * minute);

/** The entry a splice writes, its previous text indented. */
const entry = (when: Date | string, field: string, from: string) =>
  `- ${typeof when === "string" ? when : localIso(when)} · ${field}\n  from:` +
  (from === "" ? "" : "\n" + from.replace(/^(?!$)/gm, "    "));

const PROMOTION = entry(PROMOTED, "claim", "");
const history = (...entries: string[]) => entries.join("\n") + "\n";

async function opened(criteria: string, opts: CoreOptions = {}) {
  const vault = await vaultWith({ [PATH]: file(criteria) });
  let now = t0;
  const c = await core({
    coalesceMs: 30 * minute,
    settleMs: 40,
    now: () => now,
    ...opts,
  });
  expect(
    (await c.mutate<Vault>("vault.open", { path: vault })).error
  ).toBeUndefined();
  await c.indexed();
  const stream = await c.events();
  const bytes = () => readFile(join(vault, PATH), "utf8");
  const page = async (): Promise<Readable> => {
    const reply = await c.query<HypothesisPage>("hypotheses.page", {
      path: PATH,
    });
    expect(reply.error).toBeUndefined();
    const data = reply.result?.data as HypothesisPage;
    if (!data.readable) throw new Error(data.reason);
    return data;
  };
  return {
    vault,
    c,
    bytes,
    page,
    setNow: (d: Date) => {
      now = d;
    },
    /** Obsidian's edit: the file written whole with `## Criteria` as given, awaited as far as the index. */
    obsidian: async (criteria: string) => {
      const before = await bytes();
      const from = before.indexOf("## Criteria\n");
      const to = before.indexOf("## Design notes\n");
      await writeFile(
        join(vault, PATH),
        before.slice(0, from) +
          "## Criteria\n" +
          (criteria === "" ? "" : `\n${criteria}\n`) +
          "\n" +
          before.slice(to)
      );
      await stream.next("vaultChanged");
      await c.indexed();
    },
  };
}

describe("a criterion edited in Obsidian, spliced", () => {
  it("an outcome flipped on disk yields the criterion's Revision and a · state entry above it, stamped alike", async () => {
    const { obsidian, setNow, c, bytes } = await opened(
      `${C1_BLOCK}\n\n${F2_BLOCK}`
    );

    setNow(at(5));
    await obsidian(`${C1_BLOCK}\n\n${F2_BLOCK}\noutcome:: met`);
    // Parked, not written, until the file is quiet or the app writes it.
    expect(await bytes()).not.toContain(localIso(at(5)));
    await c.close();

    expect(await bytes()).toBe(
      file(
        `${C1_BLOCK}\n\n${F2_BLOCK}\noutcome:: met`,
        history(
          entry(at(5), "state", "inconclusive"),
          entry(at(5), "criterion F2", F2_BLOCK),
          PROMOTION
        )
      )
    );
  });

  it("an edit that does not move the state writes no · state entry", async () => {
    const { obsidian, setNow, c, bytes } = await opened(C1_BLOCK);

    setNow(at(5));
    await obsidian(C1_BLOCK.replace("the sample", "every subject"));
    await c.close();

    expect(await bytes()).toBe(
      file(
        C1_BLOCK.replace("the sample", "every subject"),
        history(entry(at(5), "criterion C1", C1_BLOCK), PROMOTION)
      )
    );
  });

  it("a criterion with evidence reworded on disk carries the suffix, and the page marks it with its old wording", async () => {
    const tested = `${C1_BLOCK}\n\n${EVIDENCE}`;
    const reworded = tested.replace("across the sample", "in the top tercile");
    const { obsidian, setNow, c, bytes, vault } = await opened(tested);

    setNow(at(5));
    await obsidian(reworded);
    await c.close();

    expect(await bytes()).toBe(
      file(
        reworded,
        history(
          entry(at(5), "criterion C1 · edited after evidence", tested),
          PROMOTION
        )
      )
    );

    // Read back by a fresh session: the mark lives in the file alone.
    const again = await core();
    expect(
      (await again.mutate<Vault>("vault.open", { path: vault })).error
    ).toBeUndefined();
    await again.indexed();
    const reply = await again.query<HypothesisPage>("hypotheses.page", {
      path: PATH,
    });
    const read = reply.result?.data as Readable;
    expect(read.sections.criteria.criteria[0]?.editedAfterEvidence).toEqual([
      {
        at: localIso(at(5)),
        why: null,
        was: {
          text: "Recall gain tracks density across the sample",
          relationship: "confirming",
        },
      },
    ]);
  });

  it("a relationship changed on disk while evidence is under it is marked, under the label as it stood", async () => {
    const tested = `${C1_BLOCK}\n\n${EVIDENCE}`;
    const diagnostic = tested.replace("confirming", "diagnostic");
    const { obsidian, setNow, c, bytes } = await opened(tested);

    setNow(at(5));
    await obsidian(diagnostic);
    await c.close();

    expect(await bytes()).toBe(
      file(
        diagnostic,
        history(
          entry(at(5), "criterion C1 · edited after evidence", tested),
          PROMOTION
        )
      )
    );
  });

  it("a criterion with evidence deleted on disk yields the loud entry naming it", async () => {
    const tested = `${F2_BLOCK}\n\n${EVIDENCE}`;
    const { obsidian, setNow, c, bytes } = await opened(
      `${C1_BLOCK}\n\n${tested}`
    );

    setNow(at(5));
    await obsidian(C1_BLOCK);
    await c.close();

    expect(await bytes()).toBe(
      file(
        C1_BLOCK,
        history(
          entry(at(5), "criterion F2 · deleted after evidence", tested),
          PROMOTION
        )
      )
    );
  });

  it("a draft deleted on disk is a quiet Revision, and one added on disk is its first, from empty", async () => {
    const { obsidian, setNow, c, bytes } = await opened(
      `${C1_BLOCK}\n\n${F2_BLOCK}`
    );
    const C3_BLOCK =
      "### Gain survives a second night ^c3\n\nrelationship:: confirming";

    setNow(at(5));
    await obsidian(`${C1_BLOCK}\n\n${C3_BLOCK}`);
    await c.close();

    expect(await bytes()).toBe(
      file(
        `${C1_BLOCK}\n\n${C3_BLOCK}`,
        history(
          entry(at(5), "criterion C3", ""),
          entry(at(5), "criterion F2", F2_BLOCK),
          PROMOTION
        )
      )
    );
  });

  it("a run named and the wording changed to fit it inside one window is marked, though the window's first end had no evidence", async () => {
    const { obsidian, setNow, c, bytes } = await opened(C1_BLOCK);
    const tested = `${C1_BLOCK}\n\n${EVIDENCE}`;
    const reworded = tested.replace("across the sample", "in the top tercile");

    setNow(at(5));
    await obsidian(tested);
    setNow(at(12));
    await obsidian(reworded);
    await c.close();

    expect(await bytes()).toBe(
      file(
        reworded,
        history(
          entry(at(12), "criterion C1 · edited after evidence", C1_BLOCK),
          PROMOTION
        )
      )
    );
  });

  it("two parked Revisions a window apart are each judged against the section as the other left it", async () => {
    const { obsidian, setNow, c, bytes } = await opened(
      `${C1_BLOCK}\n\n${F2_BLOCK}`
    );
    const flipped = `${C1_BLOCK}\n\n${F2_BLOCK}\noutcome:: met`;
    const reworded = flipped.replace("the sample", "every subject");

    setNow(at(5));
    await obsidian(flipped);
    setNow(at(45));
    await obsidian(reworded);
    await c.close();

    expect(await bytes()).toBe(
      file(
        reworded,
        history(
          entry(at(45), "criterion C1", C1_BLOCK),
          entry(at(5), "state", "inconclusive"),
          entry(at(5), "criterion F2", F2_BLOCK),
          PROMOTION
        )
      )
    );
  });

  it("with ## Criteria's heading gone when the splice lands, the row is spliced unjudged rather than as every criterion deleted", async () => {
    const tested = `${F2_BLOCK}\n\n${EVIDENCE}`;
    const { obsidian, setNow, c, bytes, vault } = await opened(tested);

    setNow(at(5));
    await obsidian(tested.replace("shuffled", "permuted"));
    // Then the heading retyped mid-edit, and the vault closed before it came back.
    const retyped = (await bytes()).replace("## Criteria\n", "## Criteri\n");
    await writeFile(join(vault, PATH), retyped);
    await c.indexed();
    await c.close();

    const written = await bytes();
    expect(written).not.toContain("deleted after evidence");
    expect(written).toContain(entry(at(5), "criteria", tested));
  });

  it("is judged by the app's next write too, whose own entry lands above the splice's", async () => {
    const { obsidian, setNow, c, bytes, page } = await opened(
      `${C1_BLOCK}\n\n${F2_BLOCK}`
    );

    setNow(at(5));
    await obsidian(`${C1_BLOCK}\n\n${F2_BLOCK}\noutcome:: met`);
    setNow(at(8));
    const reply = await c.mutate<{ written: boolean }>(
      "hypotheses.setCriterionField",
      {
        path: PATH,
        basedOn: (await page()).hash,
        id: "c1",
        field: "outcome",
        value: "met",
      }
    );
    expect(reply.error).toBeUndefined();
    expect(reply.result?.data.written).toBe(true);

    expect(await bytes()).toBe(
      file(
        `${C1_BLOCK}\noutcome:: met\n\n${F2_BLOCK}\noutcome:: met`,
        history(
          entry(at(8), "criterion C1", C1_BLOCK),
          entry(at(5), "state", "inconclusive"),
          entry(at(5), "criterion F2", F2_BLOCK),
          PROMOTION
        )
      )
    );
  });
});
