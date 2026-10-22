import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { TriedQuery } from "./scout-form.js";
import {
  closeCores,
  core,
  fixtureCopy,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// The Scout form's OpenAlex source (#802, spec #800 stories 11–13, 44): a new
// OpenAlex Scout saved from the form, *try* with its credits line, and the
// kind kept once saved. The stand-in endpoint is the only place a request goes.

const NOW = new Date("2026-09-30T12:00:00Z");

const work = (n: number) => ({
  id: `https://openalex.org/W${n}`,
  title: `Sleep paper ${n}`,
  publication_date: "2026-09-22",
  primary_location: {
    source: { display_name: "Journal of Sleep", type: "journal" },
  },
});

async function opened(remaining: string | null = "940") {
  const vault = await fixtureCopy("obsidian-vault");
  const requests: URL[] = [];
  const c = await core({
    now: () => NOW,
    openalex: {
      clock: virtualClock(),
      fetch: (input) => {
        requests.push(urlOf(input));
        return Promise.resolve(
          Response.json(
            { meta: { count: 7 }, results: [1, 2, 3, 4, 5, 6].map(work) },
            {
              headers:
                remaining === null
                  ? {}
                  : { "x-ratelimit-remaining": remaining },
            }
          )
        );
      },
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  return { c, vault, requests };
}

const form = {
  name: "Published sleep",
  watching: "openalex",
  query: '"sleep consolidation"',
  cadence: "daily",
  assigned: [],
  lane: "review",
  searchBackTo: null,
};

describe("saving an OpenAlex Scout from the form", () => {
  it("writes source.kind openalex and the Filter, as a hand-written file reads", async () => {
    const { c, vault } = await opened();
    const saved = await c.mutate<{ id: string }>("scouts.save", form);
    expect(saved.error).toBeUndefined();
    const text = await readFile(
      join(vault, `.vitrine/scouts/${saved.result!.data.id}.yaml`),
      "utf8"
    );
    expect(text).toContain("kind: openalex");
    expect(text).toContain(`query: '"sleep consolidation"'`);
    const list = await c.query<{
      scouts: Array<{ source: unknown; query: string }>;
    }>("scouts.list");
    expect(list.result!.data.scouts[0]).toMatchObject({
      source: { kind: "openalex" },
      query: '"sleep consolidation"',
    });
  });

  it("refuses to change a saved Scout's kind", async () => {
    const { c } = await opened();
    const saved = await c.mutate<{ id: string }>("scouts.save", form);
    const r = await c.mutate("scouts.save", {
      ...form,
      id: saved.result!.data.id,
      watching: "arxiv",
    });
    expect(r.error?.message).toContain("A Scout keeps its kind of source");
  });
});

describe("try for OpenAlex", () => {
  it("sends the Query once and shows the total, five titles and the credits left", async () => {
    const { c, requests } = await opened("940");
    const r = await c.mutate<TriedQuery>("scouts.tryQuery", {
      query: '"sleep consolidation"',
      watching: "openalex",
    });
    expect(r.error).toBeUndefined();
    expect(r.result!.data).toEqual({
      outcome: "found",
      total: 7,
      titles: [
        "Sleep paper 1",
        "Sleep paper 2",
        "Sleep paper 3",
        "Sleep paper 4",
        "Sleep paper 5",
      ],
      creditsLeft: 940,
    });
    expect(requests).toHaveLength(1);
    const filter = requests[0]!.searchParams.get("filter")!;
    expect(filter).toContain("primary_location.source.type:journal|conference");
    expect(filter).toContain('title_and_abstract.search:"sleep consolidation"');
    expect(filter).not.toContain("publication_date");
  });

  it("says no credit figure when the answer carried no header", async () => {
    const { c } = await opened(null);
    const r = await c.mutate<TriedQuery>("scouts.tryQuery", {
      query: "sleep",
      watching: "openalex",
    });
    expect(r.result!.data).toMatchObject({
      outcome: "found",
      creditsLeft: null,
    });
  });

  it("states a failure in the sentence naming OpenAlex", async () => {
    const vault = await fixtureCopy("obsidian-vault");
    const c = await core({
      now: () => NOW,
      openalex: {
        clock: virtualClock(),
        fetch: () => Promise.resolve(new Response("", { status: 503 })),
      },
    });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    const r = await c.mutate<TriedQuery>("scouts.tryQuery", {
      query: "sleep",
      watching: "openalex",
    });
    expect(r.result!.data).toMatchObject({
      outcome: "failed",
      sentence: expect.stringContaining("OpenAlex") as string,
    });
  });
});

describe("the compiled query shown for OpenAlex Tags", () => {
  it("is the OpenAlex search, not arXiv's", async () => {
    const vault = await fixtureCopy("obsidian-vault");
    await mkdir(join(vault, ".vitrine"), { recursive: true });
    await writeFile(
      join(vault, ".vitrine/lexicon.json"),
      JSON.stringify({ ml: { seeds: ["alpha"], excluded: [] } })
    );
    const c = await core({ now: () => NOW });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    const r = await c.query<{ query: string }>("scouts.previewTags", {
      tags: ["ml"],
      source: "openalex",
    });
    expect(r.result!.data.query).toBe(
      'filter=title_and_abstract.search:("alpha")'
    );
  });
});

describe("Scout Activity's recorded query for an OpenAlex Scout", () => {
  it("is what the newest run sent, not what the Tags would compile to now", async () => {
    const { c, vault } = await opened();
    await mkdir(join(vault, ".vitrine"), { recursive: true });
    await writeFile(
      join(vault, ".vitrine/lexicon.json"),
      JSON.stringify({ ml: { seeds: ["alpha"], excluded: [] } })
    );
    const saved = await c.mutate<{ id: string }>("scouts.save", {
      ...form,
      query: "",
      tags: ["ml"],
    });
    expect(saved.error).toBeUndefined();
    await c.mutate("scouts.runNow", { scoutId: saved.result!.data.id });
    // A Seed made after the run changes the next query, not this record.
    await writeFile(
      join(vault, ".vitrine/lexicon.json"),
      JSON.stringify({ ml: { seeds: ["alpha", "beta"], excluded: [] } })
    );

    const activity = await c.query<{ rows: Array<{ lastQuery?: string }> }>(
      "scouts.activity"
    );

    expect(activity.result!.data.rows[0]!.lastQuery).toBe(
      'filter=title_and_abstract.search:("alpha")'
    );
  });

  it("is absent before any run", async () => {
    const { c } = await opened();
    await c.mutate("scouts.save", form);
    const activity = await c.query<{ rows: Array<{ lastQuery?: string }> }>(
      "scouts.activity"
    );
    expect(activity.result!.data.rows[0]!.lastQuery).toBeUndefined();
  });
});

describe("the venue allowlist from the form", () => {
  const venues = [
    { id: "S111", name: "Journal of Sleep" },
    { id: "S222", name: "Sleep Medicine" },
  ];

  it("stores each venue's ID and name under filter.venues, and reads them back", async () => {
    const { c, vault } = await opened();
    const saved = await c.mutate<{ id: string }>("scouts.save", {
      ...form,
      venues,
    });
    expect(saved.error).toBeUndefined();
    const text = await readFile(
      join(vault, `.vitrine/scouts/${saved.result!.data.id}.yaml`),
      "utf8"
    );
    expect(text).toContain("id: S111");
    expect(text).toContain("name: Journal of Sleep");
    const list = await c.query<{ scouts: Array<{ venues?: unknown }> }>(
      "scouts.list"
    );
    expect(list.result!.data.scouts[0]?.venues).toEqual(venues);
  });

  it("takes the key away when the list is emptied, and leaves it when the save says nothing", async () => {
    const { c, vault } = await opened();
    const saved = await c.mutate<{ id: string }>("scouts.save", {
      ...form,
      venues,
    });
    const file = join(vault, `.vitrine/scouts/${saved.result!.data.id}.yaml`);
    await c.mutate("scouts.save", {
      ...form,
      id: saved.result!.data.id,
      lane: "skim",
    });
    expect(await readFile(file, "utf8")).toContain("id: S111");
    await c.mutate("scouts.save", {
      ...form,
      id: saved.result!.data.id,
      venues: [],
    });
    expect(await readFile(file, "utf8")).not.toContain("venues");
  });

  it("refuses an allowlist on an arXiv Scout", async () => {
    const { c } = await opened();
    const r = await c.mutate("scouts.save", {
      ...form,
      watching: "arxiv",
      venues,
    });
    expect(r.error?.message).toContain("OpenAlex");
  });

  it("refuses an entry that is not a source ID", async () => {
    const { c } = await opened();
    const r = await c.mutate("scouts.save", {
      ...form,
      venues: [{ id: "S1,is_oa:true", name: "X" }],
    });
    expect(r.error?.message).toContain("venue");
  });

  it("tries the Query over only those venues", async () => {
    const { c, requests } = await opened();
    await c.mutate("scouts.tryQuery", {
      query: "sleep",
      watching: "openalex",
      venues,
    });
    expect(requests[0]!.searchParams.get("filter")).toContain(
      "primary_location.source.id:S111|S222"
    );
  });
});
