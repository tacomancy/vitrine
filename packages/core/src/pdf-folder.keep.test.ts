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
  sha256,
  vaultWith,
  withMode,
} from "./test-core.js";

afterEach(closeCores);

// What a sweep makes of a PDF folder at fault (#573; spec #567): it keeps
// the rows under the folder. Each test is the researcher's: a vault is
// opened, the folder changes where the watcher is deaf, *check again* is
// asked, and what is read is what Loose Ends, the attach list and the Source's
// note on disk say.

const annotated = () => readFile(join(fixtures, "pdf/annotated.pdf"));
const resaved = () => readFile(join(fixtures, "pdf/annotated-fewer.pdf"));

const source = (id: string, pdf: string) =>
  `---\nkind: source\nid: ${id}\ncitekey: ${id}\ntitle: ${id}\npdf: ${pdf}\n---\nNotes.\n`;
const SOURCES = {
  "sources/rasch2013.md": source("src-1", "rasch2013.pdf"),
  "sources/other.md": source("src-2", "other.pdf"),
};

type Core = Awaited<ReturnType<typeof core>>;

async function kindsOf(c: Core) {
  const reply = await c.query<LooseEnds>("looseEnds.rows");
  expect(reply.error).toBeUndefined();
  // The rows the PDF folder drives; an annotated fixture adds others (its
  // annotations name no block yet) that say nothing about the folder.
  return reply
    .result!.data.groups.flatMap((g) => g.rows.map((r) => r.kind))
    .filter((kind) =>
      ["pdf-missing", "no-source", "conflict-copy"].includes(kind)
    );
}

const sidecar = (vault: string, id: string) =>
  join(vault, `.vitrine/annotations/${id}.json`);

async function sidecarExists(vault: string, id: string) {
  try {
    await readFile(sidecar(vault, id));
    return true;
  } catch {
    return false;
  }
}

const read = (vault: string, id: string) =>
  vi.waitFor(async () => expect(await sidecarExists(vault, id)).toBe(true), {
    timeout: 4000,
    interval: 25,
  });

/** Open `vault` with a watcher that hears nothing of the PDF folder. */
async function openDeaf(vault: string) {
  const deaf = deafWatch(vault);
  const c = await core({ settleMs: 40, watch: deaf.watch });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  deaf.deafen();
  await c.indexed();
  return c;
}

const checkAgain = async (c: Core) => {
  expect((await c.mutate("vault.checkAgain")).error).toBeUndefined();
  await c.indexed();
};

describe("a sweep keeps the PDF folder's rows while the folder is at fault", () => {
  /** A linked vault with both Sources' PDFs read, then the watcher made deaf. */
  async function readLive() {
    const { vault, folder } = await linkedPdfVault(SOURCES);
    await writeFile(join(folder, "rasch2013.pdf"), await annotated());
    await writeFile(join(folder, "other.pdf"), await annotated());
    const c = await openDeaf(vault);
    await read(vault, "src-1");
    await read(vault, "src-2");
    expect(await kindsOf(c)).toEqual([]);
    return { vault, folder, c };
  }

  it("says nothing of the Sources when the link's target is gone, and reads what changed once it is back", async () => {
    const { vault, folder, c } = await readLive();
    const aside = `${folder}-aside`;
    await rename(folder, aside);
    await checkAgain(c);
    expect(await kindsOf(c)).toEqual([]);
    // Meanwhile one PDF changed and one was deleted.
    await writeFile(join(aside, "rasch2013.pdf"), await resaved());
    await rm(join(aside, "other.pdf"));
    await rename(aside, folder);
    await checkAgain(c);
    await vi.waitFor(async () =>
      expect(await kindsOf(c)).toEqual(["pdf-missing"])
    );
    // The PDF that changed meanwhile is read once the folder is back.
    await vi.waitFor(async () => {
      const { file } = JSON.parse(
        await readFile(sidecar(vault, "src-1"), "utf8")
      ) as { file: { hash: string } };
      expect(file.hash).toBe(sha256(await resaved()));
    });
  });

  it("keeps them when the path leads to a file", async () => {
    const { vault, folder, c } = await readLive();
    const aside = `${folder}-aside`;
    await rename(folder, aside);
    await writeFile(folder, "not a folder");
    await checkAgain(c);
    expect(await kindsOf(c)).toEqual([]);
    expect(await sidecarExists(vault, "src-1")).toBe(true);
  });

  it.skipIf(process.getuid?.() === 0)(
    "keeps them under a plain folder at mode 000, and compares them again once it is readable",
    async () => {
      const vault = await vaultWith(SOURCES);
      const dir = join(vault, "sources/pdf");
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "rasch2013.pdf"), await annotated());
      await writeFile(join(dir, "other.pdf"), await annotated());
      const c = await openDeaf(vault);
      await read(vault, "src-2");
      await withMode(dir, 0o000, async () => {
        await checkAgain(c);
        expect(await kindsOf(c)).toEqual([]);
      });
      await rm(join(dir, "other.pdf"));
      await checkAgain(c);
      expect(await kindsOf(c)).toEqual(["pdf-missing"]);
    }
  );

  it("removes nothing either when the link is re-pointed at nothing while the watcher is live", async () => {
    const { folder, vault } = await linkedPdfVault(SOURCES);
    await writeFile(join(folder, "rasch2013.pdf"), await annotated());
    await writeFile(join(folder, "other.pdf"), await annotated());
    const c = await core({ settleMs: 40 });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    await read(vault, "src-2");
    // The vault's own watch hears the link change, and its Batch is a refresh
    // of `sources/pdf`: stat finds nothing there, under a folder at fault.
    const link = join(vault, "sources/pdf");
    await rm(link);
    await symlink(`${folder}-gone`, link);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await kindsOf(c)).toEqual([]);
  });

  it("still says PDF missing once sources/pdf is not there at all", async () => {
    const { vault, folder } = await linkedPdfVault(SOURCES);
    await writeFile(join(folder, "rasch2013.pdf"), await annotated());
    await writeFile(join(folder, "other.pdf"), await annotated());
    const first = await core({ settleMs: 40 });
    await first.mutate("vault.open", { path: vault });
    await first.indexed();
    await read(vault, "src-2");
    await first.close();
    // The link itself removed: an absent folder is not a fault.
    await rm(join(vault, "sources/pdf"));
    const again = await core({ settleMs: 40 });
    await again.mutate("vault.open", { path: vault });
    await again.indexed();
    expect(await kindsOf(again)).toEqual(["pdf-missing", "pdf-missing"]);
  });

  it("says PDF missing at once for one deleted while the folder resolves", async () => {
    const { folder, c } = await readLive();
    await rm(join(folder, "other.pdf"));
    await checkAgain(c);
    expect(await kindsOf(c)).toEqual(["pdf-missing"]);
  });
});
