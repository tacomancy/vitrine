import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { HypothesisPage } from "./hypothesis.js";
import { closeCores, core, vaultWith, type CoreOptions } from "./test-core.js";
import { localIso } from "./time.js";

// The claim and design notes edited in place (#333; spec #327 stories 16,
// 17, 19, 53, 54, 86, 88, 90; ADR 0020 decision 4 for the Edited sections).
// Each save is one write through the same serialised own-write path the
// Research Question's Working answer takes, so a page save and a Revision
// parked by an Obsidian edit meet in one write. Asserted on the reply and
// the bytes on disk; every wait is on the index or the event stream.

afterEach(closeCores);

type Vault = { name: string; path: string };
type Readable = Extract<HypothesisPage, { readable: true }>;
type Saved =
  | { written: true; hash: string; revision: string | null }
  | { written: false; reason: string; detail: string; revision: null };
type Written =
  | { written: true; hash: string }
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

const CRITERIA =
  "### Recall gain tracks density across the sample ^c1\n\nrelationship:: confirming\n";

/** A Hypothesis as promotion writes it, with `notes` under `## Design notes` and `history` under `## Position history`. */
const file = (
  claim: string,
  notes: string,
  history = `- ${PROMOTED} · claim\n  from:\n`
) =>
  `${FRONTMATTER}
## Claim

${claim}

## Criteria

${CRITERIA}
## Design notes
${notes === "" ? "" : `\n${notes}\n`}
## Position history

${history}`;

const minute = 60_000;
const t0 = new Date("2026-09-29T10:00:00+02:00");
const at = (offsetMinutes: number) =>
  new Date(t0.getTime() + offsetMinutes * minute);

/** The entry a save or a splice writes, its previous text indented. */
const entry = (when: Date | string, field: string, from: string) =>
  `- ${typeof when === "string" ? when : localIso(when)} · ${field}\n  from:` +
  (from === "" ? "" : "\n" + from.replace(/^(?!$)/gm, "    "));

async function opened(
  files: Record<string, string> = { [PATH]: file(CLAIM, "") },
  opts: CoreOptions = {}
) {
  const vault = await vaultWith(files);
  const c = await core({ coalesceMs: 30 * minute, ...opts });
  expect(
    (await c.mutate<Vault>("vault.open", { path: vault })).error
  ).toBeUndefined();
  await c.indexed();
  const page = async () => {
    const reply = await c.query<HypothesisPage>("hypotheses.page", {
      path: PATH,
    });
    expect(reply.error).toBeUndefined();
    const data = reply.result?.data as HypothesisPage;
    if (!data.readable) throw new Error(data.reason);
    return data;
  };
  const textOf = (read: Readable, field: "claim" | "design notes") =>
    field === "claim"
      ? read.sections.claim.text
      : read.sections.designNotes.text;
  /** What the page was editing: the file's hash and the field's text, as it read them. */
  const based = async (field: "claim" | "design notes") => {
    const read = await page();
    return { hash: read.hash, was: textOf(read, field) };
  };
  const save = async (
    field: "claim" | "design notes",
    text: string,
    on?: { hash: string; was: string }
  ) => {
    const { hash, was } = on ?? (await based(field));
    const reply = await c.mutate<Saved>("hypotheses.savePosition", {
      path: PATH,
      field,
      text,
      basedOn: hash,
      was,
    });
    return reply;
  };
  const saved = async (field: "claim" | "design notes", text: string) => {
    const reply = await save(field, text);
    expect(reply.error).toBeUndefined();
    return reply.result?.data as Saved;
  };
  const explain = async (revision: string, field: string, why: string) => {
    const reply = await c.mutate<Written>("hypotheses.explainRevision", {
      path: PATH,
      at: revision,
      field,
      why,
      basedOn: (await page()).hash,
    });
    expect(reply.error).toBeUndefined();
    return reply.result?.data as Written;
  };
  return {
    vault,
    c,
    page,
    based,
    save,
    saved,
    explain,
    bytes: () => readFile(join(vault, PATH), "utf8"),
  };
}

describe("the Hypothesis Kind on the positionsOf seam", () => {
  it("after a build the positions table carries the claim, design notes, and each criterion's whole block under its label", async () => {
    const vault = await vaultWith({
      [PATH]: file(CLAIM, "Nap length is held at 90 minutes."),
    });
    const c = await core();
    expect(
      (await c.mutate<Vault>("vault.open", { path: vault })).error
    ).toBeUndefined();
    await c.indexed();
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
      { field: "claim", text: CLAIM },
      {
        field: "criterion C1",
        text: CRITERIA.trim(),
      },
      { field: "design notes", text: "Nap length is held at 90 minutes." },
    ]);
  });
});

describe("hypotheses.savePosition", () => {
  it("saves the claim and records its Revision in the same write, every other byte as it was", async () => {
    const { saved, bytes, page } = await opened(undefined, { now: () => t0 });

    const reply = await saved(
      "claim",
      "Density predicts gain, not nap length."
    );
    expect(reply).toMatchObject({ written: true, revision: localIso(t0) });
    expect(await bytes()).toBe(
      file(
        "Density predicts gain, not nap length.",
        "",
        entry(t0, "claim", CLAIM) + "\n" + entry(PROMOTED, "claim", "") + "\n"
      )
    );
    const read = await page();
    expect(read.hash).toBe((reply as { hash: string }).hash);
    expect(read.sections.claim.text).toBe(
      "Density predicts gain, not nap length."
    );
  });

  it("coalesces saves to one field within the window; claim and design-note revisions share one timeline, newest first", async () => {
    let now = t0;
    const { saved, bytes, page } = await opened(undefined, { now: () => now });

    await saved("claim", "First narrowing.");
    now = at(10);
    await saved("claim", "Second narrowing.");
    // Inside the window, one field: one entry, the later stamp, the first from.
    expect(await bytes()).toContain(
      entry(at(10), "claim", CLAIM) + "\n" + entry(PROMOTED, "claim", "")
    );

    now = at(15);
    await saved("design notes", "Nap length held at 90 minutes.");
    now = at(20);
    await saved(
      "design notes",
      "Nap length held at 90 minutes; EEG montage fixed."
    );

    expect(await bytes()).toBe(
      file(
        "Second narrowing.",
        "Nap length held at 90 minutes; EEG montage fixed.",
        [
          entry(at(20), "design notes", ""),
          entry(at(10), "claim", CLAIM),
          entry(PROMOTED, "claim", ""),
        ].join("\n") + "\n"
      )
    );
    expect(
      (await page()).sections.positionHistory.entries.map((e) => [
        e.at,
        e.field,
      ])
    ).toEqual([
      [localIso(at(20)), "design notes"],
      [localIso(at(10)), "claim"],
      [PROMOTED, "claim"],
    ]);

    // After the window, the same field opens a new entry.
    now = at(60);
    await saved("design notes", "Montage fixed.");
    expect((await page()).sections.positionHistory.entries[0]).toEqual({
      at: localIso(at(60)),
      field: "design notes",
      why: null,
      from: "Nap length held at 90 minutes; EEG montage fixed.",
    });
  });

  it("saving the text the file already holds writes nothing and records no Revision", async () => {
    const { saved, bytes } = await opened(undefined, { now: () => t0 });
    const before = await bytes();
    expect(await saved("claim", `  ${CLAIM}\n`)).toMatchObject({
      written: true,
      revision: null,
    });
    expect(await bytes()).toBe(before);
  });

  it("refuses an empty claim, writing nothing — a Hypothesis is never without a claim; empty design notes are a save", async () => {
    const { save, saved, bytes } = await opened(
      { [PATH]: file(CLAIM, "Held constant: nap length.") },
      { now: () => t0 }
    );
    const before = await bytes();
    const reply = await save("claim", "   ");
    expect(reply.error?.message).toMatch(/claim is empty/);
    expect(await bytes()).toBe(before);

    expect(await saved("design notes", "")).toMatchObject({ written: true });
    expect(await bytes()).toContain(
      entry(t0, "design notes", "Held constant: nap length.")
    );
  });

  it("refuses a save whose section changed underneath, writes nothing, and records no Revision; a stale save to the other field re-applies", async () => {
    const { vault, based, saved, save, bytes, page } = await opened(undefined, {
      now: () => t0,
    });
    const staleClaim = await based("claim");
    const staleNotes = await based("design notes");
    await writeFile(
      join(vault, PATH),
      (await bytes()).replace(CLAIM, "Obsidian narrowed this.")
    );
    const before = await bytes();

    const refused = await save("claim", "Typed.", staleClaim);
    expect(refused.error).toBeUndefined();
    expect(refused.result?.data).toMatchObject({
      written: false,
      reason: "changedAndUnreapplyable",
      revision: null,
    });
    expect(await bytes()).toBe(before);

    const landed = await save("design notes", "Held: nap length.", staleNotes);
    expect(landed.result?.data).toMatchObject({ written: true });
    expect((await page()).sections.claim.text).toBe("Obsidian narrowed this.");

    // *Keep mine*: the page reads afresh and saves over the disk copy.
    expect(await saved("claim", "Typed.")).toMatchObject({ written: true });
    expect((await page()).sections.claim.text).toBe("Typed.");
  });

  it("a file that is gone is a refusal with its reason, never a silent no-op", async () => {
    const { vault, based, save } = await opened(undefined, { now: () => t0 });
    const stale = await based("claim");
    await rm(join(vault, PATH));
    const reply = await save("claim", "Typed.", stale);
    expect(reply.result?.data).toMatchObject({
      written: false,
      reason: "unreadable",
      detail: "missing from the vault",
    });
  });

  it("refuses a file that is not a Hypothesis, whatever headings it has", async () => {
    const other = "questions/q (RQ).md";
    const { c, vault } = await opened({
      [PATH]: file(CLAIM, ""),
      [other]: file(CLAIM, "").replace(
        "kind: hypothesis",
        "kind: research-question"
      ),
    });
    const before = await readFile(join(vault, other), "utf8");
    const reply = await c.mutate<Saved>("hypotheses.savePosition", {
      path: other,
      field: "claim",
      text: "Typed.",
      basedOn: "x",
      was: CLAIM,
    });
    expect(reply.result?.data).toMatchObject({
      written: false,
      reason: "unreadable",
      detail: "not a Hypothesis: kind is research-question",
    });
    expect(await readFile(join(vault, other), "utf8")).toBe(before);
  });
});

describe("hypotheses.explainRevision", () => {
  it("writes a why onto any entry — the claim's first included — with a link inline", async () => {
    const WHY =
      "Cordi's funnel plot — mostly small-study bias. [[cordi2021#^h12]]";
    const { explain, bytes, page } = await opened(undefined, {
      now: () => t0,
    });
    expect(await explain(PROMOTED, "claim", WHY)).toMatchObject({
      written: true,
    });
    expect(await bytes()).toBe(
      file(CLAIM, "", `- ${PROMOTED} · claim\n  why: ${WHY}\n  from:\n`)
    );
    expect((await page()).sections.positionHistory.entries[0]?.why).toBe(WHY);
  });

  it("names an entry by its timestamp and its field: two fields saved in one second are two entries a why can tell apart", async () => {
    // A blur on the claim and ⌘↵ in the design notes can land in the same
    // second, and so can a parked Obsidian edit and the save that splices
    // it. The timestamp alone would name both and the why would refuse.
    const same = "2026-09-29T10:00:00+02:00";
    const history =
      [
        entry(same, "design notes", ""),
        entry(same, "claim", "An earlier claim."),
        entry(PROMOTED, "claim", ""),
      ].join("\n") + "\n";
    const { explain, bytes } = await opened({
      [PATH]: file(CLAIM, "Held: nap length.", history),
    });
    expect(
      await explain(same, "claim", "Narrowed after the pilot.")
    ).toMatchObject({
      written: true,
    });
    expect(await bytes()).toBe(
      file(
        CLAIM,
        "Held: nap length.",
        [
          entry(same, "design notes", ""),
          `- ${same} · claim\n  why: Narrowed after the pilot.\n  from:\n    An earlier claim.`,
          entry(PROMOTED, "claim", ""),
        ].join("\n") + "\n"
      )
    );
  });
});

describe("an edit to the claim or design notes made in Obsidian", () => {
  const SETTLE_MS = 40;

  it("appears on the page once indexed, and a page save carries its parked Revision in the same write, below the save's own", async () => {
    let now = t0;
    const { vault, c, saved, bytes, page } = await opened(undefined, {
      now: () => now,
      settleMs: SETTLE_MS,
    });
    const stream = await c.events();

    now = at(5);
    await writeFile(
      join(vault, PATH),
      (await bytes()).replace(CLAIM, "Obsidian narrowed the claim.")
    );
    await stream.next("vaultChanged");
    // On the page within the settle window, before any Revision is spliced.
    expect((await page()).sections.claim.text).toBe(
      "Obsidian narrowed the claim."
    );
    expect(await bytes()).not.toContain(localIso(at(5)));

    now = at(8);
    await saved("design notes", "Held: nap length.");
    expect(await bytes()).toBe(
      file(
        "Obsidian narrowed the claim.",
        "Held: nap length.",
        [
          entry(at(8), "design notes", ""),
          entry(at(5), "claim", CLAIM),
          entry(PROMOTED, "claim", ""),
        ].join("\n") + "\n"
      )
    );
  });

  it("is spliced as a Revision once the file has been quiet, with no app write", async () => {
    let now = t0;
    const { vault, c, bytes } = await opened(
      { [PATH]: file(CLAIM, "Held: nap length.") },
      { now: () => now, settleMs: SETTLE_MS, coalesceMs: 60 }
    );
    const stream = await c.events();

    now = at(5);
    await writeFile(
      join(vault, PATH),
      (await bytes()).replace(
        "Held: nap length.",
        "Held: nap length and time of day."
      )
    );
    // The external change, then the splice's own write.
    await stream.next("vaultChanged");
    await stream.next("vaultChanged");
    expect(await bytes()).toBe(
      file(
        CLAIM,
        "Held: nap length and time of day.",
        [
          entry(at(5), "design notes", "Held: nap length."),
          entry(PROMOTED, "claim", ""),
        ].join("\n") + "\n"
      )
    );
  });
});
