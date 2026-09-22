import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { ResearchQuestionPage } from "./research-question.js";
import {
  closeCores,
  core,
  tmp,
  vaultWith,
  type CoreOptions,
} from "./test-core.js";
import { localIso } from "./time.js";

// Pending Revisions (#217; ADR 0020 decision 3, ADR 0013): an edit made in
// Obsidian to a Position is caught by the index's diff, parked in
// `queue.sqlite`, and spliced into `## Position history` when the file is
// quiet, on the app's next write to it, or at vault close. Driven through
// `app.request` with plain `fs` writes for Obsidian's edits; every wait is
// on the event stream, never a sleep.

afterEach(closeCores);

type Vault = { name: string; path: string };

const PATH = "questions/slow-wave (RQ).md";
const REST =
  "\n## Supporting sources\n\n## Opposing sources\n\n## Related questions\n\n## Open threads\n\n## Position history\n";
const FRONTMATTER = `---
id: rq7m2p9q4w
kind: research-question
question: "Does slow-wave density predict recall gain?"
status: open
promoted: 2026-09-20T10:00:00+02:00
context: reading
---
`;
const page = (answer: string) =>
  FRONTMATTER + "\n## Working answer\n\n" + answer + "\n" + REST;

const minute = 60_000;
const t0 = new Date("2026-09-21T10:00:00+02:00");
const at = (offsetMinutes: number) =>
  new Date(t0.getTime() + offsetMinutes * minute);

/** The entry a splice writes: a quiet Revision, its previous text indented. */
const entry = (when: Date, from: string) =>
  `- ${localIso(when)} · working answer\n  from:` +
  (from === "" ? "" : "\n" + from.replace(/^(?!$)/gm, "    "));

const SETTLE_MS = 40;

/** A vault holding the page, opened, indexed, and subscribed to. */
async function opened(
  files: Record<string, string>,
  opts: CoreOptions & { vault?: string } = {}
) {
  const vault = opts.vault ?? (await vaultWith(files));
  const c = await core({
    settleMs: SETTLE_MS,
    coalesceMs: 30 * minute,
    ...opts,
  });
  const reply = await c.mutate<Vault>("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  const stream = await c.events();
  return {
    vault,
    c,
    stream,
    file: () => readFile(join(vault, PATH), "utf8"),
    /** Obsidian's edit: a plain write, awaited as far as the index's event. */
    obsidian: async (answer: string) => {
      await writeFile(join(vault, PATH), page(answer));
      await stream.next("vaultChanged");
    },
    /** An app write to the same file that has nothing to do with the history. */
    appWrite: async () => {
      const read = await c.query<ResearchQuestionPage>(
        "researchQuestions.page",
        { path: PATH }
      );
      const data = read.result?.data as ResearchQuestionPage;
      if (!data.readable) throw new Error(data.reason);
      const saved = await c.mutate<{ written: boolean }>(
        "researchQuestions.saveSection",
        {
          path: PATH,
          section: "Open threads",
          body: "- [ ] Read Cordi.",
          basedOn: data.hash,
        }
      );
      expect(saved.error).toBeUndefined();
      expect(saved.result?.data.written).toBe(true);
    },
  };
}

/** The pending rows as `queue.sqlite` holds them, read from outside the core. */
function pendingRows(vault: string) {
  const db = new DatabaseSync(join(vault, ".vitrine", "queue.sqlite"), {
    readOnly: true,
  });
  const rows = db
    .prepare(
      "SELECT path, field, from_text, at FROM pending_revisions ORDER BY id"
    )
    .all();
  db.close();
  return rows;
}

describe("an edit made in Obsidian becomes a pending Revision", () => {
  it("is spliced by the app's next write to the file, holding the text from before the Obsidian edit", async () => {
    let now = t0;
    const { vault, file, obsidian, appWrite } = await opened(
      { [PATH]: page("Probably both.") },
      { now: () => now }
    );

    now = at(5);
    await obsidian("Encoding strength, mostly.");
    // Parked, not written: the app never writes under the user's cursor.
    expect(await file()).toBe(page("Encoding strength, mostly."));
    expect(pendingRows(vault)).toEqual([
      {
        path: PATH,
        field: "working answer",
        from_text: "Probably both.",
        at: localIso(at(5)),
      },
    ]);

    now = at(7);
    await appWrite();
    expect(await file()).toBe(
      FRONTMATTER +
        "\n## Working answer\n\nEncoding strength, mostly.\n" +
        REST.replace(
          "## Open threads\n",
          "## Open threads\n\n- [ ] Read Cordi.\n"
        ) +
        "\n" +
        entry(at(5), "Probably both.") +
        "\n"
    );
    expect(pendingRows(vault)).toEqual([]);
  });

  it("a second Obsidian edit inside the window is one entry: the later timestamp, the first from", async () => {
    let now = t0;
    const { vault, file, obsidian, appWrite } = await opened(
      { [PATH]: page("Probably both.") },
      { now: () => now }
    );

    now = at(5);
    await obsidian("Encoding strength, mostly.");
    now = at(12);
    await obsidian("Encoding strength, and not much else.");
    expect(pendingRows(vault)).toEqual([
      {
        path: PATH,
        field: "working answer",
        from_text: "Probably both.",
        at: localIso(at(12)),
      },
    ]);

    await appWrite();
    const written = await file();
    expect(written).toContain(entry(at(12), "Probably both."));
    expect(written).not.toContain(localIso(at(5)));
  });

  it("with the window injected short, the entry is spliced once the file has been quiet, with no app write", async () => {
    let now = t0;
    const { vault, file, stream } = await opened(
      { [PATH]: page("Probably both.") },
      { now: () => now, coalesceMs: 60 }
    );

    now = at(5);
    await writeFile(join(vault, PATH), page("Encoding strength, mostly."));
    // The external change, then the splice's own write.
    await stream.next("vaultChanged");
    await stream.next("vaultChanged");
    expect(await file()).toBe(
      FRONTMATTER +
        "\n## Working answer\n\nEncoding strength, mostly.\n" +
        REST +
        "\n" +
        entry(at(5), "Probably both.") +
        "\n"
    );
    expect(pendingRows(vault)).toEqual([]);
  });

  it("an edit still pending at vault close is spliced before the close completes", async () => {
    let now = t0;
    const { c, file, obsidian } = await opened(
      { [PATH]: page("Probably both.") },
      { now: () => now }
    );

    now = at(5);
    await obsidian("Encoding strength, mostly.");
    expect(await file()).not.toContain("· working answer");

    await c.close();
    expect(await file()).toContain(entry(at(5), "Probably both."));
  });

  it("a refused write answers with its refusal and leaves the entry parked", async () => {
    let now = t0;
    const { vault, c, file, obsidian } = await opened(
      { [PATH]: page("Probably both.") },
      { now: () => now }
    );

    now = at(5);
    await obsidian("Encoding strength, mostly.");
    // No thread reads this, so the tick cannot land. The pending Revision
    // must not turn that no into a yes.
    const reply = await c.mutate<{ written: boolean; reason: string }>(
      "researchQuestions.tickThread",
      { path: PATH, text: "Read Cordi.", done: true }
    );
    expect(reply.result?.data).toMatchObject({
      written: false,
      reason: "changedAndUnreapplyable",
    });
    expect(await file()).not.toContain("· working answer");
    expect(pendingRows(vault)).toHaveLength(1);
  });

  it("an own write never raises one: the app's save records its Revision and nothing else", async () => {
    const { vault, c, file } = await opened(
      { [PATH]: page("Probably both.") },
      { now: () => t0 }
    );

    const read = await c.query<ResearchQuestionPage>("researchQuestions.page", {
      path: PATH,
    });
    const data = read.result?.data as ResearchQuestionPage & { readable: true };
    const saved = await c.mutate("researchQuestions.saveWorkingAnswer", {
      path: PATH,
      text: "Encoding strength, mostly.",
      basedOn: data.hash,
    });
    expect(saved.error).toBeUndefined();
    expect(pendingRows(vault)).toEqual([]);
    // One entry, the save's own — not a second one from the index's diff.
    expect((await file()).match(/· working answer/g)).toHaveLength(1);
  });
});

describe("queue.sqlite is not the index", () => {
  it("a pending row survives deleting index.sqlite and rebuilding", async () => {
    let now = t0;
    const { vault, obsidian } = await opened(
      { [PATH]: page("Probably both.") },
      { now: () => now }
    );
    now = at(5);
    await obsidian("Encoding strength, mostly.");
    expect(pendingRows(vault)).toHaveLength(1);

    for (const name of [
      "index.sqlite",
      "index.sqlite-wal",
      "index.sqlite-shm",
    ]) {
      await rm(join(vault, ".vitrine", name), { force: true });
    }
    // A second core on the same vault: its sweep builds the index afresh,
    // and the pending Revision is still owed.
    const rebuilt = await opened({}, { vault, now: () => now });
    expect(pendingRows(vault)).toHaveLength(1);

    now = at(7);
    await rebuilt.appWrite();
    expect(await rebuilt.file()).toContain(entry(at(5), "Probably both."));
  });

  it("a queue.sqlite whose version is not ours is refused, never deleted", async () => {
    const vault = await tmp("foreign-queue");
    const folder = join(vault, ".vitrine");
    await rm(folder, { recursive: true, force: true });
    const { mkdir } = await import("node:fs/promises");
    await mkdir(folder, { recursive: true });
    const foreign = join(folder, "queue.sqlite");
    const db = new DatabaseSync(foreign);
    db.exec("CREATE TABLE from_the_future (x TEXT)");
    db.exec("INSERT INTO from_the_future (x) VALUES ('keep me')");
    db.exec("PRAGMA user_version = 9999");
    db.close();

    const c = await core();
    const reply = await c.mutate<Vault>("vault.open", { path: vault });
    expect(reply.error?.data.kind).toBe("writeFailed");
    expect(reply.error?.message).toContain("queue.sqlite");

    const after = new DatabaseSync(foreign, { readOnly: true });
    expect(after.prepare("SELECT x FROM from_the_future").all()).toEqual([
      { x: "keep me" },
    ]);
    after.close();
  });
});
