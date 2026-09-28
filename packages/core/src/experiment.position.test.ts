import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { ExperimentPage } from "./experiment.js";
import { closeCores, core, vaultWith, type CoreOptions } from "./test-core.js";
import { localIso } from "./time.js";

// Design and Observations as Positions (#365; spec #362 stories 13–16,
// 26–27; TEST-8, TEST-11). Each page save is one write through the own-
// write path every Position takes, so it coalesces and takes a why as a
// Working answer's does; an Obsidian edit to either is parked and spliced
// the same way. Purpose and *where it ran* are not Positions (story 18).
// Asserted on the reply and the bytes; every wait is on the index or the
// event stream, never a timer.

afterEach(closeCores);

type Vault = { name: string; path: string };
type Readable = Extract<ExperimentPage, { readable: true }>;
type Field = "design" | "observations";
type Saved =
  | { written: true; hash: string; revision: string | null }
  | { written: false; reason: string; detail: string; revision: null };
type Written =
  | { written: true; hash: string }
  | { written: false; reason: string; detail: string };

const PATH = "experiments/prereg-exclusions/prereg-exclusions.md";
const DESIGN = "Varied: the inclusion rule only.";

/** An Experiment with `design` and `observations` as given, and `history` under `## Position history`. */
const file = (design: string, observations: string, history = "") =>
  `---
id: ex9q2w7m4k
kind: experiment
name: "prereg-exclusions"
status: complete
created: 2026-09-09T10:00:00+02:00
tags: []
---

## Purpose

See whether the pooled effect survives the exclusion rule at all.

## Design
${design === "" ? "" : `\n${design}\n`}
## Where it ran

repo: nap-reanalysis

## Artifacts

## Observations
${observations === "" ? "" : `\n${observations}\n`}
## Position history
${history === "" ? "" : `\n${history}`}`;

const minute = 60_000;
const t0 = new Date("2026-09-29T10:00:00+02:00");
const at = (offsetMinutes: number) =>
  new Date(t0.getTime() + offsetMinutes * minute);

/** The entry a save or a splice writes, its previous text indented. */
const entry = (when: Date, field: string, from: string) =>
  `- ${localIso(when)} · ${field}\n  from:` +
  (from === "" ? "" : "\n" + from.replace(/^(?!$)/gm, "    "));
const history = (...entries: string[]) => entries.join("\n") + "\n";

async function opened(
  files: Record<string, string> = { [PATH]: file(DESIGN, "") },
  opts: CoreOptions = {}
) {
  const vault = await vaultWith(files);
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
    const reply = await c.query<ExperimentPage>("experiments.page", {
      path: PATH,
    });
    expect(reply.error).toBeUndefined();
    const data = reply.result?.data as ExperimentPage;
    if (!data.readable) throw new Error(data.reason);
    return data;
  };
  const save = async (field: Field, text: string) => {
    const read = await page();
    return c.mutate<Saved>("experiments.savePosition", {
      path: PATH,
      field,
      text,
      basedOn: read.hash,
      was: read.sections[field].text,
    });
  };
  const saved = async (field: Field, text: string) => {
    const reply = await save(field, text);
    expect(reply.error).toBeUndefined();
    return reply.result?.data as Saved;
  };
  return {
    vault,
    c,
    bytes,
    page,
    save,
    saved,
    setNow: (d: Date) => {
      now = d;
    },
    explain: async (revision: string, field: string, why: string) => {
      const reply = await c.mutate<Written>("experiments.explainRevision", {
        path: PATH,
        at: revision,
        field,
        why,
        basedOn: (await page()).hash,
      });
      expect(reply.error).toBeUndefined();
      return reply.result?.data as Written;
    },
    /** Obsidian's edit: the file written whole as given, awaited as far as the index. */
    obsidian: async (content: string) => {
      await writeFile(join(vault, PATH), content);
      await stream.next("vaultChanged");
      await c.indexed();
    },
  };
}

describe("the Experiment Kind on the positionsOf seam", () => {
  it("carries design and observations, and nothing for Purpose or Where it ran", async () => {
    const { vault } = await opened({
      [PATH]: file(DESIGN, "The effect halves under the rule."),
    });
    const db = new DatabaseSync(join(vault, ".vitrine", "index.sqlite"), {
      readOnly: true,
    });
    const rows = db
      .prepare(
        "SELECT field, text FROM positions WHERE path = ? ORDER BY field"
      )
      .all(PATH);
    db.close();
    expect(rows).toEqual([
      { field: "design", text: DESIGN },
      { field: "observations", text: "The effect halves under the rule." },
    ]);
  });
});

describe("experiments.savePosition", () => {
  it("saves the design and records its Revision, the previous text in full, in the same write", async () => {
    const { saved, bytes } = await opened();

    const reply = await saved("design", "Varied: the rule and the lab.");
    expect(reply).toMatchObject({ written: true, revision: localIso(t0) });
    expect(await bytes()).toBe(
      file(
        "Varied: the rule and the lab.",
        "",
        history(entry(t0, "design", DESIGN))
      )
    );
  });

  it("coalesces saves to one field within the window, and opens a new entry for the other field", async () => {
    const { saved, bytes, setNow } = await opened();

    await saved("observations", "The effect halves.");
    setNow(at(10));
    await saved("observations", "The effect halves under the rule.");
    setNow(at(12));
    await saved("design", "Varied: the rule and the lab.");

    expect(await bytes()).toBe(
      file(
        "Varied: the rule and the lab.",
        "The effect halves under the rule.",
        // One observations entry, re-stamped, still from the empty section.
        history(
          entry(at(12), "design", DESIGN),
          entry(at(10), "observations", "")
        )
      )
    );
  });

  it("text the file already holds is not a save and records nothing", async () => {
    const { saved, bytes } = await opened();
    const before = await bytes();
    expect(await saved("design", `  ${DESIGN}\n`)).toMatchObject({
      written: true,
      revision: null,
    });
    expect(await bytes()).toBe(before);
  });

  it("refuses a field that is not one of the two Positions", async () => {
    const { c, page } = await opened();
    const read = await page();
    const reply = await c.mutate("experiments.savePosition", {
      path: PATH,
      field: "purpose",
      text: "anything",
      basedOn: read.hash,
      was: read.sections.purpose.text,
    });
    expect(reply.error).toBeDefined();
  });

  it("a why written onto the saved Revision afterwards lands on that entry", async () => {
    const { saved, explain, bytes } = await opened();
    const reply = await saved("design", "Varied: the rule and the lab.");

    expect(
      await explain(reply.revision!, "design", "the reviewer asked for per-lab")
    ).toMatchObject({ written: true });
    expect(await bytes()).toBe(
      file(
        "Varied: the rule and the lab.",
        "",
        history(
          `- ${localIso(t0)} · design\n  why: the reviewer asked for per-lab\n  from:\n    ${DESIGN}`
        )
      )
    );
  });
});

describe("design and observations edited in Obsidian", () => {
  it("are parked until the file is quiet, then spliced as Revisions exactly as a page save writes them", async () => {
    const { obsidian, setNow, bytes, c } = await opened();

    setNow(at(5));
    await obsidian(file("Varied: the rule, by hand.", "Smaller, by eye."));
    // Parked, not written, until the file is quiet or the app writes it.
    expect(await bytes()).not.toContain(localIso(at(5)));
    await c.close();

    expect(await bytes()).toBe(
      file(
        "Varied: the rule, by hand.",
        "Smaller, by eye.",
        history(
          entry(at(5), "observations", ""),
          entry(at(5), "design", DESIGN)
        )
      )
    );
  });

  it("an edit to Purpose alone parks nothing", async () => {
    const { obsidian, bytes, c } = await opened();
    const edited = file(DESIGN, "").replace(
      "at all.",
      "at all, and in which labs."
    );
    await obsidian(edited);
    await c.close();
    expect(await bytes()).toBe(edited);
  });
});
