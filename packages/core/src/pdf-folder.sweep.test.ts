import {
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LooseEnds } from "./loose-ends.js";
import {
  closeCores,
  core,
  deafWatch,
  fixtures,
  linkedPdfVault,
  tmp,
  vaultWith,
} from "./test-core.js";

afterEach(closeCores);

// A sweep follows the PDF folder's link (#572; spec #567; ADR 0013's
// 2026-10-07 update): at open, after a reopen, on *check again* and for a
// refresh above the folder, the one link at `sources/pdf` that leaves the
// vault is followed, and no other. Every case opens a real vault whose
// `sources/pdf` is a real link and reads what a person would see.

const PDF = "%PDF-1.4 a paper\n";
const SOURCE = (pdf: string) =>
  `---\nkind: source\nid: src-1\ncitekey: rasch2013\ntitle: Odor cues\npdf: ${pdf}\n---\n`;
const annotated = () => readFile(join(fixtures, "pdf", "annotated.pdf"));

async function open(vault: string, opts: Parameters<typeof core>[0] = {}) {
  const c = await core({ settleMs: 40, ...opts });
  const reply = await c.mutate("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  const kinds = async () => {
    const r = await c.query<LooseEnds>("looseEnds.rows");
    expect(r.error).toBeUndefined();
    return r.result!.data.groups.flatMap((g) =>
      g.rows.map((row) => `${row.kind} ${row.path ?? row.subject}`)
    );
  };
  const unnamed = async () =>
    (await c.query<string[]>("sources.unnamedPdfs")).result!.data;
  return { c, kinds, unnamed };
}

const noteOf = (vault: string) => readFile(join(vault, "sources/a.md"), "utf8");

describe("a linked PDF folder at open", () => {
  it("reads a PDF in it: one run, the Source's note holds the blocks", async () => {
    const { vault, folder } = await linkedPdfVault({
      "sources/a.md": SOURCE("a.pdf"),
    });
    await writeFile(join(folder, "a.pdf"), await annotated());
    const { c } = await open(vault);
    const events = await c.events();
    void events;
    await vi.waitFor(
      async () => expect(await noteOf(vault)).toMatch(/\^h\d+/),
      { timeout: 4000, interval: 25 }
    );
  });

  it("says nothing is missing for a Source whose PDF is there", async () => {
    const { vault, folder } = await linkedPdfVault({
      "sources/a.md": SOURCE("a.pdf"),
    });
    await writeFile(join(folder, "a.pdf"), PDF);
    const { kinds } = await open(vault);
    expect(await kinds()).toEqual([]);
  });

  it("makes a stray PDF a no-Source row, offered to attach to a stub", async () => {
    const { vault, folder } = await linkedPdfVault();
    await writeFile(join(folder, "stray.pdf"), PDF);
    const { kinds, unnamed } = await open(vault);
    expect(await kinds()).toEqual(["no-source sources/pdf/stray.pdf"]);
    expect(await unnamed()).toEqual(["sources/pdf/stray.pdf"]);
  });

  it("is as clean when opened again after its PDF was read live", async () => {
    const { vault, folder } = await linkedPdfVault({
      "sources/a.md": SOURCE("a.pdf"),
    });
    const first = await open(vault);
    await writeFile(join(folder, "a.pdf"), PDF);
    await vi.waitFor(async () => expect(await first.unnamed()).toEqual([]), {
      timeout: 4000,
      interval: 25,
    });
    await first.c.close();
    const { kinds } = await open(vault);
    expect(await kinds()).toEqual([]);
  });

  it("reports a PDF deleted while the app was closed as missing, linked or plain", async () => {
    const linked = await linkedPdfVault({ "sources/a.md": SOURCE("a.pdf") });
    await writeFile(join(linked.folder, "a.pdf"), PDF);
    const first = await open(linked.vault);
    await first.c.close();
    await rm(join(linked.folder, "a.pdf"));
    expect(await (await open(linked.vault)).kinds()).toEqual([
      "pdf-missing sources/a.md",
    ]);

    const plain = await vaultWith({
      "sources/a.md": SOURCE("a.pdf"),
      "sources/pdf/a.pdf": PDF,
    });
    const second = await open(plain);
    await second.c.close();
    await rm(join(plain, "sources/pdf/a.pdf"));
    expect(await (await open(plain)).kinds()).toEqual([
      "pdf-missing sources/a.md",
    ]);
  });
});

describe("check again through a link", () => {
  it("reads a PDF the watcher never heard", async () => {
    const { vault, folder } = await linkedPdfVault();
    const deaf = deafWatch(vault);
    const { c, unnamed } = await open(vault, { watch: deaf.watch });
    deaf.deafen();
    await writeFile(join(folder, "late.pdf"), PDF);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await unnamed()).toEqual([]);
    expect((await c.mutate("vault.checkAgain")).error).toBeUndefined();
    expect(await unnamed()).toEqual(["sources/pdf/late.pdf"]);
  });
});

describe("a refresh that names an ancestor of the folder", () => {
  it("keeps the linked folder's PDFs when `sources` goes away and comes back", async () => {
    const { vault, folder } = await linkedPdfVault();
    await writeFile(join(folder, "stray.pdf"), PDF);
    const { unnamed } = await open(vault);
    expect(await unnamed()).toEqual(["sources/pdf/stray.pdf"]);
    // The event is for `sources` itself, so the refresh walks down through the link.
    await rename(join(vault, "sources"), join(vault, "moved"));
    await rename(join(vault, "moved"), join(vault, "sources"));
    // The Batch settles with nothing changed, so it raises nothing to wait on.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await unnamed()).toEqual(["sources/pdf/stray.pdf"]);
  });
});

describe("the links a sweep does not follow", () => {
  it("leaves a link to a folder inside the vault as the watcher leaves it", async () => {
    const vault = await tmp("inside");
    await mkdir(join(vault, "sources/real"), { recursive: true });
    await writeFile(join(vault, "sources/real/x.pdf"), PDF);
    await symlink(join(vault, "sources/real"), join(vault, "sources/pdf"));
    const { unnamed } = await open(vault);
    // Its PDFs are not `sources/pdf/…` rows, so nothing is offered.
    expect(await unnamed()).toEqual([]);
  });

  it("does not follow a link elsewhere in the vault, nor one inside the PDF folder", async () => {
    const { vault, folder } = await linkedPdfVault();
    const elsewhere = await tmp("elsewhere");
    const nested = await tmp("nested");
    await writeFile(join(elsewhere, "e.pdf"), PDF);
    await writeFile(join(nested, "n.pdf"), PDF);
    await writeFile(join(folder, "ok.pdf"), PDF);
    await symlink(elsewhere, join(vault, "notes-link"));
    await symlink(nested, join(folder, "inner"));
    const { unnamed } = await open(vault);
    expect(await unnamed()).toEqual(["sources/pdf/ok.pdf"]);
  });

  it("never reads an evicted PDF in a linked folder", async () => {
    const { vault, folder } = await linkedPdfVault();
    const { open: openFile } = await import("node:fs/promises");
    const handle = await openFile(join(folder, "online-only.pdf"), "w");
    await handle.truncate(4 * 1024 * 1024);
    await handle.close();
    await writeFile(join(folder, "keep.pdf"), PDF);
    const { unnamed } = await open(vault);
    // Recorded by path alone, so it is not judged: only the file with bytes is a row.
    expect(await unnamed()).toEqual(["sources/pdf/keep.pdf"]);
  });
});
