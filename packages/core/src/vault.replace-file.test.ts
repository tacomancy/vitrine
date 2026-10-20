import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { FileText } from "./vault-read.js";
import { closeCores, core, vaultWith, type CoreOptions } from "./test-core.js";
import { localIso } from "./time.js";

// The Vault editor's save, `vault.replaceFile` (#693; ADR 0015 decision 3;
// spec #680): the typing whole, and the Revisions it owes the history in the
// same write — coalescing in the window, a Criterion edited after Evidence
// marked, never refused on shape. Driven through the core's own entry over
// a temp vault and asserted on the bytes on disk.

afterEach(closeCores);

type Vault = { name: string; path: string };
type Saved =
  | { written: true; hash: string; unrecorded?: string }
  | { written: false; reason: string; detail: string };

const RQ = "questions/slow-wave (RQ).md";
const HY = "hypotheses/Slow-wave density predicts recall gain.md";
const REST =
  "\n## Supporting sources\n\n## Opposing sources\n\n## Related questions\n\n## Open threads\n\n## Position history\n";
const RQ_FRONTMATTER = `---
id: rq7m2p9q4w
kind: research-question
question: "Does slow-wave density predict recall gain?"
status: open
promoted: 2026-09-20T10:00:00+02:00
context: reading
---
`;
const question = (answer: string) =>
  RQ_FRONTMATTER + "\n## Working answer\n\n" + answer + "\n" + REST;

const PROMOTED = "2026-09-28T10:00:00+02:00";
const C1 = "### Recall gain tracks density across the sample ^c1";
const RUN = "- [[run-14]] — gain tracked density";
const hypothesis = (criteria: string) => `---
id: hy4k8m2p9q
kind: hypothesis
promoted_from: "[[Does slow-wave density predict recall gain]]"
promoted: ${PROMOTED}
context: reading
---

## Claim

Slow-wave density predicts recall gain.

## Criteria

${criteria}

## Design notes

## Position history

- ${PROMOTED} · claim
  from:
`;

const minute = 60_000;
const t0 = new Date("2026-09-21T10:00:00+02:00");
const at = (offsetMinutes: number) =>
  new Date(t0.getTime() + offsetMinutes * minute);
const SETTLE_MS = 40;

const entry = (when: Date, field: string, from: string) =>
  `- ${localIso(when)} · ${field}\n  from:` +
  (from === "" ? "" : "\n" + from.replace(/^(?!$)/gm, "    "));

async function opened(
  files: Record<string, string>,
  now: () => Date,
  opts: CoreOptions = {}
) {
  const vault = await vaultWith(files);
  const c = await core({
    settleMs: SETTLE_MS,
    coalesceMs: 30 * minute,
    now,
    ...opts,
  });
  expect(
    (await c.mutate<Vault>("vault.open", { path: vault })).error
  ).toBeUndefined();
  await c.indexed();
  const read = async (path: string) => {
    const reply = await c.query<FileText>("vault.read", { path });
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  /** The editor's save: the text it holds, `basedOn` the hash it last read. */
  const replace = async (path: string, content: string, basedOn: string) => {
    const reply = await c.mutate<Saved>("vault.replaceFile", {
      path,
      content,
      basedOn,
    });
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  /** Read, change, save: what typing in the open editor comes to. */
  const edit = async (path: string, change: (text: string) => string) => {
    const { text, hash } = await read(path);
    return replace(path, change(text), hash);
  };
  const bytes = (path: string) => readFile(join(vault, path), "utf8");
  return { vault, c, read, replace, edit, bytes };
}

describe("vault.replaceFile records the Revisions its typing owes", () => {
  it("a Working answer typed here adds a Revision, in the same write, every other byte as it was", async () => {
    const { edit, bytes, read } = await opened(
      { [RQ]: question("Probably both.") },
      () => t0
    );

    const saved = await edit(RQ, (t) =>
      t.replace("Probably both.", "Encoding strength, mostly.")
    );

    expect(saved).toMatchObject({ written: true });
    expect(await bytes(RQ)).toBe(
      RQ_FRONTMATTER +
        "\n## Working answer\n\nEncoding strength, mostly.\n" +
        REST +
        "\n" +
        entry(t0, "working answer", "Probably both.") +
        "\n"
    );
    expect((await read(RQ)).hash).toBe((saved as { hash: string }).hash);
  });

  it("saves inside the window are one entry holding the text from before the first; one after the window is a second", async () => {
    let now = t0;
    const { edit, bytes } = await opened(
      { [RQ]: question("Probably both.") },
      () => now
    );

    await edit(RQ, (t) => t.replace("Probably both.", "Encoding."));
    now = at(10);
    await edit(RQ, (t) => t.replace("Encoding.", "Encoding strength."));
    expect(await bytes(RQ)).toBe(
      RQ_FRONTMATTER +
        "\n## Working answer\n\nEncoding strength.\n" +
        REST +
        "\n" +
        entry(at(10), "working answer", "Probably both.") +
        "\n"
    );

    now = at(10 + 31);
    await edit(RQ, (t) => t.replace("Encoding strength.", "Mostly encoding."));
    expect(await bytes(RQ)).toBe(
      RQ_FRONTMATTER +
        "\n## Working answer\n\nMostly encoding.\n" +
        REST +
        "\n" +
        entry(at(41), "working answer", "Encoding strength.") +
        "\n" +
        entry(at(10), "working answer", "Probably both.") +
        "\n"
    );
  });

  it("an edit that changes no Position records none, and still lands", async () => {
    const { edit, bytes } = await opened(
      { [RQ]: question("Probably both.") },
      () => t0
    );

    const saved = await edit(RQ, (t) =>
      t.replace("## Open threads\n", "## Open threads\n\n- ask Jan\n")
    );

    expect(saved).toMatchObject({ written: true });
    expect(await bytes(RQ)).not.toContain("working answer");
    expect(await bytes(RQ)).toContain("- ask Jan");
  });

  it("a Criterion reworded while Evidence sits under it is marked edited after evidence", async () => {
    const tested = `${C1}\n\nrelationship:: confirming\n\n${RUN}`;
    const { edit, bytes } = await opened(
      { [HY]: hypothesis(tested) },
      () => t0
    );

    await edit(HY, (t) =>
      t.replace(
        "Recall gain tracks density across the sample",
        "Recall gain tracks density within each subject"
      )
    );

    const written = await bytes(HY);
    expect(written).toContain(
      entry(t0, "criterion C1 · edited after evidence", tested)
    );
    expect(written).toContain("within each subject ^c1");
  });

  it("the same rewording with no Evidence is a quiet Revision, unmarked", async () => {
    const draft = `${C1}\n\nrelationship:: confirming`;
    const { edit, bytes } = await opened({ [HY]: hypothesis(draft) }, () => t0);

    await edit(HY, (t) => t.replace("across the sample", "in every subject"));

    const written = await bytes(HY);
    expect(written).toContain(entry(t0, "criterion C1", draft));
    expect(written).not.toContain("edited after evidence");
  });

  it("two rewordings after Evidence are two marked entries: a mark never coalesces", async () => {
    const tested = `${C1}\n\nrelationship:: confirming\n\n${RUN}`;
    let now = t0;
    const { edit, bytes } = await opened(
      { [HY]: hypothesis(tested) },
      () => now
    );

    await edit(HY, (t) => t.replace("across the sample", "within subjects"));
    now = at(5);
    await edit(HY, (t) => t.replace("within subjects", "per subject"));

    expect(
      (await bytes(HY)).match(/· criterion C1 · edited after evidence/g)
    ).toHaveLength(2);
  });
});

describe("vault.replaceFile never refuses on shape", () => {
  it("a file whose Working answer heading was deleted saves anyway, and records no Revision", async () => {
    const { edit, bytes, c } = await opened(
      { [RQ]: question("Probably both.") },
      () => t0
    );

    const saved = await edit(RQ, (t) => t.replace("## Working answer\n", ""));

    expect(saved).toMatchObject({ written: true });
    expect(await bytes(RQ)).not.toContain("## Working answer");
    expect(await bytes(RQ)).not.toContain("· working answer");
    expect(c).toBeDefined();
  });

  it("a Working answer heading deleted by typing is said by the file's own page afterwards", async () => {
    const { edit, c } = await opened(
      { [RQ]: question("Probably both.") },
      () => t0
    );
    const problems = async () =>
      (
        await c.query<{ problems: { problem: string; block?: string }[] }>(
          "researchQuestions.page",
          { path: RQ }
        )
      ).result!.data.problems;
    expect(await problems()).toEqual([]);

    await edit(RQ, (t) => t.replace("## Working answer\n", ""));

    expect(await problems()).toEqual([
      expect.objectContaining({
        problem: "sectionMissing",
        block: "Working answer",
      }),
    ]);
  });

  it("a `kind:` changed by hand is re-read as found: the typing lands and nothing is recorded", async () => {
    const { edit, bytes } = await opened(
      { [RQ]: question("Probably both.") },
      () => t0
    );

    await edit(RQ, (t) =>
      t
        .replace("kind: research-question", "kind: note")
        .replace("Probably both.", "Changed too.")
    );

    expect(await bytes(RQ)).toContain("kind: note");
    expect(await bytes(RQ)).not.toContain("· working answer");
  });

  it("an ordinary Note saves with no history to keep", async () => {
    const { edit, bytes } = await opened(
      { "notes/plain.md": "# Plain\n\nWords.\n" },
      () => t0
    );
    await edit("notes/plain.md", (t) => t + "More words.\n");
    expect(await bytes("notes/plain.md")).toBe(
      "# Plain\n\nWords.\nMore words.\n"
    );
  });
});

describe("vault.replaceFile's one refusal", () => {
  it("a hash mismatch refuses, names changedOnDisk, and leaves the disk and its history alone", async () => {
    const { vault, replace, read, bytes } = await opened(
      { [RQ]: question("Probably both.") },
      () => t0
    );
    const { text, hash } = await read(RQ);
    const elsewhere = question("Written in Obsidian.");
    await writeFile(join(vault, RQ), elsewhere);

    const saved = await replace(
      RQ,
      text.replace("Probably both.", "Typed here."),
      hash
    );

    expect(saved).toMatchObject({ written: false, reason: "changedOnDisk" });
    expect(await bytes(RQ)).toBe(elsewhere);
  });
});

describe("vault.replaceFile round-trips the file's bytes", () => {
  it("a CRLF file with a BOM and no trailing newline changes only where the typing and its Revision did", async () => {
    const original = "﻿" + question("Probably both.").trimEnd();
    const crlf = original.replace(/\n/g, "\r\n");
    const { edit, bytes } = await opened({ [RQ]: crlf }, () => t0);

    await edit(RQ, (t) => t.replace("Probably both.", "Encoding."));

    const written = await bytes(RQ);
    expect(written.startsWith("﻿")).toBe(true);
    expect(written.replace(/\r\n/g, "")).not.toContain("\n");
    expect(written).toContain("Encoding.\r\n");
    expect(written).toContain(
      `- ${localIso(t0)} · working answer\r\n  from:\r\n    Probably both.`
    );
    expect(written.endsWith("\r\n")).toBe(false);
  });
});

describe("vault.replaceFile and the watcher", () => {
  const pendingRows = (vault: string) => {
    const db = new DatabaseSync(join(vault, ".vitrine", "queue.sqlite"), {
      readOnly: true,
    });
    const rows = db.prepare("SELECT field FROM pending_revisions").all();
    db.close();
    return rows;
  };

  it("one Revision per save, not two: the watcher no-ops on the app's own hash", async () => {
    let now = t0;
    const { vault, c, edit, bytes } = await opened(
      { [RQ]: question("Probably both.") },
      () => now
    );
    const stream = await c.events();

    await edit(RQ, (t) => t.replace("Probably both.", "Encoding."));
    await stream.next("vaultChanged");

    // The watcher has seen the app's own write once an external edit made
    // after it has come through the same settle window and batch.
    now = at(40);
    await writeFile(join(vault, RQ), question("Something else entirely."));
    await stream.next("vaultChanged");

    expect((await bytes(RQ)).match(/· working answer/g)).toBeNull();
    expect(pendingRows(vault)).toEqual([{ field: "working answer" }]);
  });

  it("an Obsidian edit still parked is spliced in first, ahead of the typing's own entry", async () => {
    let now = t0;
    const { vault, c, read, replace, bytes } = await opened(
      { [RQ]: question("Probably both.") },
      () => now
    );
    const stream = await c.events();
    now = at(5);
    await writeFile(join(vault, RQ), question("Encoding strength, mostly."));
    await stream.next("vaultChanged");
    expect(pendingRows(vault)).toHaveLength(1);

    now = at(7);
    const { text, hash } = await read(RQ);
    await replace(
      RQ,
      text.replace("Encoding strength, mostly.", "Encoding, entirely."),
      hash
    );

    expect(await bytes(RQ)).toBe(
      RQ_FRONTMATTER +
        "\n## Working answer\n\nEncoding, entirely.\n" +
        REST +
        "\n" +
        entry(at(7), "working answer", "Encoding strength, mostly.") +
        "\n" +
        entry(at(5), "working answer", "Probably both.") +
        "\n"
    );
    expect(pendingRows(vault)).toEqual([]);
  });
});

describe("vault.replaceFile on a file with mixed line endings", () => {
  it("saving it unedited in the Working answer records no Revision", async () => {
    const mixed = question("Probably\r\nboth\nreally.");
    const { edit, bytes } = await opened({ [RQ]: mixed }, () => t0);

    await edit(RQ, (t) => t + "\n- ask Jan\n");

    expect(await bytes(RQ)).not.toContain("· working answer");
  });
});
