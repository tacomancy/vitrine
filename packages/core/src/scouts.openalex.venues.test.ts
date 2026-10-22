import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

// A per-Scout venue allowlist (#809, spec #800 stories 14, 15, 44; ADR 0051
// decision 9): `filter.venues` is read as found, sent as a source-ID filter,
// and a run it leaves empty says the list did it. Stand-in endpoint only.

const NOW = new Date("2026-09-30T12:34:00Z");

const scoutYaml = (venues: string) =>
  `name: Published sleep\nsource:\n  kind: openalex\ncadence: daily\nlane: review\ncreated: 2026-09-20T00:00:00Z\nfilter:\n  query: '"sleep"'\n${venues}\n`;

const LISTED = scoutYaml(
  "  venues:\n    - id: S111\n      name: Journal of Sleep\n    - id: https://openalex.org/S222\n      name: Sleep Medicine"
);

async function opened(
  scout: string,
  answer: (url: URL) => Response = () =>
    Response.json({ meta: { count: 0 }, results: [] }),
  vaultFiles: Record<string, string> = {}
) {
  const vault = await fixtureCopy("obsidian-vault");
  for (const [file, text] of Object.entries({
    ".vitrine/scouts/pub.yaml": scout,
    ...vaultFiles,
  })) {
    await mkdir(dirname(join(vault, file)), { recursive: true });
    await writeFile(join(vault, file), text);
  }
  const requests: URL[] = [];
  const c = await core({
    now: () => NOW,
    openalex: {
      clock: virtualClock(),
      fetch: (input) => {
        const url = urlOf(input);
        requests.push(url);
        return Promise.resolve(answer(url));
      },
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  return {
    c,
    requests,
    list: async () =>
      (
        await c.query<{ scouts: Scout[]; unreadable: UnreadableScout[] }>(
          "scouts.list"
        )
      ).result!.data,
    run: async () =>
      (await c.mutate<RunSummary>("scouts.runNow", { scoutId: "pub" })).result!
        .data,
    notes: () => {
      const db = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"), {
        readOnly: true,
      });
      try {
        return db.prepare("SELECT note FROM scout_runs").all();
      } finally {
        db.close();
      }
    },
  };
}

describe("reading filter.venues", () => {
  it("keeps each entry's ID, short, and its name", async () => {
    const o = await opened(LISTED);
    expect((await o.list()).scouts[0]?.venues).toEqual([
      { id: "S111", name: "Journal of Sleep" },
      { id: "S222", name: "Sleep Medicine" },
    ]);
  });

  it("is absent on a Scout with no allowlist", async () => {
    const o = await opened(scoutYaml(""));
    expect((await o.list()).scouts[0]).not.toHaveProperty("venues");
  });

  it.each([
    ["a bare string", "  venues:\n    - Journal of Sleep"],
    ["an entry with no id", "  venues:\n    - name: Journal of Sleep"],
    ["an entry with a bad id", "  venues:\n    - id: nonsense\n      name: X"],
    ["an entry with no name", "  venues:\n    - id: S111"],
    ["an empty list", "  venues: []"],
    ["a non-list", "  venues: S111"],
  ])("names the file unreadable for %s", async (_, venues) => {
    const o = await opened(scoutYaml(venues));
    const { scouts, unreadable } = await o.list();
    expect(scouts).toEqual([]);
    expect(unreadable).toEqual([
      {
        file: "pub.yaml",
        sentence: expect.stringContaining("filter.venues") as string,
      },
    ]);
  });
});

describe("running with an allowlist", () => {
  it("sends only those source IDs", async () => {
    const o = await opened(LISTED);
    await o.run();
    const filter = o.requests[0]!.searchParams.get("filter")!;
    expect(filter).toContain("primary_location.source.id:S111|S222");
    expect(filter).toContain("primary_location.source.type:journal|conference");
  });

  it("sends no source-ID filter without one", async () => {
    const o = await opened(scoutYaml(""));
    await o.run();
    expect(o.requests[0]!.searchParams.get("filter")).not.toContain(
      "source.id"
    );
  });

  it("says the allowlist when it returns nothing", async () => {
    const o = await opened(LISTED);
    const summary = await o.run();
    expect(summary.outcome).toBe("ok");
    expect(summary.note).toContain("Journal of Sleep");
    expect(summary.note).toContain("Sleep Medicine");
    expect(summary.note).toContain("allowlist");
    expect(o.notes()).toEqual([{ note: summary.note }]);
  });

  it("says nothing of the allowlist when works came back", async () => {
    const o = await opened(LISTED, () =>
      Response.json({
        meta: { count: 1 },
        results: [
          {
            id: "https://openalex.org/W1",
            title: "A paper",
            publication_date: "2026-09-22",
            primary_location: {
              source: { display_name: "Journal of Sleep", type: "journal" },
            },
          },
        ],
      })
    );
    expect((await o.run()).note).toBeNull();
  });

  it("says nothing of an allowlist a Scout does not have", async () => {
    const o = await opened(scoutYaml(""));
    expect((await o.run()).note).toBeNull();
  });
});
