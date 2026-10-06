import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Coverage } from "./question-map.js";
import { closeCores, core, vaultWith } from "./test-core.js";

afterEach(closeCores);

// Accepting a candidate onto a Research Question (#489; ADR 0041 decision 9):
// the Related edge a page keeps is a line under `## Related questions`, so
// the write is one `appendToSection` through the router, never Supporting or
// Opposing.

const rq = (related = "", { doubled = false, noRelated = false } = {}) => `---
id: rq-1
kind: research-question
question: "Is it consolidation?"
status: open
promoted_from: "[[Q]]"
promoted: 2026-09-02T10:00:00Z
tags: [sleep]
---

## Working answer

Maybe.

## Supporting sources

## Opposing sources

${noRelated ? "" : `## Related questions\n\n${related}\n`}${doubled ? "## Related questions\n\n" : ""}
## Open threads

## Position history
`;

const paper = `---
kind: source
citekey: rasch2013
title: Odor cues
tags: [sleep]
---
`;

async function opened(page: string) {
  const vault = await vaultWith({
    "q/Q (RQ).md": page,
    "s/rasch2013.md": paper,
  });
  const c = await core();
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const bytes = () => readFile(join(vault, "q/Q (RQ).md"), "utf8");
  const link = () =>
    c.mutate<{ path: string; target: string; linked: boolean }>(
      "researchQuestions.link",
      { path: "q/Q (RQ).md", target: "s/rasch2013.md" }
    );
  return { c, bytes, link };
}

describe("researchQuestions.link", () => {
  it("appends one line under Related questions and touches nothing else", async () => {
    const { bytes, link } = await opened(rq("- [[Other]]"));
    const before = await bytes();
    const reply = await link();
    expect(reply.error).toBeUndefined();
    expect(reply.result!.data.linked).toBe(true);
    const after = await bytes();
    expect(after).toBe(
      before.replace("- [[Other]]\n", "- [[Other]]\n- [[rasch2013]]\n")
    );
  });

  it("fills an empty section", async () => {
    const { bytes, link } = await opened(rq());
    await link();
    expect(await bytes()).toContain(
      "## Related questions\n\n- [[rasch2013]]\n"
    );
  });

  it("leaves the file untouched when the paper is already listed", async () => {
    const { bytes, link } = await opened(rq("- [[rasch2013]] — noted"));
    const before = await bytes();
    const reply = await link();
    expect(reply.error).toBeUndefined();
    expect(reply.result!.data.linked).toBe(false);
    expect(await bytes()).toBe(before);
  });

  it("refuses a missing section, and a doubled one, with a reason and no write", async () => {
    for (const [page, reason] of [
      [rq("", { noRelated: true }), "no ## Related questions"],
      [rq("", { doubled: true }), "more than one ## Related questions"],
    ] as const) {
      const { bytes, link } = await opened(page);
      const before = await bytes();
      const reply = await link();
      expect(reply.error?.message).toContain(reason);
      expect(await bytes()).toBe(before);
      await closeCores();
    }
  });

  it("anchors the row on the next read, and it stays an open Research Question row", async () => {
    const { c, link } = await opened(rq());
    await link();
    await c.indexed();
    const cov = await c.query<Coverage>("questionMap.coverage");
    const row = cov.result!.data.rows.find((r) => r.path === "q/Q (RQ).md")!;
    expect(row.kind).toBe("research-question");
    expect(row.material.map((m) => m.path)).toEqual(["s/rasch2013.md"]);
  });
});
