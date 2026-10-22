import { readFile } from "node:fs/promises";
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
    const { writeFile, mkdir } = await import("node:fs/promises");
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
