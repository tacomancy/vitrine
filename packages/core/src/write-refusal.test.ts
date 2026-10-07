import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSidecar } from "./annotation-sidecar.js";
import {
  closeCores,
  core,
  fixtures,
  tmp,
  withMode,
  type Reply,
} from "./test-core.js";

// A write the filesystem will not take reaches a surface in the app's words,
// not in Node's (#542). `credentials.setModel`, the Reader's rewrite of a PDF
// and the annotation sidecar's write each let the errno out of the procedure
// unwrapped: an INTERNAL_SERVER_ERROR whose message was Node's text, the
// machine's absolute path included — on a surface, in a screenshot, in a bug
// report (ADR 0028; #288 and #530 were the same defect on other writers).
// Every one is a VaultError now, through the router.

// The one place a test reaches below the router, as `questions.atomic.test.ts`
// does for `rename`: a full disk fails a write *after* its temp file is made,
// and no router call can arrange that. Every other write passes through.
const fs = vi.hoisted(() => ({
  writeFile: vi.fn<(...args: unknown[]) => Promise<void>>(),
  actual: null as unknown as typeof import("node:fs/promises"),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  fs.actual = await importOriginal<typeof import("node:fs/promises")>();
  fs.writeFile.mockImplementation(fs.actual.writeFile as never);
  return { ...fs.actual, writeFile: fs.writeFile };
});

afterEach(async () => {
  fs.writeFile.mockImplementation(fs.actual.writeFile as never);
  await closeCores();
});

/**
 * A full disk, as an atomic write meets it: the temp file it makes in `folder`
 * is created and then the write fails, in Node's own shape — a syscall and no
 * path, so there is nothing for the cut to take out. Only the next write into
 * `folder` is touched.
 */
function failNextWriteInto(folder: string) {
  let taken = false;
  fs.writeFile.mockImplementation(async (...args) => {
    const [path, , options] = args;
    if (taken || dirname(String(path)) !== folder) {
      return fs.actual.writeFile(
        ...(args as Parameters<typeof fs.actual.writeFile>)
      );
    }
    taken = true;
    await fs.actual.writeFile(
      String(path),
      "",
      options as Parameters<typeof fs.actual.writeFile>[2]
    );
    throw Object.assign(new Error("ENOSPC: no space left on device, write"), {
      errno: -28,
      code: "ENOSPC",
      syscall: "write",
    });
  });
}

/**
 * What a surface shows for a refused write: these words, as a refusal, and
 * nothing of where the vault or the app's own folder is. The equality says the
 * last already, but a message loosened to a `toContain` later should still
 * fail on a path.
 *
 * The code is asserted because the kind cannot say it: a procedure that
 * forgets `refusing` still answers the VaultError's words and kind (tRPC
 * keeps it as the error's cause, which the formatter reads) and is an
 * INTERNAL_SERVER_ERROR all the same.
 */
function refusedAs(reply: Reply<unknown>, message: string, where: string) {
  expect(reply.result).toBeUndefined();
  expect(reply.error?.message).toBe(message);
  expect(reply.error?.data).toMatchObject({
    code: "BAD_REQUEST",
    kind: "writeFailed",
  });
  for (const part of [where, dirname(where), basename(where)]) {
    expect(reply.error?.message).not.toContain(part);
  }
}

const SET_MODEL = { provider: "anthropic", model: "claude-sonnet-5" };

/**
 * An app-support folder under a home folder named as one can be: the
 * apostrophe in `O'Brien` is what a cut that stopped at the path's first quote
 * would stumble on, and print the rest of (ADR 0028).
 */
async function supportFolder() {
  const folder = join(
    await tmp("support"),
    "O'Brien",
    "Application Support",
    "Vitrine"
  );
  await mkdir(folder, { recursive: true });
  return folder;
}

describe("credentials.setModel", () => {
  // `writeAtomically` makes a temp file beside `providers.json`, so it is the
  // folder's mode that stops it, and Node names that temp file.
  it.skipIf(process.getuid?.() === 0)(
    "refuses a folder the mode shuts, naming no path",
    async () => {
      const folder = await supportFolder();
      const c = await core({ appSupportDir: folder });

      const reply = await withMode(folder, 0o555, () =>
        c.mutate("credentials.setModel", SET_MODEL)
      );

      refusedAs(
        reply,
        "Couldn't save the model: EACCES: permission denied",
        folder
      );
    }
  );

  // ENOENT keeps its cause, as it does for every write ADR 0028 gives no words
  // of its own.
  it("keeps the cause of a folder that is gone", async () => {
    const folder = join(await supportFolder(), "gone");
    const c = await core({ appSupportDir: folder });

    const reply = await c.mutate("credentials.setModel", SET_MODEL);

    refusedAs(
      reply,
      "Couldn't save the model: ENOENT: no such file or directory",
      folder
    );
  });

  it("refuses a full disk with the disk's reason", async () => {
    const folder = await supportFolder();
    const c = await core({ appSupportDir: folder });
    failNextWriteInto(folder);

    const reply = await c.mutate("credentials.setModel", SET_MODEL);

    refusedAs(
      reply,
      "Couldn't save the model: ENOSPC: no space left on device, write",
      folder
    );
  });
});

const SOURCE = `---
kind: source
id: src-1
citekey: rasch2013
title: Odor cues during slow-wave sleep
pdf: rasch2013.pdf
---
Notes I typed.
`;
const NOTE = "sources/rasch2013.md";
const PDF = "sources/pdf/rasch2013.pdf";
const LINE_ONE = [60, 696, 560, 714];
const LINE_TWO = [60, 678, 560, 696];

/**
 * A vault named as the real one is, apostrophe and all (`Wan Shi Tong's
 * Library`): a cut that stopped at a path's first quote would pass every other
 * fixture and print this one's whole path (ADR 0028). Opened, and its own
 * Ingest finished: that run writes the sidecar, and a failure armed before it
 * had landed would be used up there and not by the call under test.
 */
async function opened() {
  const vault = join(await tmp("write-refusal"), "Wan Shi Tong's Library");
  await mkdir(join(vault, "sources/pdf"), { recursive: true });
  await writeFile(join(vault, NOTE), SOURCE);
  await writeFile(
    join(vault, PDF),
    await readFile(join(fixtures, "pdf", "synthetic-body.pdf"))
  );
  const c = await core({ settleMs: 40, author: "Sarah Lehman" });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  await vi.waitFor(
    async () => {
      expect((await readSidecar(vault, "src-1"))?.file.hash).toBeTruthy();
    },
    { timeout: 3000 }
  );
  const highlight = (rect: number[]) =>
    c.mutate<{ id: string }>("sources.highlight", {
      path: NOTE,
      page: 1,
      rects: [rect],
      colour: "green",
      note: "",
    });
  return { vault, c, highlight };
}

type Opened = Awaited<ReturnType<typeof opened>>;

/**
 * Every Reader act that rewrites the PDF, given the id of a highlight already
 * in it: a recolour and a removal have one to act on, and a second highlight
 * lands in a file that has one.
 */
const REWRITES = [
  { call: "sources.highlight", run: (t: Opened) => t.highlight(LINE_ONE) },
  {
    call: "sources.amend",
    run: (t: Opened, annotation: string) =>
      t.c.mutate("sources.amend", { path: NOTE, annotation, colour: "pink" }),
  },
  {
    call: "sources.removeAnnotation",
    run: (t: Opened, annotation: string) =>
      t.c.mutate("sources.removeAnnotation", {
        path: NOTE,
        annotation,
        confirmed: true,
      }),
  },
];

describe("a Reader act that rewrites the PDF", () => {
  // The temp file is made beside the PDF, so it is the folder's mode that
  // stops the write, and Node names the temp file and not the PDF.
  describe.skipIf(process.getuid?.() === 0)("a folder the mode shuts", () => {
    it.each(REWRITES)(
      "$call names the PDF it could not write",
      async ({ run }) => {
        const t = await opened();
        const { id } = (await t.highlight(LINE_TWO)).result!.data;

        const reply = await withMode(join(t.vault, "sources/pdf"), 0o555, () =>
          run(t, id)
        );

        refusedAs(
          reply,
          "Couldn't write sources/pdf/rasch2013.pdf: EACCES: permission denied",
          t.vault
        );
      }
    );
  });

  it.each(REWRITES)(
    "$call refuses a full disk with the disk's reason",
    async ({ run }) => {
      const t = await opened();
      const { id } = (await t.highlight(LINE_TWO)).result!.data;
      failNextWriteInto(join(t.vault, "sources/pdf"));

      const reply = await run(t, id);

      refusedAs(
        reply,
        "Couldn't write sources/pdf/rasch2013.pdf: ENOSPC: no space left on device, write",
        t.vault
      );
    }
  );
});

describe("the annotation sidecar's write", () => {
  const FOLDER = ".vitrine/annotations";

  // Two procedures that record themselves in the one sidecar. The wrap lives
  // in the writer, so a second reach is covered without having been told.
  const RECORDINGS = [
    { call: "sources.highlight", run: (t: Opened) => t.highlight(LINE_TWO) },
    {
      call: "sources.readingPosition",
      run: (t: Opened) =>
        t.c.mutate("sources.readingPosition", {
          path: NOTE,
          page: 1,
          offset: 0.5,
        }),
    },
  ];

  // The temp file is made beside the sidecar, so it is the folder's mode that
  // stops the write, and Node names the temp file and not the Source's.
  describe.skipIf(process.getuid?.() === 0)("a folder the mode shuts", () => {
    it.each(RECORDINGS)(
      "$call names the file it could not write",
      async ({ run }) => {
        const t = await opened();

        const reply = await withMode(join(t.vault, FOLDER), 0o555, () =>
          run(t)
        );

        refusedAs(
          reply,
          "Couldn't write .vitrine/annotations/src-1.json: EACCES: permission denied",
          t.vault
        );
      }
    );
  });

  // The PDF is rewritten first and lands; it is the record of it that the
  // disk cannot take, and the next Ingest makes it.
  it("sources.highlight refuses a full disk with the disk's reason", async () => {
    const t = await opened();
    failNextWriteInto(join(t.vault, FOLDER));

    const reply = await t.highlight(LINE_TWO);

    refusedAs(
      reply,
      "Couldn't write .vitrine/annotations/src-1.json: ENOSPC: no space left on device, write",
      t.vault
    );
  });

  // The open's own Ingest has made the folder, so this takes it away: the
  // next write has to make it again, under a parent it may not write to.
  describe.skipIf(process.getuid?.() === 0)("no folder yet", () => {
    it("sources.highlight names the folder it could not create", async () => {
      const t = await opened();
      await rm(join(t.vault, FOLDER), { recursive: true });

      const reply = await withMode(join(t.vault, ".vitrine"), 0o555, () =>
        t.highlight(LINE_TWO)
      );

      refusedAs(
        reply,
        "Couldn't create .vitrine/annotations/: EACCES: permission denied",
        t.vault
      );
    });
  });

  // A dangling link where the folder should be cannot be made one: `mkdir -p`
  // answers ENOENT, for any user, root included. ENOENT keeps its cause, as it
  // does for every write ADR 0028 gives no words of its own.
  it("sources.highlight names the folder it could not create, keeping ENOENT's cause", async () => {
    const t = await opened();
    await rm(join(t.vault, FOLDER), { recursive: true });
    await symlink(join(t.vault, "nowhere"), join(t.vault, FOLDER));

    const reply = await t.highlight(LINE_TWO);

    refusedAs(
      reply,
      "Couldn't create .vitrine/annotations/: ENOENT: no such file or directory",
      t.vault
    );
  });
});
