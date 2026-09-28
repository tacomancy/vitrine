import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HypothesisPage } from "./hypothesis.js";
import { closeCores, core, vaultWith, type CoreOptions } from "./test-core.js";
import { localIso } from "./time.js";

// The Override and its void (#337; spec #327 stories 56–63; ADR 0031
// decision 7; TEST-6). An Override is a history entry `· override` with a
// required why and `from: inconclusive`; the core refuses one without a why,
// on a state that is not inconclusive, with no Outcome recorded, or over one
// already live. Anything it judged voids it — a criterion Revision, a
// criterion added or deleted, a claim Revision, never design notes — as
// `· override voided`, `from:` the Override's timestamp, in the same write,
// including the watcher's splice of an Obsidian edit. Asserted on the reply,
// the page read, and the bytes on disk.

afterEach(closeCores);

type Vault = { name: string; path: string };
type Readable = Extract<HypothesisPage, { readable: true }>;
type Written =
  | { written: true; hash: string; revision: string | null }
  | { written: false; reason: string; detail: string };

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

const C1_BLOCK =
  "### Recall gain tracks density across the sample ^c1\n\nrelationship:: confirming";
const MET = `${C1_BLOCK}\noutcome:: met`;
const F2_BLOCK =
  "### No gain when density is shuffled across subjects ^c2\n\nrelationship:: falsifying";
/** One confirming criterion met, a falsifying one awaiting evidence: inconclusive, with an Outcome to be partial about. */
const PARTIAL = `${MET}\n\n${F2_BLOCK}`;

const file = (
  criteria: string,
  history = `- ${PROMOTED} · claim\n  from:\n`,
  notes = ""
) =>
  `${FRONTMATTER}
## Claim

${CLAIM}

## Criteria
${criteria === "" ? "" : `\n${criteria}\n`}
## Design notes
${notes === "" ? "" : `\n${notes}\n`}
## Position history

${history}`;

const minute = 60_000;
const t0 = new Date("2026-09-29T10:00:00+02:00");
const at = (offsetMinutes: number) =>
  new Date(t0.getTime() + offsetMinutes * minute);

const entry = (
  when: Date | string,
  field: string,
  from: string,
  why?: string
) =>
  `- ${typeof when === "string" ? when : localIso(when)} · ${field}\n` +
  (why === undefined ? "" : `  why: ${why}\n`) +
  "  from:" +
  (from === "" ? "" : "\n" + from.replace(/^(?!$)/gm, "    "));

const PROMOTION = entry(PROMOTED, "claim", "");
const history = (...entries: string[]) => entries.join("\n") + "\n";

const WHY = "F2 cannot be run on this sample; [[sweep-14]] carries the claim";
const OVERRIDE = entry(t0, "override", "inconclusive", WHY);
const voided = (when: Date) => entry(when, "override voided", localIso(t0));

async function opened(
  criteria: string,
  historyText?: string,
  opts: CoreOptions = {}
) {
  const vault = await vaultWith({ [PATH]: file(criteria, historyText) });
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
  const call = async (procedure: string, input: Record<string, unknown>) =>
    c.mutate<Written>(`hypotheses.${procedure}`, {
      path: PATH,
      basedOn: (await page()).hash,
      ...input,
    });
  const wrote = async (procedure: string, input: Record<string, unknown>) => {
    const reply = await call(procedure, input);
    expect(reply.error).toBeUndefined();
    const data = reply.result?.data as Written;
    expect(data.written).toBe(true);
    return data;
  };
  return {
    vault,
    c,
    page,
    call,
    wrote,
    bytes,
    setNow: (d: Date) => {
      now = d;
    },
    /** Obsidian's edit: one `## <section>` body swapped, the file written whole, awaited as far as the index. */
    obsidian: async (name: string, body: string) => {
      const before = await bytes();
      const from = before.indexOf(`## ${name}\n`);
      const to = before.indexOf("\n## ", from + 1) + 1;
      await writeFile(
        join(vault, PATH),
        before.slice(0, from) + `## ${name}\n\n${body}\n\n` + before.slice(to)
      );
      await stream.next("vaultChanged");
      await c.indexed();
    },
  };
}

/** A Hypothesis whose Override was already recorded at t0. */
const overridden = (criteria = PARTIAL, opts: CoreOptions = {}) =>
  opened(criteria, history(OVERRIDE, PROMOTION), opts);

describe("hypotheses.override", () => {
  it("records the Override as its own entry, with its why and from: inconclusive, and the page reads supported over the derived state", async () => {
    const { wrote, bytes, page } = await opened(PARTIAL);

    const reply = await wrote("override", { why: WHY });
    expect(reply).toMatchObject({ written: true, revision: localIso(t0) });
    expect(await bytes()).toBe(file(PARTIAL, history(OVERRIDE, PROMOTION)));

    const read = await page();
    expect(read.derivation.state).toBe("inconclusive");
    expect(read.derivation.clause).toBe("awaitingEvidence");
    expect(read.derivation.effective).toBe("supported");
    expect(read.derivation.override).toEqual({ at: localIso(t0), why: WHY });
    // What the Override overruled: F2, still awaiting evidence.
    expect(read.derivation.unlanded).toEqual(["F2"]);
    expect(read.overridable).toBe(false);
  });

  it("is offered on an inconclusive page with an Outcome recorded, and on no other", async () => {
    expect((await (await opened(PARTIAL)).page()).overridable).toBe(true);
    expect((await (await opened(F2_BLOCK)).page()).overridable).toBe(false);
  });

  it("refuses without a why, and writes nothing", async () => {
    const { call, bytes } = await opened(PARTIAL);
    for (const why of ["", "   \n "]) {
      const reply = await call("override", { why });
      expect(reply.error?.message).toMatch(/needs a why/);
    }
    expect(await bytes()).toBe(file(PARTIAL));
  });

  it("refuses when the derived state is not inconclusive — there is no override to falsified, nor of a result", async () => {
    const falsified = `${MET}\n\n${F2_BLOCK}\noutcome:: met`;
    const supported = `${MET}\n\n${F2_BLOCK}\noutcome:: not met`;
    for (const criteria of [falsified, supported]) {
      const { call, bytes } = await opened(criteria);
      const reply = await call("override", { why: WHY });
      expect(reply.error?.message).toMatch(/only an inconclusive/);
      expect(await bytes()).toBe(file(criteria));
    }
  });

  it("refuses while no criterion carries an Outcome — there is nothing to be partial about", async () => {
    const { call, bytes } = await opened(`${C1_BLOCK}\n\n${F2_BLOCK}`);
    const reply = await call("override", { why: WHY });
    expect(reply.error?.message).toMatch(/no criterion carries an outcome/i);
    expect(await bytes()).toBe(file(`${C1_BLOCK}\n\n${F2_BLOCK}`));
  });

  it("refuses when one is already live", async () => {
    const { call, bytes, setNow } = await overridden();
    setNow(at(5));
    const reply = await call("override", { why: "a second opinion" });
    expect(reply.error?.message).toMatch(/already live/);
    expect(await bytes()).toBe(file(PARTIAL, history(OVERRIDE, PROMOTION)));
  });

  it("takes a fresh why once the last one was voided", async () => {
    const { wrote, bytes, setNow } = await opened(
      PARTIAL,
      history(voided(at(1)), OVERRIDE, PROMOTION)
    );
    setNow(at(5));
    await wrote("override", { why: "still supported" });
    expect(await bytes()).toBe(
      file(
        PARTIAL,
        history(
          entry(at(5), "override", "inconclusive", "still supported"),
          voided(at(1)),
          OVERRIDE,
          PROMOTION
        )
      )
    );
  });
});

describe("a why added afterwards", () => {
  it("never makes an Override of an entry that was not one — it would stand over evidence it never judged", async () => {
    const bare = entry(t0, "override", "inconclusive");
    const { call, bytes } = await opened(PARTIAL, history(bare, PROMOTION));
    const reply = await call("explainRevision", {
      at: localIso(t0),
      field: "override",
      why: "late reasons",
    });
    expect(reply.error?.message).toMatch(/override/);
    expect(await bytes()).toBe(file(PARTIAL, history(bare, PROMOTION)));
  });
});

describe("the void, in the write that caused it", () => {
  it("an Outcome recorded voids the Override, above the criterion's Revision, and the page reads the derived state again", async () => {
    const { wrote, bytes, page, setNow } = await overridden();
    setNow(at(5));
    await wrote("setCriterionField", {
      id: "c2",
      field: "outcome",
      value: "inconclusive",
    });

    expect(await bytes()).toBe(
      file(
        `${MET}\n\n${F2_BLOCK}\noutcome:: inconclusive`,
        history(
          voided(at(5)),
          entry(at(5), "criterion F2", F2_BLOCK),
          OVERRIDE,
          PROMOTION
        )
      )
    );
    const read = await page();
    expect(read.derivation.effective).toBe("inconclusive");
    expect(read.derivation.override).toBeNull();
    expect(read.overridable).toBe(true);
  });

  it("an Outcome that moves the state voids above the · state entry", async () => {
    const { wrote, bytes, setNow } = await overridden();
    setNow(at(5));
    await wrote("setCriterionField", {
      id: "c2",
      field: "outcome",
      value: "met",
    });
    expect(await bytes()).toBe(
      file(
        `${MET}\n\n${F2_BLOCK}\noutcome:: met`,
        history(
          voided(at(5)),
          entry(at(5), "state", "inconclusive"),
          entry(at(5), "criterion F2", F2_BLOCK),
          OVERRIDE,
          PROMOTION
        )
      )
    );
  });

  it("a Relationship changed voids it", async () => {
    const { wrote, bytes, setNow } = await overridden();
    setNow(at(5));
    await wrote("setCriterionField", {
      id: "c2",
      field: "relationship",
      value: "diagnostic",
    });
    const written = await bytes();
    expect(written).toContain(
      history(voided(at(5)), entry(at(5), "state", "inconclusive"))
    );
  });

  it("a criterion reworded voids it", async () => {
    const { wrote, bytes, setNow } = await overridden();
    setNow(at(5));
    await wrote("editCriterion", {
      id: "c2",
      text: "No gain when density is permuted",
      was: "No gain when density is shuffled across subjects",
    });
    expect(await bytes()).toContain(
      history(voided(at(5)), entry(at(5), "criterion F2", F2_BLOCK))
    );
  });

  it("a criterion added voids it", async () => {
    const { wrote, bytes, setNow } = await overridden();
    setNow(at(5));
    await wrote("addCriterion", {
      text: "Gain survives a second night",
      relationship: "confirming",
    });
    expect(await bytes()).toContain(
      history(voided(at(5)), entry(at(5), "criterion C3", ""))
    );
  });

  it("a criterion deleted voids it", async () => {
    const { wrote, bytes, setNow } = await overridden();
    setNow(at(5));
    await wrote("deleteCriterion", { id: "c2" });
    // C1 met alone now derives supported: the move is on the record, and
    // the Override that anticipated it is voided all the same.
    expect(await bytes()).toContain(
      history(
        voided(at(5)),
        entry(at(5), "state", "inconclusive"),
        entry(at(5), "criterion F2", F2_BLOCK)
      )
    );
  });

  it("a claim Revision voids it", async () => {
    const { wrote, bytes, setNow } = await overridden();
    setNow(at(5));
    await wrote("savePosition", {
      field: "claim",
      text: "Slow-wave density predicts recall gain.",
      was: CLAIM,
    });
    expect(await bytes()).toBe(
      file(
        PARTIAL,
        history(
          voided(at(5)),
          entry(at(5), "claim", CLAIM),
          OVERRIDE,
          PROMOTION
        )
      ).replace(CLAIM + "\n", "Slow-wave density predicts recall gain.\n")
    );
  });

  it("a design-notes Revision never does", async () => {
    const { wrote, bytes, page, setNow } = await overridden();
    setNow(at(5));
    await wrote("savePosition", {
      field: "design notes",
      text: "Nap length held at 90 minutes.",
      was: "",
    });
    expect(await bytes()).toBe(
      file(
        PARTIAL,
        history(entry(at(5), "design notes", ""), OVERRIDE, PROMOTION),
        "Nap length held at 90 minutes."
      )
    );
    expect((await page()).derivation.effective).toBe("supported");
  });

  it("a write with no live Override writes no void", async () => {
    const { wrote, bytes, setNow } = await opened(PARTIAL);
    setNow(at(5));
    await wrote("setCriterionField", {
      id: "c2",
      field: "outcome",
      value: "inconclusive",
    });
    expect(await bytes()).not.toContain("override voided");
  });
});

describe("the void, from an edit made in Obsidian", () => {
  it("a criterion edited on disk voids the Override in the splice, stamped with the edit", async () => {
    const { obsidian, bytes, c, setNow } = await overridden();
    setNow(at(5));
    await obsidian("Criteria", `${MET}\n\n${F2_BLOCK}\noutcome:: inconclusive`);
    await c.close();

    expect(await bytes()).toBe(
      file(
        `${MET}\n\n${F2_BLOCK}\noutcome:: inconclusive`,
        history(
          voided(at(5)),
          entry(at(5), "criterion F2", F2_BLOCK),
          OVERRIDE,
          PROMOTION
        )
      )
    );
  });

  it("a claim edited on disk voids it", async () => {
    const { obsidian, bytes, c, setNow } = await overridden();
    setNow(at(5));
    await obsidian("Claim", "Slow-wave density predicts recall gain.");
    await c.close();

    expect(await bytes()).toContain(
      history(voided(at(5)), entry(at(5), "claim", CLAIM), OVERRIDE)
    );
  });

  it("design notes edited on disk do not", async () => {
    const { obsidian, bytes, c, setNow } = await overridden();
    setNow(at(5));
    await obsidian("Design notes", "Nap length held at 90 minutes.");
    await c.close();

    const written = await bytes();
    expect(written).toContain(
      history(entry(at(5), "design notes", ""), OVERRIDE)
    );
    expect(written).not.toContain("override voided");
  });

  it("an Obsidian edit and the page's own criterion write in one splice void the Override once", async () => {
    const { obsidian, bytes, wrote, setNow } = await overridden();
    setNow(at(5));
    await obsidian("Claim", "Slow-wave density predicts recall gain.");
    setNow(at(8));
    await wrote("setCriterionField", {
      id: "c2",
      field: "outcome",
      value: "inconclusive",
    });

    const written = await bytes();
    expect(written.match(/override voided/g)).toHaveLength(1);
    expect(written).toContain(
      history(
        entry(at(8), "criterion F2", F2_BLOCK),
        voided(at(5)),
        entry(at(5), "claim", CLAIM),
        OVERRIDE
      )
    );
  });
});
