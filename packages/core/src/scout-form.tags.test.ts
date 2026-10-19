import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Scout } from "./scout-file.js";
import type { TriedQuery } from "./scout-form.js";
import type { RunSummary } from "./scouts.js";
import {
  closeCores,
  core,
  fixtures,
  urlOf,
  vaultWith,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// Saving, trying and switching a Tag Filter from the form (#687; spec #678).
// The core save/run seam: the file on disk, the `search_query` a fake arXiv
// client receives, and the run rows.

let now = new Date("2026-09-30T12:34:00Z");

const QUERY_SCOUT = `# my scout
name: Sleep
cadence: daily
created: 2026-09-20T00:00:00Z
future_key: keep me # a later beat's
filter:
  query: all:sleep # hand-written
`;

async function opened(files: Record<string, string>) {
  now = new Date("2026-09-30T12:34:00Z");
  const normal = await readFile(join(fixtures, "arxiv", "normal.xml"), "utf8");
  const requests: URL[] = [];
  const vault = await vaultWith(files);
  const c = await core({
    now: () => now,
    arxiv: {
      clock: virtualClock(),
      fetch: (input) => {
        requests.push(urlOf(input));
        return Promise.resolve(new Response(normal));
      },
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  return {
    c,
    requests,
    queries: () => requests.map((u) => u.searchParams.get("search_query")),
    save: async (input: Record<string, unknown>) =>
      c.mutate<{ id: string; run: RunSummary | null }>("scouts.save", {
        name: "Sleep",
        query: "",
        cadence: "daily",
        assigned: [],
        lane: "review",
        searchBackTo: null,
        ...input,
      }),
    list: async () =>
      (await c.query<{ scouts: Scout[] }>("scouts.list")).result!.data.scouts,
    file: (id: string) =>
      readFile(join(vault, ".vitrine/scouts", `${id}.yaml`), "utf8"),
    runRows: () => {
      const db = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"), {
        readOnly: true,
      });
      try {
        return db
          .prepare("SELECT query, window_from, window_to FROM scout_runs")
          .all() as Array<{
          query: string;
          window_from: string;
          window_to: string;
        }>;
      } finally {
        db.close();
      }
    },
  };
}

const lexicon = (edits: Record<string, string[]>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(edits).map(([tag, seeds]) => [
        tag,
        { seeds, excluded: [] },
      ])
    )
  );

const withQueryScout = {
  ".vitrine/scouts/sleep.yaml": QUERY_SCOUT,
  ".vitrine/lexicon.json": lexicon({ ml: ["alpha"], bio: ["beta"] }),
};

describe("saving a Tag Filter", () => {
  it("makes a Scout of Tags as written, run by nothing until it is due", async () => {
    const c = await opened({ ".vitrine/lexicon.json": lexicon({ ml: ["a"] }) });

    const saved = await c.save({ tags: [" ml ", "bio", "ml"] });

    expect(saved.error).toBeUndefined();
    expect(saved.result!.data.run).toBeNull();
    expect(c.requests).toHaveLength(0);
    expect(await c.file("sleep")).toContain("tags:\n    - ml\n    - bio");
    expect(await c.list()).toMatchObject([{ tags: ["ml", "bio"], query: "" }]);
  });

  it("needs a name and a Tag or a Query, and never both", async () => {
    const c = await opened({});

    const none = await c.save({});
    const both = await c.save({ tags: ["ml"], query: "all:sleep" });
    const nameless = await c.save({ name: " ", tags: ["ml"] });

    expect(none.error?.message).toBe("A Scout needs a name and a Query.");
    expect(both.error?.message).toBe(
      "A Scout has Tags or a Query, never both."
    );
    expect(nameless.error).toBeDefined();
    expect(await c.list()).toEqual([]);
  });

  it("refuses Tags on a page, which has no Filter", async () => {
    const c = await opened({});

    const r = await c.save({
      watching: "watched",
      query: "https://example.com/feed",
      tags: ["ml"],
    });

    expect(r.error?.message).toBe("A Watched page has no Filter to give Tags.");
  });
});

describe("switching a Scout's Filter", () => {
  it("moves a Query Scout to Tags, keeping its file, history, window and unknown keys, and runs it once", async () => {
    const c = await opened(withQueryScout);
    await c.c.mutate("scouts.runNow", { scoutId: "sleep" });
    now = new Date("2026-10-01T12:00:00Z");

    const saved = await c.save({ id: "sleep", tags: ["ml"] });

    expect(saved.error).toBeUndefined();
    expect(saved.result!.data.run).not.toBeNull();
    const text = await c.file("sleep");
    expect(text).toContain("# my scout");
    expect(text).toContain("future_key: keep me # a later beat's");
    expect(text).not.toContain("query:");
    expect(c.queries()).toHaveLength(2);
    const [first, second] = c.runRows();
    expect(first!.query).toBe("all:sleep");
    expect(second!.query).toBe('abs:"alpha" OR ti:"alpha"');
    // The window opens where the last clean run closed.
    expect(second!.window_from).toBe(first!.window_to);
    expect((await c.list())[0]).toMatchObject({ id: "sleep", tags: ["ml"] });
  });

  it("moves a Tag Scout back to a Query, keeping the file, and runs it once", async () => {
    const c = await opened({
      ".vitrine/scouts/sleep.yaml": QUERY_SCOUT.replace(
        "  query: all:sleep # hand-written",
        "  tags:\n    - ml"
      ),
      ".vitrine/lexicon.json": lexicon({ ml: ["alpha"] }),
    });

    const saved = await c.save({ id: "sleep", query: "all:wake", tags: [] });

    expect(saved.error).toBeUndefined();
    expect(saved.result!.data.run).not.toBeNull();
    expect(c.queries()).toEqual([
      expect.stringMatching(/^\(all:wake\) AND submittedDate/),
    ]);
    const text = await c.file("sleep");
    expect(text).not.toContain("tags");
    expect(text).toContain("future_key: keep me");
    expect((await c.list())[0]).toMatchObject({ query: "all:wake" });
    expect((await c.list())[0]!.tags).toBeUndefined();
  });

  it("does not run a paused Scout it switched", async () => {
    const c = await opened({
      ...withQueryScout,
      ".vitrine/scouts/sleep.yaml": `${QUERY_SCOUT}paused: true\n`,
    });

    const saved = await c.save({ id: "sleep", tags: ["ml"] });

    expect(saved.result!.data.run).toBeNull();
    expect(c.requests).toHaveLength(0);
  });
});

describe("editing a Tag list", () => {
  const tagged = {
    ".vitrine/scouts/sleep.yaml": QUERY_SCOUT.replace(
      "  query: all:sleep # hand-written",
      "  tags: [ml] # which"
    ),
    ".vitrine/lexicon.json": lexicon({ ml: ["alpha"], bio: ["beta"] }),
  };

  it("runs the Scout once when the list changes", async () => {
    const c = await opened(tagged);

    const saved = await c.save({ id: "sleep", tags: ["ml", "bio"] });

    expect(saved.result!.data.run).not.toBeNull();
    expect(c.queries()).toEqual([
      expect.stringContaining(
        '(abs:"alpha" OR ti:"alpha" OR abs:"beta" OR ti:"beta") AND'
      ),
    ]);
  });

  it("runs nothing when the list is what it was, and leaves its bytes", async () => {
    const c = await opened(tagged);

    const saved = await c.save({ id: "sleep", tags: ["ml"], lane: "skim" });

    expect(saved.result!.data.run).toBeNull();
    expect(c.requests).toHaveLength(0);
    expect(await c.file("sleep")).toContain("tags: [ml] # which");
  });

  it("leaves the Tags alone when the form says nothing of them", async () => {
    const c = await opened(tagged);

    await c.save({ id: "sleep", lane: "skim" });

    expect((await c.list())[0]).toMatchObject({ tags: ["ml"], query: "" });
    expect(c.requests).toHaveLength(0);
  });
});

describe("compiling at the run, not at the save", () => {
  it("lets a Seed made after the save change the next run's query and run nothing", async () => {
    const c = await opened({ ".vitrine/lexicon.json": lexicon({ ml: ["a"] }) });
    await c.save({ tags: ["ml"] });

    await c.c.mutate("lexicon.seed", { tag: "ml", term: "later" });
    expect(c.requests).toHaveLength(0);
    await c.c.mutate("scouts.runNow", { scoutId: "sleep" });

    expect(c.runRows().map((r) => r.query)).toEqual([
      'abs:"a" OR ti:"a" OR abs:"later" OR ti:"later"',
    ]);
    expect(await c.file("sleep")).not.toContain("later");
  });
});

describe("trying Tags", () => {
  it("sends the compiled query with no window and writes nothing", async () => {
    const c = await opened({
      ".vitrine/lexicon.json": lexicon({ a: ["alpha"], b: ["beta"] }),
    });

    const r = await c.c.mutate<TriedQuery>("scouts.tryTags", {
      tags: ["a", "b"],
    });

    expect(r.error).toBeUndefined();
    expect(r.result!.data).toMatchObject({ outcome: "found", total: 2 });
    expect(c.queries()).toEqual([
      'abs:"alpha" OR ti:"alpha" OR abs:"beta" OR ti:"beta"',
    ]);
    expect(c.requests[0]!.searchParams.get("max_results")).toBe("5");
    expect(c.runRows()).toEqual([]);
  });

  it("names a Tag with nothing to compile and asks arXiv nothing", async () => {
    const c = await opened({});

    const r = await c.c.mutate("scouts.tryTags", { tags: ["nowhere"] });

    expect(r.error?.message).toContain("nowhere");
    expect(c.requests).toHaveLength(0);
  });

  it("refuses an empty list", async () => {
    const c = await opened({});
    const r = await c.c.mutate("scouts.tryTags", { tags: [] });
    expect(r.error?.message).toBe("There are no Tags to try.");
  });
});
