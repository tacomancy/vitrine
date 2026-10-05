import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryCredentialStore } from "./credentials.js";
import type { LooseEnds } from "./loose-ends.js";
import {
  ModelError,
  type ExtractedItem,
  type Extraction,
  type ModelProvider,
} from "./model-provider.js";
import type { FleetHealth } from "./scout-health.js";
import {
  closeCores,
  core,
  fixtureCopy,
  fixtures,
  urlOf,
  virtualClock,
} from "./test-core.js";

// Loose Ends' watched-source rows (#470; spec #463 stories 77–83; ADR 0040
// decision 7): a page whose structure changed, a Scout blocked on its key,
// and the cost line. The page, the model and the key are injected stand-ins.

afterEach(closeCores);

const NOW = new Date("2026-09-30T12:34:00Z");
const LAB = "https://lab.example/publications";
const fixture = (name: string) =>
  readFile(join(fixtures, "watched", name), "utf8");
const PAGE = await fixture("lab-page.html");
const REDESIGNED = await fixture("lab-page-redesigned.html");

const SCOUT = `name: Sleep Lab
source:
  kind: watched
  url: ${LAB}
cadence: weekly
lane: review
created: 2026-09-20T00:00:00Z
`;

const item = (title: string, url: string): ExtractedItem => ({
  title,
  authors: null,
  date: null,
  venue: null,
  keywords: null,
  abstract: null,
  url,
});
const GOOD = [
  item(
    "Sleep Spindles Predict Next-Day Learning",
    "https://lab.example/papers/spindles/"
  ),
];
const usage = { input: 1200, output: 300, cacheRead: 0 };

async function opened(key: string | null = "sk-test") {
  const vault = await fixtureCopy("obsidian-vault");
  const path = join(vault, ".vitrine/scouts/lab.yaml");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, SCOUT);
  let page = PAGE;
  let answer: Extraction | Error = { items: GOOD, usage };
  const store = createMemoryCredentialStore(
    key === null ? {} : { anthropic: key }
  );
  const models: ModelProvider = {
    countTokens: ({ text }) => Promise.resolve(Math.ceil(text.length / 4)),
    extract: () =>
      answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer),
  };
  const c = await core({
    now: () => NOW,
    arxiv: {
      clock: virtualClock(),
      fetch: () => Promise.resolve(new Response("")),
    },
    watched: {
      timeoutMs: 1000,
      models,
      credentials: store,
      fetch: (input) =>
        Promise.resolve(
          urlOf(input).pathname === "/robots.txt"
            ? new Response("", { status: 404 })
            : new Response(page, { headers: { "content-type": "text/html" } })
        ),
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const rows = async (kind: string) => {
    const r = await c.query<LooseEnds>("looseEnds.rows");
    expect(r.error).toBeUndefined();
    return r.result!.data.groups.flatMap(({ group, rows }) =>
      rows.filter((row) => row.kind === kind).map((row) => ({ group, row }))
    );
  };
  const all = async () =>
    (await c.query<LooseEnds>("looseEnds.rows")).result!.data.groups.flatMap(
      (g) => g.rows
    );
  const health = async () => {
    const r = await c.query<FleetHealth>("scouts.health");
    expect(r.error).toBeUndefined();
    return r.result!.data.scouts.find((s) => s.id === "lab")!;
  };
  return {
    c,
    store,
    rows,
    all,
    health,
    run: () => c.mutate("scouts.runNow", { scoutId: "lab" }),
    page: (next: string) => (page = next),
    answer: (next: Extraction | Error) => (answer = next),
  };
}

describe("looseEnds.rows — a page whose structure changed", () => {
  it("is one row with the rail's sentence, replacing the generic failed row", async () => {
    const lab = await opened();
    await lab.run();
    lab.page(REDESIGNED);
    lab.answer({ items: [], usage });
    await lab.run();

    const h = (await lab.health()).health as {
      voice: string;
      sentence: string;
    };
    expect(h.voice).toBe("wrong");
    expect(await lab.rows("structure-change")).toEqual([
      {
        group: "Broken plumbing",
        row: {
          kind: "structure-change",
          subject: "lab",
          path: ".vitrine/scouts/lab.yaml",
          title: "Sleep Lab",
          address: LAB,
          sentence: h.sentence,
        },
      },
    ]);
    expect(await lab.rows("failed-scout")).toEqual([]);
    expect((await lab.all()).filter((r) => r.subject === "lab")).toHaveLength(
      1
    );
  });

  it("stays the generic row on a first-ever extraction failure", async () => {
    const lab = await opened();
    lab.answer({ items: [], usage });
    await lab.run();

    expect(await lab.rows("structure-change")).toEqual([]);
    expect(await lab.rows("failed-scout")).toMatchObject([
      { row: { errorKind: "extraction" } },
    ]);
  });
});

describe("looseEnds.rows — blocked on credentials", () => {
  it("says no key in the not-yet voice, with the rail's sentence", async () => {
    const lab = await opened(null);
    await lab.run();

    const h = (await lab.health()).health as {
      voice: string;
      sentence: string;
    };
    expect(h.voice).toBe("not yet");
    expect(await lab.rows("blocked-on-credentials")).toEqual([
      {
        group: "Broken plumbing",
        row: {
          kind: "blocked-on-credentials",
          subject: "lab",
          path: ".vitrine/scouts/lab.yaml",
          title: "Sleep Lab",
          voice: "not yet",
          sentence: h.sentence,
        },
      },
    ]);
    expect(await lab.rows("failed-scout")).toEqual([]);
  });

  it("says a rejected key in the fault voice", async () => {
    const lab = await opened();
    lab.answer(new ModelError("credentials", "key rejected"));
    await lab.run();

    expect(await lab.rows("blocked-on-credentials")).toMatchObject([
      { row: { voice: "wrong" } },
    ]);
    expect(await lab.rows("failed-scout")).toEqual([]);
  });

  it("clears once a key is stored and the Scout runs", async () => {
    const lab = await opened(null);
    await lab.run();
    expect(await lab.rows("blocked-on-credentials")).toHaveLength(1);

    await lab.store.set("anthropic", "sk-test");
    await lab.run();
    expect(await lab.rows("blocked-on-credentials")).toEqual([]);
  });

  it("is not a row for a paused Scout", async () => {
    const lab = await opened(null);
    await lab.run();
    await lab.c.mutate("scouts.pause", { scoutId: "lab" });
    expect(await lab.rows("blocked-on-credentials")).toEqual([]);
  });
});

describe("scouts.health — the last run's cost", () => {
  it("carries the newest run's cost, and nothing for a run that cost nothing", async () => {
    const lab = await opened();
    await lab.run();
    const cost = (await lab.health()).lastCostUsd;
    expect(cost).toBeGreaterThan(0);

    const free = await opened(null);
    await free.run();
    expect((await free.health()).lastCostUsd).toBeNull();
  });
});
