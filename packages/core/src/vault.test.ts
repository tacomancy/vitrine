import { chmod, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { core, fakeHost, fingerprint, fixtureCopy, tmp } from "./test-core.js";

type Vault = { name: string; path: string };

describe("vault.current", () => {
  it("is null when nothing has been opened and nothing is remembered", async () => {
    const c = await core();
    const reply = await c.query<Vault | null>("vault.current");
    expect(reply.result?.data).toBeNull();
  });
});

describe("vault.open", () => {
  it("opens an empty folder as the vault, named after the folder", async () => {
    const c = await core();
    const folder = await tmp("empty");

    const opened = await c.mutate<Vault>("vault.open", { path: folder });
    expect(opened.result?.data).toEqual({
      name: basename(folder),
      path: folder,
    });

    const current = await c.query<Vault | null>("vault.current");
    expect(current.result?.data).toEqual({
      name: basename(folder),
      path: folder,
    });
  });

  it("writes nothing into the folder it opens beyond the index under .vitrine/", async () => {
    const c = await core();
    const folder = await tmp("untouched");
    await writeFile(join(folder, "Mine.md"), "# mine\n");
    const before = await fingerprint(folder);
    await c.mutate<Vault>("vault.open", { path: folder });
    await c.indexed();
    // `fingerprint` leaves the index files out; `vault-index.test.ts` pins them.
    expect(await fingerprint(folder)).toEqual([".vitrine/", ...before]);
  });
});

describe("vault.open failures", () => {
  const restore: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const fn of restore.splice(0)) await fn();
  });

  it("refuses a path that is a file, typed notAFolder", async () => {
    const c = await core();
    const file = join(await tmp("file"), "note.md");
    await writeFile(file, "# not a vault\n");

    const reply = await c.mutate<Vault>("vault.open", { path: file });
    expect(reply.error?.data.kind).toBe("notAFolder");
    expect(reply.error?.message).toMatch(/not a folder/i);
  });

  it("refuses a path that does not exist, typed notAFolder", async () => {
    const c = await core();
    const reply = await c.mutate<Vault>("vault.open", {
      path: join(await tmp("gone"), "never-made"),
    });
    expect(reply.error?.data.kind).toBe("notAFolder");
  });

  it("refuses a folder it cannot read, typed unreadable", async () => {
    const c = await core();
    const folder = await tmp("locked");
    await chmod(folder, 0o000);
    restore.push(() => chmod(folder, 0o700));

    const reply = await c.mutate<Vault>("vault.open", { path: folder });
    expect(reply.error?.data.kind).toBe("unreadable");
    expect(reply.error?.message).toMatch(/can't be read|cannot be read/i);
  });

  it("leaves the current vault as it was when a later open fails", async () => {
    const c = await core();
    const good = await tmp("good");
    await c.mutate<Vault>("vault.open", { path: good });

    const file = join(await tmp("file"), "note.md");
    await writeFile(file, "");
    await c.mutate<Vault>("vault.open", { path: file });

    const current = await c.query<Vault | null>("vault.current");
    expect(current.result?.data).toEqual({ name: basename(good), path: good });
  });
});

describe("the remembered vault", () => {
  it("reopens on the next launch", async () => {
    const first = await core();
    const folder = await tmp("remembered");
    await first.mutate<Vault>("vault.open", { path: folder });

    const next = await core({ appSupportDir: first.appSupportDir });
    const current = await next.query<Vault | null>("vault.current");
    expect(current.result?.data).toEqual({
      name: basename(folder),
      path: folder,
    });
  });

  it("yields no vault, silently, when the folder has gone missing", async () => {
    const first = await core();
    const folder = await tmp("moved");
    await first.mutate<Vault>("vault.open", { path: folder });
    await rm(folder, { recursive: true });

    const next = await core({ appSupportDir: first.appSupportDir });
    const current = await next.query<Vault | null>("vault.current");
    expect(current.result?.data).toBeNull();
  });

  it("is untouched by a failed open", async () => {
    const first = await core();
    const good = await tmp("good");
    await first.mutate<Vault>("vault.open", { path: good });
    const file = join(await tmp("file"), "note.md");
    await writeFile(file, "");
    await first.mutate<Vault>("vault.open", { path: file });

    const next = await core({ appSupportDir: first.appSupportDir });
    const current = await next.query<Vault | null>("vault.current");
    expect(current.result?.data).toEqual({ name: basename(good), path: good });
  });

  it("cannot be written → the open fails and the current vault is unchanged", async () => {
    // An app-support path that is a file: nothing can be remembered under it.
    const blocked = join(await tmp("blocked"), "not-a-folder");
    await writeFile(blocked, "");
    const c = await core({ appSupportDir: blocked });
    const folder = await tmp("unremembered");

    const reply = await c.mutate<Vault>("vault.open", { path: folder });
    expect(reply.error).toBeDefined();
    const current = await c.query<Vault | null>("vault.current");
    expect(current.result?.data).toBeNull();
  });

  it("is the most recently opened vault when a second replaces the first", async () => {
    const first = await core();
    const one = await tmp("one");
    const two = await tmp("two");
    await first.mutate<Vault>("vault.open", { path: one });
    await first.mutate<Vault>("vault.open", { path: two });
    expect(
      (await first.query<Vault | null>("vault.current")).result?.data
    ).toEqual({
      name: basename(two),
      path: two,
    });

    const next = await core({ appSupportDir: first.appSupportDir });
    const current = await next.query<Vault | null>("vault.current");
    expect(current.result?.data).toEqual({ name: basename(two), path: two });
  });
});

describe("vault.pick", () => {
  it("opens whatever the host's chooser returns", async () => {
    const folder = await tmp("picked");
    const c = await core({ host: fakeHost(folder) });

    const picked = await c.mutate<Vault | null>("vault.pick");
    expect(picked.result?.data).toEqual({
      name: basename(folder),
      path: folder,
    });
    const current = await c.query<Vault | null>("vault.current");
    expect(current.result?.data).toEqual({
      name: basename(folder),
      path: folder,
    });
  });

  it("returns null and changes nothing when the chooser is cancelled", async () => {
    const c = await core({ host: fakeHost(null) });
    const good = await tmp("kept");
    await c.mutate<Vault>("vault.open", { path: good });

    const picked = await c.mutate<Vault | null>("vault.pick");
    expect(picked.result?.data).toBeNull();
    const current = await c.query<Vault | null>("vault.current");
    expect(current.result?.data).toEqual({ name: basename(good), path: good });
  });

  it("refuses a picked file the same way vault.open does", async () => {
    const file = join(await tmp("file"), "note.md");
    await writeFile(file, "");
    const c = await core({ host: fakeHost(file) });

    const picked = await c.mutate<Vault | null>("vault.pick");
    expect(picked.error?.data.kind).toBe("notAFolder");
  });
});

describe("a vault Obsidian wrote", () => {
  it("opens as it is, and is left exactly as it was but for the index's folder", async () => {
    const vault = await fixtureCopy("obsidian-vault");
    const c = await core();
    const before = await fingerprint(vault);
    expect(before).toContain(".obsidian/");

    const opened = await c.mutate<Vault>("vault.open", { path: vault });
    expect(opened.result?.data).toEqual({
      name: "obsidian-vault",
      path: vault,
    });
    await c.indexed();
    expect(await fingerprint(vault)).toEqual([".vitrine/", ...before].sort());
  });
});
