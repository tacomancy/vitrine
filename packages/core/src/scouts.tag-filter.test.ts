import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunSummary } from "./scouts.js";
import type { Scout, UnreadableScout } from "./scout-file.js";
import {
  closeCores,
  core,
  fixtures,
  urlOf,
  vaultWith,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// A Tag Filter end to end (#685; spec #678; ADR 0018 decisions 5 and 8): a
// Scout file carrying `filter.tags` is run against a fake arXiv client, and
// what arXiv is asked is the Tag's Lexicon compiled at run time. Seeds are
// the cheapest way to give a Tag Terms, so most vaults here are a Scout file
// and a `lexicon.json`; the parent/child case needs papers.

const NOW = new Date("2026-09-30T12:34:00Z");

const scoutFile = (filter: string) =>
  `name: Tags\ncadence: daily\ncreated: 2026-09-20T00:00:00Z\nfilter:\n${filter}\n`;

const tagsFilter = (...tags: string[]) =>
  `  tags:\n${tags.map((t) => `    - ${t}`).join("\n")}`;

const paper = (name: string, tags: string[], abstract: string) => `---
kind: source
citekey: ${name}
title: ${name} on ${abstract.split(".")[0]}
tags: [${tags.join(", ")}]
---
${abstract
  .split(". ")
  .map((s) => `> ${s}`)
  .join("\n")}
`;

const seeded = (edits: Record<string, string[]>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(edits).map(([tag, seeds]) => [
        tag,
        { seeds, excluded: [] },
      ])
    )
  );

async function opened(files: Record<string, string>) {
  const empty = await readFile(join(fixtures, "arxiv", "empty.xml"), "utf8");
  const requests: URL[] = [];
  const vault = await vaultWith(files);
  const c = await core({
    now: () => NOW,
    arxiv: {
      clock: virtualClock(),
      fetch: (input) => {
        requests.push(urlOf(input));
        return Promise.resolve(new Response(empty));
      },
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const queries = () => requests.map((u) => u.searchParams.get("search_query"));
  return {
    c,
    vault,
    requests,
    queries,
    run: async (scoutId = "tags") => {
      const r = await c.mutate<RunSummary>("scouts.runNow", { scoutId });
      return r;
    },
    list: async () => {
      const r = await c.query<{
        scouts: Scout[];
        unreadable: UnreadableScout[];
      }>("scouts.list");
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    runRows: () => {
      const db = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"), {
        readOnly: true,
      });
      try {
        return db
          .prepare("SELECT query, outcome FROM scout_runs ORDER BY id")
          .all() as Array<{ query: string; outcome: string }>;
      } finally {
        db.close();
      }
    },
  };
}

const WINDOW = /\) AND submittedDate:\[202609200000 TO 202609301234\]$/;

describe("a Scout whose Filter is a Tag", () => {
  it("asks arXiv for the Tag's Terms, quoted, in the run's window, and records the compiled query", async () => {
    const c = await opened({
      ".vitrine/scouts/tags.yaml": scoutFile(tagsFilter("ml/probing")),
      ".vitrine/lexicon.json": seeded({ "ml/probing": ["linear probe"] }),
    });

    expect((await c.run()).error).toBeUndefined();

    const compiled = 'abs:"linear probe" OR ti:"linear probe"';
    expect(c.queries()).toEqual([
      `(${compiled}) AND submittedDate:[202609200000 TO 202609301234]`,
    ]);
    expect(c.runRows()).toEqual([{ query: compiled, outcome: "ok" }]);
    expect(c.queries()[0]).toMatch(WINDOW);
  });

  it("reads as a Scout with its Tags as written and no Query", async () => {
    const c = await opened({
      ".vitrine/scouts/tags.yaml": scoutFile(tagsFilter("ml/probing")),
      ".vitrine/lexicon.json": seeded({ "ml/probing": ["linear probe"] }),
    });

    const { scouts } = await c.list();

    expect(scouts[0]).toMatchObject({ id: "tags", tags: ["ml/probing"] });
    expect(scouts[0]?.query).toBe("");
  });

  it("cannot be broken by a Term's content", async () => {
    const c = await opened({
      ".vitrine/scouts/tags.yaml": scoutFile(tagsFilter("ml")),
      // Hand-edited into the file, so not normalised on the way in.
      ".vitrine/lexicon.json": seeded({ ml: ['a" OR all:b', "back\\slash"] }),
    });

    await c.run();

    const sent = c.queries()[0]!;
    // Every quote in the query is one the compiler put there, in pairs.
    expect(sent.match(/"/g)!.length % 2).toBe(0);
    expect(sent).not.toContain('a" OR');
  });

  it("OR's the clauses of several Tags", async () => {
    const c = await opened({
      ".vitrine/scouts/tags.yaml": scoutFile(tagsFilter("a", "b")),
      ".vitrine/lexicon.json": seeded({ a: ["alpha"], b: ["beta"] }),
    });

    await c.run();

    expect(c.runRows()[0]?.query).toBe(
      'abs:"alpha" OR ti:"alpha" OR abs:"beta" OR ti:"beta"'
    );
  });

  it("compiles a parent's own Lexicon, and a child never takes its parent's Terms", async () => {
    const c = await opened({
      "s/a.md": paper("a", ["ml/probing"], "Linear probe reads alpha. Other."),
      "s/b.md": paper("b", ["ml/probing"], "Linear probe reads beta. Other."),
      "s/c.md": paper("c", ["ml/probing"], "Linear probe reads gamma. Other."),
      "s/z.md": paper("z", ["bio"], "Rats sleep deeply."),
      ".vitrine/scouts/parent.yaml": scoutFile(tagsFilter("ml")),
      ".vitrine/scouts/child.yaml": scoutFile(tagsFilter("ml/probing")),
      // The parent's Seed is the parent's alone (ADR 0045 decision 3).
      ".vitrine/lexicon.json": seeded({ ml: ["parent seed"] }),
    });

    await c.run("parent");
    await c.run("child");

    const [parent, child] = c.runRows();
    expect(parent!.query).toContain('"parent seed"');
    expect(parent!.query).toContain('"linear probe"');
    expect(child!.query).toContain('"linear probe"');
    expect(child!.query).not.toContain("parent seed");
  });

  it("compiles the Lexicon as it is at the run, not as it was at the last one", async () => {
    const c = await opened({
      ".vitrine/scouts/tags.yaml": scoutFile(tagsFilter("ml")),
      ".vitrine/lexicon.json": seeded({ ml: ["first"] }),
    });
    await c.run();

    expect(
      (await c.c.mutate("lexicon.seed", { tag: "ml", term: "second" })).error
    ).toBeUndefined();
    // Editing a Lexicon runs no Scout.
    expect(c.requests).toHaveLength(1);
    await c.run();

    expect(c.runRows().map((r) => r.query)).toEqual([
      'abs:"first" OR ti:"first"',
      'abs:"first" OR ti:"first" OR abs:"second" OR ti:"second"',
    ]);
  });

  it("is unreadable, by name, with both Tags and a Query", async () => {
    const c = await opened({
      ".vitrine/scouts/both.yaml": scoutFile(
        `${tagsFilter("ml")}\n  query: all:sleep`
      ),
      ".vitrine/scouts/ok.yaml": scoutFile("  query: all:sleep"),
    });

    const { scouts, unreadable } = await c.list();

    expect(scouts.map((s) => s.id)).toEqual(["ok"]);
    expect(unreadable).toEqual([
      {
        file: "both.yaml",
        sentence:
          "This file could not be read: it has both filter.tags and filter.query, and a Scout has one.",
      },
    ]);
  });

  it("is unreadable, by name, with neither", async () => {
    const c = await opened({
      ".vitrine/scouts/neither.yaml": scoutFile("  other: 1"),
    });

    expect((await c.list()).unreadable).toEqual([
      {
        file: "neither.yaml",
        sentence:
          "This file could not be read: it has neither filter.tags nor filter.query.",
      },
    ]);
  });

  it("is unreadable when filter.tags is not a list of Tags", async () => {
    const c = await opened({
      ".vitrine/scouts/bad.yaml": scoutFile("  tags: ml"),
    });

    expect((await c.list()).unreadable[0]?.sentence).toBe(
      "This file could not be read: filter.tags is not a list of Tags."
    );
  });

  it("names a Tag with nothing to compile and asks arXiv nothing", async () => {
    const c = await opened({
      ".vitrine/scouts/tags.yaml": scoutFile(tagsFilter("nowhere/at-all")),
    });

    const r = await c.run();

    expect(r.error?.message).toContain("nowhere/at-all");
    expect(c.requests).toHaveLength(0);
    expect(c.runRows()).toEqual([]);
  });
});
