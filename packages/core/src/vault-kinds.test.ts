import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, vaultWith } from "./test-core.js";

// `vault.kinds` (#347): which Kinds the vault holds at least one file of,
// so the Sidebar can tell a built surface with nothing in it from one with
// something — the index's answer, re-read on every change like any list.

afterEach(closeCores);

async function opened(files: Record<string, string>) {
  const c = await core({ settleMs: 40 });
  const vault = await vaultWith(files);
  const reply = await c.mutate("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  return { c, vault };
}

const kindsOf = async (c: Awaited<ReturnType<typeof core>>) => {
  const reply = await c.query<string[]>("vault.kinds");
  expect(reply.error).toBeUndefined();
  return reply.result?.data;
};

const RQ =
  "---\nkind: research-question\nquestion: Does it hold?\n---\n\n## Working answer\n";

describe("vault.kinds", () => {
  it("is empty for a vault of plain notes", async () => {
    const { c } = await opened({ "a.md": "# A\n", "b.md": "text\n" });
    expect(await kindsOf(c)).toEqual([]);
  });

  it("names each declared Kind once, sorted", async () => {
    const { c } = await opened({
      "one.md": RQ,
      "two.md": RQ,
      "h.md": "---\nkind: hypothesis\n---\n\n## Claim\n\nNaps help.\n",
      "note.md": "# A note\n",
    });
    expect(await kindsOf(c)).toEqual(["hypothesis", "research-question"]);
  });

  it("follows the vault: a Kind appears when its first file does and goes with its last", async () => {
    const { c, vault } = await opened({ "note.md": "# A note\n" });
    expect(await kindsOf(c)).toEqual([]);
    await writeFile(join(vault, "rq.md"), RQ);
    await expect.poll(() => kindsOf(c)).toEqual(["research-question"]);
    await rm(join(vault, "rq.md"));
    await expect.poll(() => kindsOf(c)).toEqual([]);
  });

  it("refuses when no vault is open", async () => {
    const c = await core();
    const reply = await c.query("vault.kinds");
    expect(reply.error?.message).toBe("No vault is open.");
  });
});
