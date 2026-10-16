import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryCredentialStore } from "./credentials.js";
import { ModelError, type Extraction } from "./model-provider.js";
import type { Health } from "./scout-health.js";
import {
  closeCores,
  core,
  fixtureCopy,
  fixtures,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// #610 (spec #563, ADR 0043 decisions 4 and 6): a page the Scout was pointed
// at that lists nothing says so, and a failed first look names the edit. The
// papers the old page listed are on the Scout's record, not on the new page's.

const NOW = new Date("2026-10-05T12:00:00Z");
const OLD = "https://lab.example/publications";
const NEW = "https://lab.example/moved";
const CLAUSE = " Its page changed since it last ran cleanly.";
const usage = { input: 1200, output: 300, cacheRead: 0 };
const GOOD: Extraction = {
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
  usage,
};
// A paper the old page never listed, so the first look at the new one adds it.
const FRESH: Extraction = {
  items: [
    {
      ...GOOD.items[0]!,
      title: "Spindle Density Survives A Week Of Sleep Restriction",
      url: "https://lab.example/papers/restriction/",
    },
  ],
  usage,
};
const NONE: Extraction = { items: [], usage };

const fixture = (name: string) =>
  readFile(join(fixtures, "watched", name), "utf8");

async function opened(key: string | null = "sk-test") {
  const vault = await fixtureCopy("obsidian-vault");
  const path = join(vault, ".vitrine/scouts/lab.yaml");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `name: Sleep Lab
source:
  kind: watched
  url: ${OLD}
cadence: weekly
lane: review
created: 2026-09-20T00:00:00Z
`
  );
  const pages: Record<string, string> = {
    "/publications": await fixture("lab-page.html"),
    // Another page that lists the same paper, so it is not the old page's text.
    "/moved": (await fixture("lab-page.html")).replace(
      "</body>",
      `<p><a href="${FRESH.items[0]!.url}">${FRESH.items[0]!.title}</a></p></body>`
    ),
  };
  let answer: Extraction | Error = GOOD;
  const c = await core({
    now: () => NOW,
    arxiv: {
      clock: virtualClock(),
      fetch: () => Promise.resolve(new Response("")),
    },
    watched: {
      timeoutMs: 1000,
      models: {
        countTokens: ({ text }) => Promise.resolve(Math.ceil(text.length / 4)),
        extract: () =>
          answer instanceof Error
            ? Promise.reject(answer)
            : Promise.resolve(answer),
      },
      credentials: createMemoryCredentialStore(
        key === null ? {} : { anthropic: key }
      ),
      model: "claude-sonnet-5-5",
      fetch: (input) => {
        const path = urlOf(input).pathname;
        const body = pages[path];
        return Promise.resolve(
          body === undefined
            ? new Response("", { status: path === "/robots.txt" ? 404 : 500 })
            : new Response(body, { headers: { "content-type": "text/html" } })
        );
      },
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const ok = async <T>(
    kind: "query" | "mutate",
    route: string,
    input?: unknown
  ) => {
    const r = await c[kind]<T>(route, input);
    expect(r.error).toBeUndefined();
    return r.result!.data;
  };
  return {
    answer: (next: Extraction | Error) => (answer = next),
    breakNewPage: () => delete pages["/moved"],
    redesignNewPage: async () =>
      (pages["/moved"] = await fixture("lab-page-redesigned.html")),
    run: () => ok("mutate", "scouts.runNow", { scoutId: "lab" }),
    repoint: () =>
      ok("mutate", "scouts.save", {
        id: "lab",
        name: "Sleep Lab",
        watching: "watched",
        query: NEW,
        cadence: "weekly",
        assigned: [],
        lane: "review",
        searchBackTo: null,
      }),
    health: async () =>
      (
        await ok<{ scouts: Array<{ id: string; health: Health }> }>(
          "query",
          "scouts.health"
        )
      ).scouts.find((s) => s.id === "lab")!.health,
    rows: async () =>
      (
        await ok<{
          groups: Array<{ rows: Array<{ kind: string; subject: string }> }>;
        }>("query", "looseEnds.rows")
      ).groups
        .flatMap((g) => g.rows)
        .filter((r) => r.subject === "lab")
        .map((r) => r.kind),
    lastError: async () =>
      (
        await ok<{ scouts: Array<{ id: string; health: Health }> }>(
          "query",
          "scouts.health"
        )
      ).scouts.find((s) => s.id === "lab")!.health as Health & {
        sentence: string;
      },
  };
}

describe("a Scout pointed at a page that lists nothing", () => {
  it("says no listing found, and Loose Ends shows the generic failed row, not a structure change", async () => {
    const lab = await opened();
    await lab.run();
    await lab.repoint();
    lab.answer(NONE);

    await lab.run();

    expect(await lab.lastError()).toMatchObject({
      voice: "wrong",
      sentence: `The model found no papers listed on this page.${CLAUSE}`,
    });
    expect(await lab.rows()).toEqual(["failed-scout"]);
  });

  it("still calls a page that once yielded items and now yields none a structure change", async () => {
    const lab = await opened();
    await lab.run();
    await lab.repoint();
    lab.answer(FRESH);
    await lab.run();
    await lab.redesignNewPage();
    lab.answer(NONE);
    await lab.run();

    expect(await lab.lastError()).toMatchObject({
      sentence: expect.stringContaining("its structure changed") as string,
    });
    expect(await lab.rows()).toEqual(["structure-change"]);
  });
});

describe("a failed first look at a changed page", () => {
  it("ends with the page-changed clause when an earlier clean run read another page", async () => {
    const lab = await opened();
    await lab.run();
    await lab.repoint();
    lab.breakNewPage();

    await lab.run();

    const { sentence } = await lab.lastError();
    expect(sentence).toMatch(/HTTP 500/);
    expect(sentence.endsWith(CLAUSE)).toBe(true);
  });

  it("ends an extraction fault with it too", async () => {
    const lab = await opened();
    await lab.run();
    await lab.repoint();
    lab.answer(NONE);

    await lab.run();

    expect((await lab.lastError()).sentence.endsWith(CLAUSE)).toBe(true);
  });

  it("does not for a rejected key", async () => {
    const lab = await opened();
    await lab.run();
    await lab.repoint();
    lab.answer(new ModelError("credentials", "key rejected"));

    await lab.run();

    expect((await lab.lastError()).sentence).toBe(
      "The model provider refused the stored key, so nothing was checked."
    );
  });

  it("does not when no clean run read another page", async () => {
    const lab = await opened();
    lab.breakNewPage();
    await lab.repoint();

    await lab.run();

    expect((await lab.lastError()).sentence.endsWith(CLAUSE)).toBe(false);
  });

  it("does not once the new page has been read cleanly", async () => {
    const lab = await opened();
    await lab.run();
    await lab.repoint();
    lab.answer(FRESH);
    await lab.run();
    lab.breakNewPage();

    await lab.run();

    expect((await lab.lastError()).sentence.endsWith(CLAUSE)).toBe(false);
  });
});
