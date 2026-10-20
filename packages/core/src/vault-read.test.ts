import { createHash } from "node:crypto";
import { readFile, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, vaultWith } from "./test-core.js";
import type { FileText } from "./vault-read.js";

// The core seam for opening a file in the Vault editor (#690): `vault.read`
// answers the editor's LF text, the hash of the bytes, and what the write
// must restore — and never writes.

afterEach(closeCores);

async function opened(files: Record<string, string>) {
  const c = await core({ settleMs: 40 });
  const path = await vaultWith(files);
  expect((await c.mutate("vault.open", { path })).error).toBeUndefined();
  await c.indexed();
  return { c, path };
}

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

describe("vault.read", () => {
  it("answers the text, the hash of the bytes, and the file's mtime", async () => {
    const { c, path } = await opened({ "n.md": "# Hi\n\nbody\n" });
    await utimes(join(path, "n.md"), 1_700_000_000, 1_700_000_000);
    const reply = await c.query<FileText>("vault.read", { path: "n.md" });
    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toEqual({
      text: "# Hi\n\nbody\n",
      hash: sha(await readFile(join(path, "n.md"))),
      eol: "lf",
      bom: false,
      mtime: 1_700_000_000_000,
    });
  });

  it("hands a CRLF file over as LF text and says it was CRLF, the hash still of the bytes", async () => {
    const raw = "# Hi\r\n\r\nbody\r\nmore";
    const { c, path } = await opened({ "n.md": raw });
    const data = (await c.query<FileText>("vault.read", { path: "n.md" }))
      .result?.data;
    expect(data).toMatchObject({
      text: "# Hi\n\nbody\nmore",
      eol: "crlf",
      hash: sha(Buffer.from(raw)),
    });
    expect(await readFile(join(path, "n.md"), "utf8")).toBe(raw);
  });

  it("strips a BOM from the text and reports it", async () => {
    const { c } = await opened({ "n.md": "﻿# Hi\n" });
    const data = (await c.query<FileText>("vault.read", { path: "n.md" }))
      .result?.data;
    expect(data).toMatchObject({ text: "# Hi\n", bom: true });
  });

  it("keeps a missing trailing newline missing", async () => {
    const { c } = await opened({ "n.md": "no newline" });
    const data = (await c.query<FileText>("vault.read", { path: "n.md" }))
      .result?.data;
    expect(data?.text).toBe("no newline");
  });

  it("changes no byte and not the mtime", async () => {
    const raw = "﻿# Hi\r\nbody";
    const { c, path } = await opened({ "n.md": raw });
    const before = await stat(join(path, "n.md"));
    await c.query("vault.read", { path: "n.md" });
    await c.query("vault.read", { path: "n.md" });
    const after = await stat(join(path, "n.md"));
    expect(await readFile(join(path, "n.md"), "utf8")).toBe(raw);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("refuses a path outside the vault and a file that is not Markdown", async () => {
    const { c } = await opened({ "a.md": "x\n", "sources/pdf/p.pdf": "%PDF" });
    const outside = await c.query("vault.read", { path: "../escape.md" });
    expect(outside.error).toBeDefined();
    const pdf = await c.query("vault.read", { path: "sources/pdf/p.pdf" });
    expect(pdf.error).toBeDefined();
  });

  it("says a file that is not there without the machine's path", async () => {
    const { c, path } = await opened({ "a.md": "x\n" });
    const reply = await c.query("vault.read", { path: "gone.md" });
    expect(reply.error).toBeDefined();
    expect(JSON.stringify(reply.error)).toContain("gone.md");
    expect(JSON.stringify(reply.error)).not.toContain(path);
  });
});
