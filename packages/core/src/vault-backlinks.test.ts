import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, vaultWith } from "./test-core.js";
import type { Backlink } from "./vault-backlinks.js";

// The core seam for the Vault's right pane (spec #680, #695): `vault.backlinks`
// driven through the core's own entry over a temp vault.

afterEach(closeCores);

async function opened(files: Record<string, string>) {
  const c = await core({ settleMs: 40 });
  const path = await vaultWith(files);
  expect((await c.mutate("vault.open", { path })).error).toBeUndefined();
  await c.indexed();
  return c;
}

const backlinks = async (
  c: Awaited<ReturnType<typeof opened>>,
  path: string
) => {
  const reply = await c.query<Backlink[]>("vault.backlinks", { path });
  expect(reply.error).toBeUndefined();
  return reply.result?.data ?? [];
};

describe("vault.backlinks", () => {
  it("gives a note's link its snippet, the heading it sits under and its Kind", async () => {
    const c = await opened({
      "target.md": "# Target\n",
      "notes/a.md":
        "# A\n\n## Thoughts\nSee [[target]] for the *why*.\n\nmore\n",
    });
    expect(await backlinks(c, "target.md")).toEqual([
      {
        path: "notes/a.md",
        kind: null,
        field: "Thoughts",
        date: expect.any(Number) as number,
        snippet: "See [[target]] for the *why*.",
        block: null,
      },
    ]);
  });

  it("names the Kind, and dates the file by its own created", async () => {
    const c = await opened({
      "target.md": "# Target\n",
      "q.md": [
        "---",
        "kind: question",
        "id: qqqqqqqqqq",
        'created: "2026-08-05T09:00:00+00:00"',
        "---",
        "## Working answer",
        "Leans on [[target]].",
        "",
      ].join("\n"),
    });
    const [row] = await backlinks(c, "target.md");
    expect(row).toMatchObject({
      path: "q.md",
      kind: "question",
      field: "Working answer",
      date: Date.parse("2026-08-05T09:00:00+00:00"),
    });
  });

  it("counts an ambiguous link for neither candidate", async () => {
    const c = await opened({
      "one/dup.md": "# one\n",
      "two/dup.md": "# two\n",
      "a.md": "points at [[dup]]\n",
    });
    expect(await backlinks(c, "one/dup.md")).toEqual([]);
    expect(await backlinks(c, "two/dup.md")).toEqual([]);
  });

  it("carries the block a link into a Source targets", async () => {
    const c = await opened({
      "Paper.md": "---\nkind: source\nid: srcsrcsrc1\n---\n> quoted ^h1\n",
      "a.md": "see [[Paper#^h1]] and [[Paper]]\n",
    });
    const rows = await backlinks(c, "Paper.md");
    expect(rows.map((r) => r.block)).toEqual(["h1", null]);
  });

  it("reads a snippet at the right place in a CRLF file with a BOM", async () => {
    const c = await opened({
      "target.md": "# T\n",
      "crlf.md": "﻿# C\r\n\r\nfirst line\r\nthen [[target]] here\r\nlast\r\n",
    });
    const [row] = await backlinks(c, "target.md");
    expect(row?.snippet).toBe("then [[target]] here");
  });

  it("does not count a file's link to itself", async () => {
    const c = await opened({ "a.md": "[[a]] and [[#x]]\n\n# x\n" });
    expect(await backlinks(c, "a.md")).toEqual([]);
  });
});
