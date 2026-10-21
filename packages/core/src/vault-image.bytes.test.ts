import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, tmp, vaultWith } from "./test-core.js";

// The bytes route's vault-image case (#752; spec #751 § Serving the bytes): a
// note's `![[diagram.png]]` is drawn from bytes the renderer fetches behind
// the bearer header, so the route serves an image under the vault and nothing
// else — no other extension, nothing outside the vault, no symlink out.

afterEach(closeCores);

const auth = { authorization: "Bearer test-token" };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);

async function opened() {
  const vault = await vaultWith({
    "notes/a.md": "![[diagram.png]]\n",
    "notes/secret.txt": "not an image",
    ".hidden/x.png": "x",
  });
  await mkdir(join(vault, "assets"), { recursive: true });
  await writeFile(join(vault, "assets", "diagram.png"), PNG);
  await writeFile(join(vault, "assets", "my pic (2).webp"), PNG);
  const c = await core();
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  return { vault, c };
}

const get = (c: Awaited<ReturnType<typeof opened>>["c"], path: string) =>
  c.raw(`/vault-image/${path}`, { headers: auth });

describe("the vault-image bytes route", () => {
  it("serves an image under the vault behind the bearer header, typed by its extension", async () => {
    const { c } = await opened();
    const res = await get(c, "assets/diagram.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PNG);
  });

  it("serves a name with spaces in it", async () => {
    const { c } = await opened();
    const res = await get(c, encodeURI("assets/my pic (2).webp"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
  });

  it("needs the bearer header, and never takes the token from the URL", async () => {
    const { c } = await opened();
    expect((await c.raw("/vault-image/assets/diagram.png")).status).toBe(401);
    expect(
      (await c.raw("/vault-image/assets/diagram.png?token=test-token")).status
    ).toBe(401);
  });

  it("refuses a non-image extension", async () => {
    const { c } = await opened();
    for (const path of ["notes/secret.txt", "notes/a.md"]) {
      expect((await get(c, path)).status, path).toBe(404);
    }
  });

  it("refuses a path outside the vault, a dot-entry and a missing file", async () => {
    const { c } = await opened();
    for (const path of [
      "assets/../../outside.png",
      "assets/%2e%2e/%2e%2e/outside.png",
      ".hidden/x.png",
      "assets/missing.png",
    ]) {
      expect((await get(c, path)).status, path).toBe(404);
    }
  });

  it("refuses a symlink that leaves the vault, whether to a file or to a folder", async () => {
    const { vault, c } = await opened();
    const elsewhere = await tmp("elsewhere");
    await writeFile(join(elsewhere, "leak.png"), PNG);
    await symlink(
      join(elsewhere, "leak.png"),
      join(vault, "assets", "link.png")
    );
    await symlink(elsewhere, join(vault, "linked"));
    for (const path of ["assets/link.png", "linked/leak.png"]) {
      expect((await get(c, path)).status, path).toBe(404);
    }
  });
});
