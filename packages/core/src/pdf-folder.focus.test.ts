import { open as openFile, readFile, rm, writeFile } from "node:fs/promises";
import { watch as fsWatch, type WatchListener } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LooseEnds } from "./loose-ends.js";
import {
  closeCores,
  core,
  deafWatch,
  fixtures,
  linkedPdfVault,
  NEXT_TIMEOUT_MS,
  vaultWith,
  type EventStream,
} from "./test-core.js";

afterEach(closeCores);

// The window coming to the front sweeps the PDF folder (#575; spec #568; ADR
// 0013's 2026-10-07 update): the catch-up for what the watcher never heard.
// Every case drives `core()` with a watcher that is deaf to the PDF folder and
// calls `focused()`, the function the shell's `focus` message calls.

const PDF = "%PDF-1.4 a paper\n";
const SOURCE = (key: string, id = `src-${key}`) =>
  `---\nkind: source\nid: ${id}\ncitekey: ${key}\ntitle: ${key}\npdf: ${key}.pdf\n---\n`;
const annotated = () => readFile(join(fixtures, "pdf", "annotated.pdf"));
/** The markups and notes in `annotated.pdf`: a block to each. */
const ANNOTATED_BLOCKS = 6;
/** Long enough for an event that should have come; a quiet check waits this. */
const QUIET_MS = 1500;

/** A plain vault with a `sources/pdf` to write into, as a researcher's has. */
const plain = (files: Record<string, string> = {}) =>
  vaultWith({ "sources/pdf/.keep": "", ...files });

async function opened(
  vault: string,
  opts: Parameters<typeof core>[0] = {}
): Promise<{ c: Awaited<ReturnType<typeof core>> }> {
  const c = await core({ settleMs: 40, ...opts });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  // A vault that is not watching is never current: its walk is done instead.
  await vi.waitFor(
    async () =>
      expect(
        (await c.query<{ indexing: unknown }>("vault.status")).result!.data
          .indexing
      ).toBeNull(),
    { timeout: 4000, interval: 25 }
  );
  return { c };
}

async function kinds(c: Awaited<ReturnType<typeof core>>) {
  const r = await c.query<LooseEnds>("looseEnds.rows");
  return r.result!.data.groups.flatMap((g) =>
    g.rows.map((row) => `${row.kind} ${row.path ?? row.subject}`)
  );
}

/** Read events until none comes for a while: what the open and the test's own writes raised. */
async function drain(stream: EventStream) {
  for (;;) {
    try {
      await stream.next(undefined, { timeoutMs: 600 });
    } catch {
      return;
    }
  }
}

/** Focus, then wait for the status the sweep raises: what it did is settled after it. */
async function focusAndWait(
  c: Awaited<ReturnType<typeof core>>,
  stream: EventStream
) {
  await drain(stream);
  await c.focused();
  await stream.next("vaultStatus");
}

const quiet = (
  stream: EventStream,
  type: "vaultChanged" | "ingestLanded" | "vaultStatus"
) => expect(stream.next(type, { timeoutMs: QUIET_MS })).rejects.toThrow();

describe("a PDF the watcher never heard, on focus", () => {
  it("is read in a plain folder: one run, one summary", async () => {
    const vault = await plain({ "sources/a.md": SOURCE("a") });
    const deaf = deafWatch(vault);
    const { c } = await opened(vault, { watch: deaf.watch });
    const stream = await c.events();
    deaf.deafen();
    await writeFile(join(vault, "sources/pdf/a.pdf"), await annotated());
    await new Promise((resolve) => setTimeout(resolve, 300));
    await quiet(stream, "ingestLanded");

    await drain(stream);
    await c.focused();
    const landed = await stream.next("ingestLanded", {
      timeoutMs: NEXT_TIMEOUT_MS,
    });
    expect(landed.summary.new).toBe(ANNOTATED_BLOCKS);
    expect(landed.sources).toEqual(["sources/a.md"]);
    await quiet(stream, "ingestLanded");
    stream.close();
  });

  it("is read in a linked folder", async () => {
    const { vault, folder } = await linkedPdfVault({
      "sources/a.md": SOURCE("a"),
    });
    const deaf = deafWatch(vault);
    const { c } = await opened(vault, { watch: deaf.watch });
    const stream = await c.events();
    deaf.deafen();
    await writeFile(join(folder, "a.pdf"), await annotated());
    await new Promise((resolve) => setTimeout(resolve, 300));

    await drain(stream);
    await c.focused();
    const landed = await stream.next("ingestLanded", {
      timeoutMs: NEXT_TIMEOUT_MS,
    });
    expect(landed.summary.new).toBe(ANNOTATED_BLOCKS);
    stream.close();
  });

  it("is a no-Source row when no Source names it", async () => {
    const vault = await plain({});
    const deaf = deafWatch(vault);
    const { c } = await opened(vault, { watch: deaf.watch });
    const stream = await c.events();
    deaf.deafen();
    await writeFile(join(vault, "sources/pdf/stray.pdf"), PDF);
    await focusAndWait(c, stream);
    expect(await kinds(c)).toEqual(["no-source sources/pdf/stray.pdf"]);
    stream.close();
  });

  it("is PDF missing when it was deleted", async () => {
    const vault = await plain({
      "sources/a.md": SOURCE("a"),
      "sources/pdf/a.pdf": PDF,
    });
    const deaf = deafWatch(vault);
    const { c } = await opened(vault, { watch: deaf.watch });
    expect(await kinds(c)).toEqual([]);
    const stream = await c.events();
    deaf.deafen();
    await rm(join(vault, "sources/pdf/a.pdf"));
    await focusAndWait(c, stream);
    expect(await kinds(c)).toEqual(["pdf-missing sources/a.md"]);
    stream.close();
  });
});

describe("a focus that finds nothing", () => {
  it("raises no vaultChanged and no ingestLanded, and leaves the vault current", async () => {
    const vault = await plain({
      "sources/a.md": SOURCE("a"),
      "sources/pdf/a.pdf": PDF,
    });
    const { c } = await opened(vault);
    const stream = await c.events();
    await focusAndWait(c, stream);
    await quiet(stream, "vaultChanged");
    await quiet(stream, "ingestLanded");
    const status = await c.query<{ current: { ok: boolean } }>("vault.status");
    expect(status.result!.data.current.ok).toBe(true);
    stream.close();
  });
});

describe("what a focus does not read", () => {
  it("leaves an Evicted PDF alone until its bytes are on disk", async () => {
    const vault = await plain({});
    const deaf = deafWatch(vault);
    const { c } = await opened(vault, { watch: deaf.watch });
    const stream = await c.events();
    deaf.deafen();
    const path = join(vault, "sources/pdf/online-only.pdf");
    // Allocated size far under its length: the placeholder a sync client leaves.
    const handle = await openFile(path, "w");
    await handle.truncate(4 * 1024 * 1024);
    await handle.close();
    await focusAndWait(c, stream);
    expect(await kinds(c)).toEqual([]);

    await writeFile(path, PDF);
    await focusAndWait(c, stream);
    expect(await kinds(c)).toEqual(["no-source sources/pdf/online-only.pdf"]);
    stream.close();
  });

  it("does not apply a Markdown file changed while the watcher was deaf", async () => {
    const vault = await plain({});
    // Deaf to everything, unlike `deafWatch`, which leaves the Markdown heard.
    let deaf = false;
    const watch = ((
      folder: string,
      options: { recursive: boolean },
      listener: WatchListener<string>
    ) =>
      fsWatch(folder, options, (kind, name) => {
        if (!deaf) listener(kind, name);
      })) as typeof fsWatch;
    const { c } = await opened(vault, { watch });
    const stream = await c.events();
    deaf = true;
    // A Source naming a PDF that is not there: applied, it is a PDF missing row.
    await writeFile(join(vault, "sources/b.md"), SOURCE("b"));
    await focusAndWait(c, stream);
    expect(await kinds(c)).toEqual([]);
    // Control: something that does read the vault finds it, so the above is not vacuous.
    await c.mutate("vault.checkAgain");
    expect(await kinds(c)).toEqual(["pdf-missing sources/b.md"]);
    stream.close();
  });

  it("reads no Source whose sidecar is behind its PDF: no run for every Source follows", async () => {
    const vault = await plain({ "sources/a.md": SOURCE("a", "src-a") });
    await writeFile(join(vault, "sources/pdf/a.pdf"), await annotated());
    const { c } = await opened(vault);
    // The open read it; take the sidecar away so a run for every Source would read it again.
    await vi.waitFor(
      async () =>
        expect(
          await readFile(join(vault, ".vitrine/annotations/src-a.json"), "utf8")
        ).toBeTruthy(),
      { timeout: 4000, interval: 25 }
    );
    await rm(join(vault, ".vitrine/annotations/src-a.json"));
    const stream = await c.events();
    await focusAndWait(c, stream);
    await quiet(stream, "ingestLanded");
    stream.close();
  });
});

describe("when the sweep does not run, or runs anyway", () => {
  it("sweeps nothing and removes no row while the folder is at fault", async () => {
    const { vault, folder } = await linkedPdfVault({
      "sources/a.md": SOURCE("a"),
    });
    await writeFile(join(folder, "a.pdf"), PDF);
    const deaf = deafWatch(vault);
    const { c } = await opened(vault, { watch: deaf.watch });
    expect(await kinds(c)).toEqual([]);
    const stream = await c.events();
    deaf.deafen();
    await rm(folder, { recursive: true });
    await drain(stream);
    await c.focused();
    // The fault is raised, and nothing after it swept the folder.
    expect((await stream.next("pdfFolder")).fault).not.toBeNull();
    await quiet(stream, "vaultStatus");
    expect(await kinds(c)).not.toContain("pdf-missing sources/a.md");
    stream.close();
  });

  it("still sweeps when the vault is not watching", async () => {
    const vault = await plain({});
    const { c } = await opened(vault, {
      watch: () => {
        throw new Error("EMFILE: too many open files");
      },
    });
    const stream = await c.events();
    await writeFile(join(vault, "sources/pdf/late.pdf"), PDF);
    await focusAndWait(c, stream);
    expect(await kinds(c)).toEqual(["no-source sources/pdf/late.pdf"]);
    stream.close();
  });
});
