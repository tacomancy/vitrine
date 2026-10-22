import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Accepted, Card, RunSummary } from "./scouts.js";
import type { Muted } from "./mutes.js";
import {
  closeCores,
  core,
  fixtureCopy,
  hashOf,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// One work, two sources (#808, ADR 0051 decisions 10–11): an arXiv Scout and
// an OpenAlex Scout that find the same paper make one card with two
// Appearances. A later sighting fills what is missing and overwrites nothing.
// Both sources are stand-ins; nothing here reaches either API.

const NOW = new Date("2026-09-30T12:34:00Z");
const ARXIV_SOURCE = "https://openalex.org/S4306400194";
const ARXIV_URL = "https://arxiv.org/abs/2609.00001";
const JOURNAL_URL = "https://journal.example/slow";

const ARXIV_SCOUT = `name: Preprints\ncadence: daily\nlane: review\ncreated: 2026-09-20T00:00:00Z\nfilter:\n  query: all:sleep\n`;
const OPENALEX_SCOUT = `name: Published\nsource:\n  kind: openalex\ncadence: daily\nlane: review\ncreated: 2026-09-20T00:00:00Z\nfilter:\n  query: '"sleep"'\n`;

type Work = Record<string, unknown>;

/** The work as OpenAlex answers it: a journal primary location and an arXiv copy. */
const published = (over: Work = {}): Work => ({
  id: "https://openalex.org/W1",
  doi: "https://doi.org/10.1000/slow",
  title: "Slow Oscillations Reconsidered",
  publication_date: "2026-09-22",
  authorships: [{ author: { display_name: "Ada Meer" } }],
  abstract_inverted_index: { Sleep: [0], helps: [1] },
  primary_location: {
    landing_page_url: JOURNAL_URL,
    source: {
      id: "https://openalex.org/S99",
      display_name: "Journal of Sleep",
      type: "journal",
      host_organization: "https://openalex.org/P7",
      host_organization_name: "Press Seven",
      host_organization_lineage: ["https://openalex.org/P7"],
    },
  },
  locations: [
    {
      landing_page_url: JOURNAL_URL,
      source: { id: "https://openalex.org/S99" },
    },
    { landing_page_url: ARXIV_URL, source: { id: ARXIV_SOURCE } },
  ],
  ...over,
});

const entry = (over: { venue?: string; abstract?: string } = {}) =>
  `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>1</opensearch:totalResults><entry><id>http://arxiv.org/abs/2609.00001v1</id><published>2026-09-21T00:00:00Z</published><title>Slow Oscillations Reconsidered</title><summary>${over.abstract ?? "Preprint abstract."}</summary><author><name>Ada Meer</name></author><link href="${ARXIV_URL}v1" rel="alternate"/>${over.venue === undefined ? "" : `<arxiv:journal_ref>${over.venue}</arxiv:journal_ref>`}</entry></feed>`;

async function opened(arxivFeed: string, work: Work, mutes?: string) {
  const vault = await fixtureCopy("obsidian-vault");
  const files: Record<string, string> = {
    ".vitrine/scouts/arx.yaml": ARXIV_SCOUT,
    ".vitrine/scouts/pub.yaml": OPENALEX_SCOUT,
    ...(mutes === undefined ? {} : { ".vitrine/mutes.yaml": mutes }),
  };
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(vault, file)), { recursive: true });
    await writeFile(join(vault, file), text);
  }
  const c = await core({
    now: () => NOW,
    arxiv: {
      clock: virtualClock(),
      fetch: (input) => {
        urlOf(input);
        return Promise.resolve(new Response(arxivFeed));
      },
    },
    openalex: {
      clock: virtualClock(),
      fetch: (input) => {
        urlOf(input);
        return Promise.resolve(
          Response.json({ meta: { count: 1 }, results: [work] })
        );
      },
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const read = async <T>(path: string) => {
    const r = await c.query<T>(path, { sort: "newest" });
    expect(r.error).toBeUndefined();
    return r.result!.data;
  };
  return {
    vault,
    run: async (scoutId: "arx" | "pub") => {
      const r = await c.mutate<RunSummary>("scouts.runNow", { scoutId });
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
    cards: () => read<Card[]>("scouts.queue"),
    muted: () => read<Muted>("scouts.muted"),
    accept: async (proposalId: number) => {
      const r = await c.mutate<Accepted>("scouts.accept", { proposalId });
      expect(r.error).toBeUndefined();
      return r.result!.data;
    },
  };
}

describe("two sources, one work", () => {
  it("makes one card with two Appearances, whichever Scout runs first", async () => {
    for (const order of [
      ["arx", "pub"],
      ["pub", "arx"],
    ] as const) {
      const q = await opened(entry(), published());
      await q.run(order[0]);
      await q.run(order[1]);
      const cards = await q.cards();
      expect(cards).toHaveLength(1);
      expect(cards[0]!.scouts.map((s) => s.id).sort()).toEqual(["arx", "pub"]);
      await closeCores();
    }
  });

  it("leads with the journal link and keeps the arXiv link as also on arXiv", async () => {
    for (const order of [
      ["arx", "pub"],
      ["pub", "arx"],
    ] as const) {
      const q = await opened(entry(), published());
      await q.run(order[0]);
      await q.run(order[1]);
      const [card] = await q.cards();
      expect(card).toMatchObject({ url: JOURNAL_URL, alsoOnArxiv: ARXIV_URL });
      await closeCores();
    }
  });

  it("says nothing of arXiv on a card only arXiv found, or only a journal", async () => {
    const q = await opened(entry(), published({ locations: [] }));
    await q.run("arx");
    expect((await q.cards())[0]).toMatchObject({
      url: `${ARXIV_URL}v1`,
      alsoOnArxiv: null,
    });
    await closeCores();
    const p = await opened(entry(), published({ locations: [] }));
    await p.run("pub");
    expect((await p.cards())[0]).toMatchObject({
      url: JOURNAL_URL,
      alsoOnArxiv: null,
    });
  });
});

describe("a later sighting fills what is missing", () => {
  it("gives an arXiv-first card the venue, publisher, DOI and source ID", async () => {
    const q = await opened(entry(), published());
    await q.run("arx");
    expect((await q.cards())[0]).toMatchObject({
      venue: null,
      doi: null,
      venueId: null,
      publisher: null,
    });
    await q.run("pub");
    expect((await q.cards())[0]).toMatchObject({
      venue: "Journal of Sleep",
      venueType: "journal",
      doi: "10.1000/slow",
      venueId: "S99",
      publisher: { id: "P7", name: "Press Seven" },
    });
  });

  it("overwrites no field already present", async () => {
    const q = await opened(
      entry({ venue: "Preprint Letters", abstract: "Preprint abstract." }),
      published()
    );
    await q.run("arx");
    await q.run("pub");
    const [card] = await q.cards();
    expect(card).toMatchObject({
      venue: "Preprint Letters",
      abstract: "Preprint abstract.",
      venueId: "S99",
    });
  });

  it("moves an arXiv-first card to the muted view once its venue is learned to be muted", async () => {
    const q = await opened(
      entry(),
      published(),
      "venues:\n  - name: Journal of Sleep\n    id: S99\n"
    );
    await q.run("arx");
    expect(await q.cards()).toHaveLength(1);
    await q.run("pub");
    expect(await q.cards()).toHaveLength(0);
    expect((await q.muted()).items.map((i) => i.title)).toEqual([
      "Slow Oscillations Reconsidered",
    ]);
  });
});

describe("an accepted stub", () => {
  it("is not rewritten by a later sighting", async () => {
    const q = await opened(entry(), published());
    await q.run("arx");
    const [card] = await q.cards();
    const { path } = await q.accept(card!.id);
    const file = join(q.vault, path);
    const before = await hashOf(file);
    const text = await readFile(file, "utf8");
    await q.run("pub");
    expect(await hashOf(file)).toBe(before);
    expect(await readFile(file, "utf8")).toBe(text);
    expect(text).not.toContain("Journal of Sleep");
  });
});
