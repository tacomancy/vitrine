import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, vaultWith } from "./test-core.js";
import type { TreeFile } from "./vault-tree.js";

// The core seam for the Vault's left pane (spec #680): `vault.tree` and
// `vault.create`, each driven through the core's own entry over a temp vault
// and checked against disk and the index.

afterEach(closeCores);

const SOURCE = [
  "---",
  "kind: source",
  "id: srcsrcsrc1",
  "---",
  "# A paper",
  "",
  "> quoted ^h1",
  "",
  "> another ^h2",
  "",
].join("\n");

async function opened(files: Record<string, string>) {
  const c = await core({ settleMs: 40 });
  const path = await vaultWith(files);
  const reply = await c.mutate("vault.open", { path });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  return { c, path };
}

describe("vault.tree", () => {
  it("lists every non-dot file with its Kind, and never the app's own folder", async () => {
    const { c } = await opened({
      "plain.md": "# Plain\n",
      "notes/deep/Idea.md": "text\n",
      "q.md": "---\nkind: question\nid: qqqqqqqqqq\n---\n",
      "stub.md": "---\nkind: source-stub\nid: stubstub12\n---\n",
      "sources/pdf/paper.pdf": "%PDF",
      ".hidden/secret.md": "x\n",
    });
    const reply = await c.query<TreeFile[]>("vault.tree");
    expect(reply.error).toBeUndefined();
    const files = reply.result?.data ?? [];
    expect(files.map((f) => f.path)).toEqual([
      "notes/deep/Idea.md",
      "plain.md",
      "q.md",
      "sources/pdf/paper.pdf",
      "stub.md",
    ]);
    const kinds = Object.fromEntries(files.map((f) => [f.path, f.kind]));
    expect(kinds).toMatchObject({
      "plain.md": null,
      "q.md": "question",
      "stub.md": "source-stub",
    });
  });

  it("counts a Source's highlights and gives a file that is not one no count", async () => {
    const { c } = await opened({ "Paper.md": SOURCE, "other.md": "# x\n" });
    const files = (await c.query<TreeFile[]>("vault.tree")).result?.data ?? [];
    expect(files.find((f) => f.path === "Paper.md")?.annotations).toBe(2);
    expect(files.find((f) => f.path === "other.md")?.annotations).toBe(
      undefined
    );
  });
});

describe("vault.create", () => {
  it("writes the note under notes/, named by the Question's rule, and the tree shows it", async () => {
    const { c, path } = await opened({ "a.md": "# a\n" });
    const reply = await c.mutate<{ path: string }>("vault.create", {
      name: "What: is *this*?",
    });
    expect(reply.error).toBeUndefined();
    expect(reply.result?.data.path).toBe("notes/What is this.md");
    expect(await readFile(join(path, "notes/What is this.md"), "utf8")).toBe(
      "\n"
    );
    const files = (await c.query<TreeFile[]>("vault.tree")).result?.data ?? [];
    expect(files.map((f) => f.path)).toContain("notes/What is this.md");
  });

  it("refuses a taken name rather than suffixing it, and leaves the file as it was", async () => {
    const { c, path } = await opened({ "notes/Idea.md": "mine\n" });
    const reply = await c.mutate("vault.create", { name: "Idea" });
    expect(reply.error?.message).toMatch(/already/i);
    expect(reply.error?.message).not.toContain(path);
    expect(await readFile(join(path, "notes/Idea.md"), "utf8")).toBe("mine\n");
  });

  it("refuses a name with nothing left in it", async () => {
    const { c } = await opened({ "a.md": "# a\n" });
    const reply = await c.mutate("vault.create", { name: " ?? " });
    expect(reply.error?.message).toMatch(/name/i);
  });
});
