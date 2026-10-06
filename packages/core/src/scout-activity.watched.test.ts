import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryCredentialStore } from "./credentials.js";
import type { ModelProvider } from "./model-provider.js";
import type { ScoutActivity } from "./scout-activity.js";
import {
  closeCores,
  core,
  fixtureCopy,
  fixtures,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// What a Watched Scout's row says it last did (#513; ADR 0042 decision 6): a
// check refused for want of a key read nothing, so it is not a time the Scout
// looked. The page, the model and the key are injected stand-ins.

const START = Date.parse("2026-09-30T12:00:00Z");
const HOUR = 3_600_000;
const LAB = "https://lab.example/publications";

const SCOUT = `name: Sleep Lab
source:
  kind: watched
  url: ${LAB}
cadence: weekly
lane: review
created: 2026-09-20T00:00:00Z
`;

async function opened(key: string | null) {
  const vault = await fixtureCopy("obsidian-vault");
  const path = join(vault, ".vitrine/scouts/lab.yaml");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, SCOUT);
  const page = await readFile(
    join(fixtures, "watched", "lab-page.html"),
    "utf8"
  );
  const store = createMemoryCredentialStore(
    key === null ? {} : { anthropic: key }
  );
  const models: ModelProvider = {
    countTokens: ({ text }) => Promise.resolve(Math.ceil(text.length / 4)),
    extract: () =>
      Promise.resolve({
        items: [
          {
            title: "Sleep Spindles Predict Next-Day Learning",
            authors: null,
            date: null,
            venue: null,
            keywords: null,
            abstract: null,
            url: "https://lab.example/papers/spindles/",
          },
        ],
        usage: { input: 1200, output: 300, cacheRead: 0 },
      }),
  };
  let at = START;
  const c = await core({
    now: () => new Date(at),
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
  return {
    store,
    advance: (ms: number) => void (at += ms),
    run: async () => {
      const r = await c.mutate("scouts.runNow", { scoutId: "lab" });
      expect(r.error).toBeUndefined();
    },
    row: async () => {
      const r = await c.query<ScoutActivity>("scouts.activity");
      expect(r.error).toBeUndefined();
      return r.result!.data.rows[0]!;
    },
  };
}

const WAITING = {
  voice: "not yet",
  kind: "credentials",
  sentence: "No model key is stored, so this page has not been read yet.",
};

describe("scouts.activity — the last run of a page that needs a key", () => {
  it("is none for a Scout whose only check was refused for want of a key: it has not looked, and says why", async () => {
    const lab = await opened(null);
    await lab.run();

    expect(await lab.row()).toMatchObject({
      kind: "scout",
      lastRun: null,
      health: WAITING,
    });
  });

  it("is the last time it read the page when a later check was refused: the key going is not a look", async () => {
    const lab = await opened("sk-test");
    await lab.run();
    await lab.store.delete("anthropic");
    lab.advance(2 * HOUR);
    await lab.run();

    expect(await lab.row()).toMatchObject({
      lastRun: { finished: new Date(START).toISOString(), ago: "2h ago" },
      health: WAITING,
    });
  });
});
