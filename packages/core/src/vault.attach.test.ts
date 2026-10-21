import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, tmp, vaultWith } from "./test-core.js";

// Dropping an image on a note copies it to `assets/` (#754; spec #751
// § A new write; ADR 0035's copy, the ninth write): the bytes, a taken name
// suffixed, Obsidian's forbidden characters stripped, the source left where
// it was, two drops of one name stored as two files, anything that is not an
// image refused by name, and the copy the app's own write.

afterEach(closeCores);

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

type Attached = { file: string; path: string };

async function opened(files: Record<string, string> = {}, settleMs?: number) {
  const vault = await vaultWith({ "notes/a.md": "# A\n", ...files });
  const c = await core(settleMs === undefined ? {} : { settleMs });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  return { vault, c };
}

/** A file somewhere outside the vault, as a drop from Downloads would name it. */
async function outside(name: string, bytes: Buffer | string = PNG) {
  const source = join(await tmp("downloads"), name);
  await writeFile(source, bytes);
  return source;
}

const attach = (c: Awaited<ReturnType<typeof opened>>["c"], source: string) =>
  c.mutate<Attached>("vault.attachImage", { source });

describe("vault.attachImage", () => {
  it("copies the image into assets/ at the vault root, creating it, and leaves the source alone", async () => {
    const { vault, c } = await opened();
    const source = await outside("diagram.png");

    const reply = await attach(c, source);

    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toEqual({
      file: "diagram.png",
      path: "assets/diagram.png",
    });
    expect(await readFile(join(vault, "assets", "diagram.png"))).toEqual(PNG);
    expect(await readFile(source)).toEqual(PNG);
  });

  it("takes (2), (3) for a name already stored, and overwrites nothing", async () => {
    const { vault, c } = await opened();
    await mkdir(join(vault, "assets"));
    await writeFile(join(vault, "assets", "image.png"), "first");
    await writeFile(join(vault, "assets", "image (2).png"), "second");
    const source = await outside("image.png");

    const reply = await attach(c, source);

    expect(reply.result?.data.file).toBe("image (3).png");
    expect(await readFile(join(vault, "assets", "image.png"), "utf8")).toBe(
      "first"
    );
    expect(await readFile(join(vault, "assets", "image (3).png"))).toEqual(PNG);
  });

  it("stores two concurrent drops of one name as two files", async () => {
    const { vault, c } = await opened();
    const [a, b] = await Promise.all([
      outside("shot.png", "one"),
      outside("shot.png", "two"),
    ]);

    const replies = await Promise.all([attach(c, a), attach(c, b)]);

    expect(replies.map((r) => r.result?.data.file).sort()).toEqual([
      "shot (2).png",
      "shot.png",
    ]);
    expect((await readdir(join(vault, "assets"))).sort()).toEqual([
      "shot (2).png",
      "shot.png",
    ]);
    const bytes = await Promise.all(
      replies.map((r) => readFile(join(vault, r.result!.data.path), "utf8"))
    );
    expect(bytes.sort()).toEqual(["one", "two"]);
  });

  it("strips the characters Obsidian forbids and a leading dot from the stored name", async () => {
    const { vault, c } = await opened();
    const source = await outside("..Fig #3: a|b?.PNG");

    const reply = await attach(c, source);

    expect(reply.result?.data.file).toBe("Fig 3 ab.PNG");
    expect(await readdir(join(vault, "assets"))).toEqual(["Fig 3 ab.PNG"]);
  });

  it.each(["notes.txt", "paper.pdf", "photo", "archive.png.zip"])(
    "refuses %s by name, and creates nothing",
    async (name) => {
      const { vault, c } = await opened();
      const source = await outside(name);

      const reply = await attach(c, source);

      expect(reply.error?.message).toContain(name);
      expect(reply.error?.message).toMatch(/PNG, JPEG, GIF, WebP or SVG/);
      expect(await readdir(vault)).not.toContain("assets");
    }
  );

  it("accepts each extension the preview draws, in any case", async () => {
    const { c } = await opened();
    for (const name of ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.SVG"]) {
      const reply = await attach(c, await outside(name));
      expect(reply.error).toBeUndefined();
    }
  });

  it("refuses a source that is not a readable file", async () => {
    const { c } = await opened();
    const reply = await attach(c, join(await tmp("nowhere"), "gone.png"));
    expect(reply.error?.message).toBe("gone.png is not a file that can be read.");
  });

  it("refuses to write through an assets/ that is a symlink out of the vault", async () => {
    const { vault, c } = await opened();
    const elsewhere = await tmp("elsewhere");
    await symlink(elsewhere, join(vault, "assets"));

    const reply = await attach(c, await outside("x.png"));

    expect(reply.error).toBeDefined();
    expect(await readdir(elsewhere)).toEqual([]);
  });

  it("is the app's own write: the watcher raises the new file for the tree and nothing for the open note", async () => {
    const { vault, c } = await opened({}, 200);
    const stream = await c.events();

    await attach(c, await outside("diagram.png"));
    expect((await stream.next("vaultChanged")).changed).toEqual([
      "assets/diagram.png",
    ]);

    // The proof of absence (`vault-watcher.test.ts`): the next event is a
    // later, unrelated write's, and names it alone.
    await writeFile(join(vault, "Sentinel.md"), "# Sentinel\n");
    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: ["Sentinel.md"],
      removed: [],
      renamed: [],
    });
    stream.close();
  });

  it("records the copy in the index, so an embed of it resolves at once", async () => {
    const { c } = await opened({ "notes/b.md": "![[diagram.png]]\n" });
    const resolve = () =>
      c.query<Record<string, { resolution: string; path: string | null }>>(
        "vault.resolveLinks",
        { from: "notes/b.md", links: ["diagram.png"] }
      );
    expect((await resolve()).result?.data["diagram.png"]?.resolution).toBe(
      "unresolved"
    );

    await attach(c, await outside("diagram.png"));

    expect((await resolve()).result?.data["diagram.png"]).toMatchObject({
      resolution: "resolved",
      path: "assets/diagram.png",
    });
  });
});
