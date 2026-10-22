import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Card, RunSummary } from "./scouts.js";
import type { Muted } from "./mutes.js";
import {
  closeCores,
  core,
  fixtureCopy,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// Mute rules meet OpenAlex works (#806, ADR 0051 decision 8): a venue rule can
// carry the source ID and then matches by it, a publisher rule matches the
// lineage, and a name-only rule and an arXiv Proposal behave as before.

const NOW = new Date("2026-09-30T12:34:00Z");
const SCOUT = `name: Published sleep\nsource:\n  kind: openalex\ncadence: daily\nlane: review\ncreated: 2026-09-20T00:00:00Z\nfilter:\n  query: '"sleep"'\n`;

type Work = Record<string, unknown>;

/** A work from a source with an ID and a publisher lineage, as OpenAlex answers it. */
const work = (
  n: number,
  venue: string,
  source = "S1",
  lineage: string[] = ["P1"]
): Work => ({
  id: `https://openalex.org/W${n}`,
  doi: `https://doi.org/10.1000/w${n}`,
  title: `Work ${n}`,
  publication_date: "2026-09-22",
  authorships: [{ author: { display_name: "Ada Meer" } }],
  abstract_inverted_index: { Sleep: [0] },
  primary_location: {
    landing_page_url: `https://journal.example/${n}`,
    source: {
      id: `https://openalex.org/${source}`,
      display_name: venue,
      type: "journal",
      host_organization: `https://openalex.org/${lineage[0]}`,
      host_organization_lineage: lineage.map(
        (p) => `https://openalex.org/${p}`
      ),
    },
  },
});

async function opened(results: Work[], mutes?: string) {
  const vault = await fixtureCopy("obsidian-vault");
  const files: Record<string, string> = {
    ".vitrine/scouts/pub.yaml": SCOUT,
    ...(mutes === undefined ? {} : { ".vitrine/mutes.yaml": mutes }),
  };
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(vault, file)), { recursive: true });
    await writeFile(join(vault, file), text);
  }
  const c = await core({
    now: () => NOW,
    openalex: {
      clock: virtualClock(),
      fetch: (input) => {
        urlOf(input);
        return Promise.resolve(
          Response.json({ meta: { count: results.length }, results })
        );
      },
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const run = await c.mutate<RunSummary>("scouts.runNow", { scoutId: "pub" });
  expect(run.error).toBeUndefined();
  const read = async <T>(path: string, input?: unknown) => {
    const r = await c.query<T>(path, input);
    expect(r.error).toBeUndefined();
    return r.result!.data;
  };
  return {
    vault,
    titles: async () =>
      (await read<Card[]>("scouts.queue", { sort: "newest" }))
        .map((card) => card.title)
        .sort(),
    muted: () => read<Muted>("scouts.muted"),
    reach: async (rule: Record<string, string>) =>
      (await read<{ count: number }>("scouts.muteReach", rule)).count,
    mute: async (rule: Record<string, string>) =>
      expect((await c.mutate("scouts.mute", rule)).error).toBeUndefined(),
    unmute: async (rule: Record<string, string>) =>
      expect((await c.mutate("scouts.unmute", rule)).error).toBeUndefined(),
    file: () => readFile(join(vault, ".vitrine/mutes.yaml"), "utf8"),
  };
}

describe("a venue rule that carries an OpenAlex source ID", () => {
  it("mutes a work whose venue name is spelled differently", async () => {
    const q = await opened([
      work(1, "J. Sleep Res.", "S1"),
      work(2, "Journal of Sleep Research", "S1"),
      work(3, "Journal of Sleep Research", "S2"),
    ]);
    await q.mute({
      kind: "venue",
      value: "Journal of Sleep Research",
      id: "S1",
    });
    expect(await q.titles()).toEqual(["Work 3"]);
    expect((await q.muted()).items.map((i) => i.title).sort()).toEqual([
      "Work 1",
      "Work 2",
    ]);
  });

  it("takes the ID in either of OpenAlex's spellings", async () => {
    const q = await opened([work(1, "A"), work(2, "B", "S2")]);
    await q.mute({ kind: "venue", value: "A", id: "https://openalex.org/S1" });
    expect(await q.titles()).toEqual(["Work 2"]);
  });

  it("reports what it catches before it is saved, and deleting it returns the works", async () => {
    const q = await opened([work(1, "A"), work(2, "B"), work(3, "C", "S2")]);
    const rule = { kind: "venue", value: "A", id: "S1" };
    expect(await q.reach(rule)).toBe(2);
    await q.mute(rule);
    expect(await q.reach(rule)).toBe(0);
    expect(await q.titles()).toEqual(["Work 3"]);
    await q.unmute(rule);
    expect(await q.titles()).toEqual(["Work 1", "Work 2", "Work 3"]);
  });

  it("is written beside its name and read back as found", async () => {
    const q = await opened([work(1, "A")]);
    await q.mute({ kind: "venue", value: "A", id: "S1" });
    expect(await q.file()).toContain("id: S1");
    expect((await q.muted()).rules).toEqual([
      { kind: "venue", value: "A", id: "S1" },
    ]);
  });
});

describe("a name-only venue rule", () => {
  it("still matches by name, whatever the Proposal's source ID", async () => {
    const q = await opened(
      [work(1, "Journal of Sleep"), work(2, "Journal of Sleep", "S2")],
      "venues:\n  - journal of sleep\n"
    );
    expect(await q.titles()).toEqual([]);
    expect((await q.muted()).problem).toBeNull();
  });

  it("is a different rule from an ID rule of the same name, so unmuting one leaves the other", async () => {
    const q = await opened([work(1, "A"), work(2, "B", "S2")]);
    await q.mute({ kind: "venue", value: "A" });
    await q.mute({ kind: "venue", value: "A", id: "S2" });
    await q.unmute({ kind: "venue", value: "A", id: "S2" });
    expect(await q.titles()).toEqual(["Work 2"]);
  });

  it("is the fallback for an ID rule when the Proposal has no source ID", async () => {
    const q = await opened([
      {
        ...work(1, "A"),
        primary_location: { source: { display_name: "A", type: "journal" } },
      },
      work(2, "B", "S2"),
    ]);
    await q.mute({ kind: "venue", value: "a", id: "S9" });
    expect(await q.titles()).toEqual(["Work 2"]);
  });
});

describe("a publisher rule", () => {
  it("mutes the publisher's works and its imprints'", async () => {
    const q = await opened([
      work(1, "A", "S1", ["P1"]),
      work(2, "B", "S2", ["P2", "P1"]),
      work(3, "C", "S3", ["P3"]),
    ]);
    await q.mute({ kind: "publisher", value: "Parent Press", id: "P1" });
    expect(await q.titles()).toEqual(["Work 3"]);
    await q.unmute({ kind: "publisher", value: "Parent Press", id: "P1" });
    expect(await q.titles()).toEqual(["Work 1", "Work 2", "Work 3"]);
  });
});

describe("the mutes file", () => {
  it("reads venue and publisher entries written as a name and an id", async () => {
    const q = await opened(
      [work(1, "A"), work(2, "B", "S2", ["P2"])],
      "venues:\n  - name: Renamed\n    id: S1\npublishers:\n  - name: Press\n    id: https://openalex.org/P2\n"
    );
    expect(await q.titles()).toEqual([]);
  });

  it("names an unknown key inside an entry, and holds nothing back", async () => {
    const q = await opened(
      [work(1, "A")],
      "venues:\n  - name: A\n    source: S1\n"
    );
    const m = await q.muted();
    expect(m.problem).toContain('"source"');
    expect(await q.titles()).toEqual(["Work 1"]);
  });

  it("reads a venue written as a name alone as a name-only rule", async () => {
    const q = await opened([work(1, "A")], "venues:\n  - name: A\n");
    expect(await q.titles()).toEqual([]);
  });

  it("names a publisher entry with no id", async () => {
    const q = await opened([work(1, "A")], "publishers:\n  - Press\n");
    expect((await q.muted()).problem).toContain("publishers");
  });
});
