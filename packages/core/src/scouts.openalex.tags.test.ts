import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunSummary } from "./scouts.js";
import type { Scout, UnreadableScout } from "./scout-file.js";
import {
  closeCores,
  core,
  fixtureCopy,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// A Tag Filter on an OpenAlex Scout (#803, spec #800 stories 6, 7, 9, 10;
// ADR 0051 decision 4): Tags are stored as written and compiled at every run,
// so a Lexicon edit changes the next run's query and starts no run.

const NOW = new Date("2026-09-30T12:34:00Z");

const scoutYaml = (filter: string) =>
  `name: Published sleep\nsource:\n  kind: openalex\ncadence: daily\nlane: review\ncreated: 2026-09-20T00:00:00Z\nfilter:\n${filter}\n`;

const TAGS = scoutYaml("  tags:\n    - sleep");

const seeded = (seeds: string[]) =>
  JSON.stringify({ sleep: { seeds, excluded: [] } });

async function opened(files: Record<string, string>) {
  const vault = await fixtureCopy("obsidian-vault");
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(vault, file)), { recursive: true });
    await writeFile(join(vault, file), text);
  }
  const requests: URL[] = [];
  const c = await core({
    now: () => NOW,
    openalex: {
      clock: virtualClock(),
      fetch: (input) => {
        requests.push(urlOf(input));
        return Promise.resolve(
          Response.json({ meta: { count: 0 }, results: [] })
        );
      },
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  return {
    c,
    vault,
    requests,
    run: async () =>
      (await c.mutate<RunSummary>("scouts.runNow", { scoutId: "pub" })).result!
        .data,
    list: async () =>
      (
        await c.query<{ scouts: Scout[]; unreadable: UnreadableScout[] }>(
          "scouts.list"
        )
      ).result!.data,
    runRows: () => {
      const db = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"), {
        readOnly: true,
      });
      try {
        return db
          .prepare(
            "SELECT outcome, error_kind, error_message, query FROM scout_runs ORDER BY id"
          )
          .all();
      } finally {
        db.close();
      }
    },
  };
}

describe("an OpenAlex Scout whose Filter is Tags", () => {
  it("sends the Tag's Terms and records the compiled query", async () => {
    const c = await opened({
      ".vitrine/scouts/pub.yaml": TAGS,
      ".vitrine/lexicon.json": seeded(["sleep spindle"]),
    });
    expect((await c.run()).outcome).toBe("ok");
    const filter = c.requests[0]!.searchParams.get("filter")!;
    expect(filter).toContain('title_and_abstract.search:("sleep spindle")');
    expect(filter).toContain("primary_location.source.type:journal|conference");
    expect(c.runRows()).toEqual([
      {
        outcome: "ok",
        error_kind: null,
        error_message: null,
        query: 'filter=title_and_abstract.search:("sleep spindle")',
      },
    ]);
  });

  it("changes the next run's query when a Lexicon is edited, and starts no run", async () => {
    const c = await opened({
      ".vitrine/scouts/pub.yaml": TAGS,
      ".vitrine/lexicon.json": seeded(["sleep spindle"]),
    });
    await c.run();
    await writeFile(
      join(c.vault, ".vitrine/lexicon.json"),
      seeded(["sleep spindle", "slow oscillation"])
    );
    expect(c.requests).toHaveLength(1);
    expect(c.runRows()).toHaveLength(1);
    await c.run();
    expect(c.requests[1]!.searchParams.get("filter")).toContain(
      '"sleep spindle" OR "slow oscillation"'
    );
  });

  it("fails by name, with the way out, when no Tag compiles", async () => {
    const c = await opened({
      ".vitrine/scouts/pub.yaml": TAGS,
      ".vitrine/lexicon.json": "{}",
    });
    const summary = await c.run();
    expect(summary).toMatchObject({ outcome: "failed", errorKind: "tags" });
    expect(c.requests).toHaveLength(0);
    const [row] = c.runRows() as Array<{ error_message: string }>;
    expect(row!.error_message).toContain("Seed a Term in its Lexicon");
  });

  it("is refused at save when no Tag compiles, and saves Tags when one does", async () => {
    const c = await opened({ ".vitrine/lexicon.json": "{}" });
    const form = {
      name: "Published sleep",
      watching: "openalex",
      query: "",
      tags: ["sleep"],
      cadence: "daily",
      assigned: [],
      lane: "review",
      searchBackTo: null,
    };
    const refused = await c.c.mutate("scouts.save", form);
    expect(refused.error?.message).toContain("Seed a Term in its Lexicon");

    await writeFile(
      join(c.vault, ".vitrine/lexicon.json"),
      seeded(["sleep spindle"])
    );
    const saved = await c.c.mutate<{ id: string }>("scouts.save", form);
    expect(saved.error).toBeUndefined();
    const text = await readFile(
      join(c.vault, `.vitrine/scouts/${saved.result!.data.id}.yaml`),
      "utf8"
    );
    expect(text).toContain("kind: openalex");
    expect(text).toContain("tags:\n    - sleep");
    expect(text).not.toContain("query");
  });

  it("is unreadable, by name, when the file has both Tags and a Query", async () => {
    const c = await opened({
      ".vitrine/scouts/pub.yaml": scoutYaml(
        "  tags:\n    - sleep\n  query: sleep"
      ),
    });
    const { scouts, unreadable } = await c.list();
    expect(scouts.filter((s) => s.id === "pub")).toEqual([]);
    expect(unreadable[0]?.sentence).toContain(
      "both filter.tags and filter.query"
    );
  });

  it("leaves a Query-only OpenAlex Scout as it was", async () => {
    const c = await opened({
      ".vitrine/scouts/pub.yaml": scoutYaml(`  query: '"sleep consolidation"'`),
    });
    expect((await c.run()).outcome).toBe("ok");
    expect(c.requests[0]!.searchParams.get("filter")).toContain(
      'title_and_abstract.search:"sleep consolidation"'
    );
  });
});
