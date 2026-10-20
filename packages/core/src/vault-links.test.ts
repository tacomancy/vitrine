import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, vaultWith } from "./test-core.js";
import type { LinkResolutions } from "./vault-links.js";

// The core seam for following a link from the editor (#701; spec #680 story
// 41): `vault.resolveLinks` answers, for the `[[…]]` texts an open file holds,
// where each lands and what it is, so the editor can draw a resolved link
// differently from one that goes nowhere.

afterEach(closeCores);

async function resolve(files: Record<string, string>, links: string[]) {
  const c = await core({ settleMs: 40 });
  const path = await vaultWith(files);
  expect((await c.mutate("vault.open", { path })).error).toBeUndefined();
  await c.indexed();
  const reply = await c.query<LinkResolutions>("vault.resolveLinks", {
    from: "a.md",
    links,
  });
  expect(reply.error).toBeUndefined();
  return reply.result?.data ?? {};
}

describe("vault.resolveLinks", () => {
  it("resolves a link to its file and that file's Kind", async () => {
    const got = await resolve(
      {
        "a.md": "[[q]] [[plain]]\n",
        "q.md": "---\nkind: question\nid: qqqqqqqqqq\n---\n",
        "plain.md": "x\n",
      },
      ["q", "plain|an alias"]
    );
    expect(got["q"]).toEqual({
      resolution: "resolved",
      path: "q.md",
      kind: "question",
      candidates: [],
    });
    expect(got["plain|an alias"]).toMatchObject({
      resolution: "resolved",
      path: "plain.md",
      kind: null,
    });
  });

  it("offers an ambiguous link's candidates, each with its Kind, and picks neither", async () => {
    const got = await resolve(
      {
        "a.md": "[[dup]]\n",
        "x/dup.md": "x\n",
        "y/dup.md": "---\nkind: hypothesis\nid: hhhhhhhhhh\n---\n",
      },
      ["dup"]
    );
    expect(got["dup"]).toEqual({
      resolution: "ambiguous",
      path: null,
      kind: null,
      candidates: [
        { path: "x/dup.md", kind: null },
        { path: "y/dup.md", kind: "hypothesis" },
      ],
    });
  });

  it("calls a link to nothing unresolved", async () => {
    const got = await resolve({ "a.md": "[[ghost]]\n" }, ["ghost"]);
    expect(got["ghost"]).toEqual({
      resolution: "unresolved",
      path: null,
      kind: null,
      candidates: [],
    });
  });
});
