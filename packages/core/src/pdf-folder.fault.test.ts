import { DatabaseSync } from "node:sqlite";
import {
  chmod,
  mkdir,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PdfFolder } from "./pdf-folder.js";
import { QUEUE_SCHEMA_VERSION } from "./queue.js";
import { closeCores, core, tmp } from "./test-core.js";

// A PDF folder that does not resolve (#379; spec #363 stories 28–36): each
// way it can fail is a fault with its own reason, the reason never carries a
// path (ADR 0028), and the last arrival outlives the break because
// `queue.sqlite` remembers it.

afterEach(closeCores);

type Core = Awaited<ReturnType<typeof core>>;

/** A vault whose `sources/pdf` is a link to `target`, opened and read. */
async function linkedTo(target: string) {
  const vault = await tmp("pdfs");
  await mkdir(join(vault, "sources"), { recursive: true });
  await symlink(target, join(vault, "sources/pdf"));
  const c = await core({ settleMs: 40 });
  const reply = await c.mutate("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  return { vault, c };
}

async function pdfFolder(c: Core) {
  const reply = await c.query<PdfFolder>("vault.pdfFolder");
  expect(reply.error).toBeUndefined();
  return reply.result!.data;
}

async function pdf(folder: string, name: string, at: Date) {
  await writeFile(join(folder, name), "%PDF-1.7\n");
  await utimes(join(folder, name), at, at);
}

type Stream = Awaited<ReturnType<Core["events"]>>;

/**
 * The next check that found `kind` (null: found none). Every check is
 * raised, and the open's own may land after the stream connects, so a test
 * waits for the finding it is about rather than for the next check.
 */
async function found(stream: Stream, kind: string | null) {
  for (;;) {
    const event = await stream.next("pdfFolder", { timeoutMs: 4000 });
    if ((event.fault?.kind ?? null) === kind) return event;
  }
}

/** No reason may say where anything is on this machine (ADR 0028). */
function expectNoPath(reason: string, ...paths: string[]) {
  expect(reason).not.toMatch(/\//);
  for (const path of paths) expect(reason).not.toContain(path);
}

describe("the three faults", () => {
  it("a link whose target is gone is target-gone: nothing resolved, nothing counted", async () => {
    const target = join(await tmp("gone"), "Papers");
    const { c } = await linkedTo(target);
    const folder = await pdfFolder(c);
    expect(folder).toMatchObject({
      exists: true,
      link: target,
      resolves: null,
      holds: null,
      fault: { kind: "target-gone" },
    });
    if (!folder.exists || folder.fault === null) throw new Error("no fault");
    expect(folder.fault.reason).toBe(
      "the PDF folder is a link to a folder that no longer exists"
    );
    expect(folder.fault.resolvesTo).toBe(
      "nothing — the link's target no longer exists"
    );
    expectNoPath(folder.fault.reason, target);
    expectNoPath(folder.fault.resolvesTo, target);
  });

  it("a link to a file is not-a-folder", async () => {
    const file = join(await tmp("file"), "papers.pdf");
    await writeFile(file, "%PDF-1.7\n");
    const { c } = await linkedTo(file);
    const folder = await pdfFolder(c);
    expect(folder).toMatchObject({
      resolves: null,
      holds: null,
      fault: { kind: "not-a-folder" },
    });
    if (!folder.exists || folder.fault === null) throw new Error("no fault");
    expectNoPath(folder.fault.reason, file);
    expectNoPath(folder.fault.resolvesTo, file);
  });

  it.skipIf(process.getuid?.() === 0)(
    "a folder the app cannot list is unreadable",
    async () => {
      const target = await tmp("locked");
      const { c } = await linkedTo(target);
      await chmod(target, 0o000);
      try {
        const folder = await pdfFolder(c);
        expect(folder).toMatchObject({
          resolves: null,
          holds: null,
          fault: { kind: "unreadable" },
        });
        if (!folder.exists || folder.fault === null) throw new Error();
        expectNoPath(folder.fault.reason, target);
      } finally {
        await chmod(target, 0o755);
      }
    }
  );

  it("a folder that resolves has no fault", async () => {
    const { c } = await linkedTo(await tmp("fine"));
    expect(await pdfFolder(c)).toMatchObject({ fault: null });
  });
});

describe("noticing the break, and its end", () => {
  it("the sweep reports target-gone on the event stream, and its clearing when the target is back", async () => {
    const target = await tmp("papers");
    const { c } = await linkedTo(target);
    const stream = await c.events();
    await rm(target, { recursive: true });

    expect((await c.mutate("vault.sweep")).error).toBeUndefined();
    expect((await found(stream, "target-gone")).fault?.reason).toBeDefined();

    await mkdir(target);
    await c.mutate("vault.sweep");
    await found(stream, null);
    expect(await pdfFolder(c)).toMatchObject({
      fault: null,
      holds: { count: 0 },
    });
    stream.close();
  });

  it("the window coming to the front checks too", async () => {
    const target = await tmp("papers");
    const { c } = await linkedTo(target);
    const stream = await c.events();
    await rm(target, { recursive: true });
    await c.focused();
    expect((await found(stream, "target-gone")).fault?.reason).toBeDefined();
    stream.close();
  });

  it("a link broken at open is watched once it resolves again", async () => {
    // The researcher's own fix: a sync folder renamed away, so the link
    // dangles at open, and then renamed back to where the link points.
    const parent = await tmp("later");
    const target = join(parent, "Papers");
    await mkdir(join(parent, "Papers (moved)"));
    const { c } = await linkedTo(target);
    const stream = await c.events();
    await rename(join(parent, "Papers (moved)"), target);
    await c.mutate("vault.sweep");
    await found(stream, null);
    await c.indexed();

    // Only a watch on where the link now leads can hear the target go
    // again with nothing else asked: no sweep, no focus. A paper that
    // arrived just after the watch came up is not what is waited on —
    // FSEvents may fold it into an event on the folder itself.
    await pdf(target, "walker2017.pdf", new Date());
    await rm(target, { recursive: true });
    await found(stream, "target-gone");
    stream.close();
  });
});

describe("the last arrival", () => {
  it("is remembered as a PDF settles, and still answers once the target is gone", async () => {
    const target = await tmp("papers");
    await pdf(target, "walker2017.pdf", new Date("2026-09-20T10:00Z"));
    const { c } = await linkedTo(target);
    const stream = await c.events();

    // Arrives while the vault is open; nothing reads the folder but the watch.
    await pdf(target, "ramirez2024.pdf", new Date("2026-09-27T16:40Z"));
    // The watch settles it into the index, and the check that follows is
    // the first after it on the stream: every earlier one is skipped past.
    await stream.next("vaultChanged", { timeoutMs: 4000 });
    await stream.next("pdfFolder", { timeoutMs: 4000 });

    await rm(target, { recursive: true });
    await c.mutate("vault.sweep");
    await found(stream, "target-gone");
    stream.close();
    expect(await pdfFolder(c)).toMatchObject({
      fault: { kind: "target-gone" },
      holds: null,
      lastArrived: {
        at: "2026-09-27T16:40:00.000Z",
        name: "ramirez2024.pdf",
        beforeFault: true,
      },
    });
  });

  it("outlives the app: a later open of the broken vault still says when papers last came", async () => {
    const target = await tmp("papers");
    await pdf(target, "walker2017.pdf", new Date("2026-09-20T10:00Z"));
    const { vault, c } = await linkedTo(target);
    expect(await pdfFolder(c)).toMatchObject({
      lastArrived: { name: "walker2017.pdf", beforeFault: false },
    });
    await c.close();
    await rm(target, { recursive: true });

    const again = await core({ settleMs: 40 });
    await again.mutate("vault.open", { path: vault });
    await again.indexed();
    expect(await pdfFolder(again)).toMatchObject({
      fault: { kind: "target-gone" },
      lastArrived: { name: "walker2017.pdf", beforeFault: true },
    });
  });

  it("follows the folder when it resolves: the folder is the truth", async () => {
    const target = await tmp("papers");
    await pdf(target, "walker2017.pdf", new Date("2026-09-20T10:00Z"));
    const { c } = await linkedTo(target);
    await rm(join(target, "walker2017.pdf"));
    expect(await pdfFolder(c)).toMatchObject({
      fault: null,
      lastArrived: null,
    });
  });
});

describe("queue.sqlite", () => {
  it("migrates a version-2 queue by adding the last-arrival record", async () => {
    const vault = await tmp("old-queue");
    await mkdir(join(vault, ".vitrine"), { recursive: true });
    const file = join(vault, ".vitrine/queue.sqlite");
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE pending_revisions (
        id INTEGER PRIMARY KEY, path TEXT NOT NULL, field TEXT NOT NULL,
        from_text TEXT NOT NULL, at TEXT NOT NULL
      );
      CREATE INDEX pending_revisions_path ON pending_revisions (path);
      CREATE TABLE open_days (day TEXT PRIMARY KEY);
      INSERT INTO open_days (day) VALUES ('2026-09-20');
      PRAGMA user_version = 2;
    `);
    old.close();

    const c = await core();
    expect(
      (await c.mutate("vault.open", { path: vault })).error
    ).toBeUndefined();
    await c.indexed();
    await closeCores();

    const db = new DatabaseSync(file);
    try {
      expect(QUEUE_SCHEMA_VERSION).toBe(3);
      expect(
        (db.prepare("PRAGMA user_version").get() as { user_version: number })
          .user_version
      ).toBe(3);
      expect(db.prepare("SELECT * FROM last_arrival").all()).toEqual([]);
      expect(db.prepare("SELECT day FROM open_days").all()).toContainEqual({
        day: "2026-09-20",
      });
    } finally {
      db.close();
    }
  });
});

describe("Loose Ends", () => {
  it("gains no row for a broken PDF folder: the footer is the one place it is raised", async () => {
    const { c } = await linkedTo(join(await tmp("gone"), "Papers"));
    const reply = await c.query("looseEnds.rows");
    expect(reply.error).toBeUndefined();
    expect(JSON.stringify(reply.result!.data)).not.toMatch(
      /pdf|arriving|resolv/i
    );
  });
});
