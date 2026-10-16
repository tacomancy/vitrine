import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryCredentialStore } from "./credentials.js";
import type { ModelProvider } from "./model-provider.js";
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

// #611 (spec #563, ADR 0043): after a page Scout is pointed elsewhere, every
// surface that reads it agrees. Driven through the router on a temp vault with
// a clock the test moves; what is read back is what each surface shows.

const START = Date.parse("2026-10-05T12:00:00Z");
const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;
const OLD = "https://lab.example/publications";
const NEW = "https://lab.example/moved";
const OTHER = "https://lab.example/other";
const NOT_READ = "Not yet — this page has not been read; first check due now.";

const scoutFile = (name: string, url: string) => `name: ${name}
source:
  kind: watched
  url: ${url}
cadence: weekly
lane: review
created: 2026-09-20T00:00:00Z
`;

async function opened(key: string | null) {
  const vault = await fixtureCopy("obsidian-vault");
  const put = async (id: string, text: string) => {
    const path = join(vault, `.vitrine/scouts/${id}.yaml`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  };
  await put("lab", scoutFile("Sleep Lab", OLD));
  const page = await readFile(
    join(fixtures, "watched", "lab-page.html"),
    "utf8"
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
      credentials: createMemoryCredentialStore(
        key === null ? {} : { anthropic: key }
      ),
      model: "claude-sonnet-5-5",
      fetch: (input) => {
        const path = urlOf(input).pathname;
        const known = ["/publications", "/moved", "/other"].includes(path);
        // Each page's text differs, so the page-unchanged lookup stays out of it.
        return Promise.resolve(
          known
            ? new Response(page.replace("</body>", `<p>${path}</p></body>`), {
                headers: { "content-type": "text/html" },
              })
            : new Response("", { status: 404 })
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
  const save = (id: string, name: string, query: string) =>
    ok("mutate", "scouts.save", {
      id,
      name,
      watching: "watched",
      query,
      cadence: "weekly",
      assigned: [],
      lane: "review",
      searchBackTo: null,
    });
  return {
    wait: (ms: number) => (at += ms),
    addOther: () => put("other", scoutFile("Other Lab", OTHER)),
    run: (scoutId: string) => ok("mutate", "scouts.runNow", { scoutId }),
    repoint: () => save("lab", "Sleep Lab", NEW),
    back: () => save("lab", "Sleep Lab", OLD),
    health: async (id: string) =>
      (
        await ok<{ scouts: Array<{ id: string; health: Health }> }>(
          "query",
          "scouts.health"
        )
      ).scouts.find((s) => s.id === id)!.health,
    waiting: () =>
      ok<Array<{ id: string }>>("query", "credentials.waiting", {
        provider: "anthropic",
      }).then((rows) => rows.map((r) => r.id)),
    fleet: () => ok<{ claim: string | null }>("query", "scouts.fleet"),
    activity: () =>
      ok<{
        fleet: Record<string, number>;
        rows: Array<{ id: string; health: Health }>;
      }>("query", "scouts.activity"),
    blocked: async () =>
      (
        await ok<{
          groups: Array<{ rows: Array<{ kind: string; subject: string }> }>;
        }>("query", "looseEnds.rows")
      ).groups
        .flatMap((g) => g.rows)
        .filter((r) => r.kind === "blocked-on-credentials")
        .map((r) => r.subject),
  };
}

describe("a Scout waiting on a key, pointed at another page", () => {
  it("is waiting only at the page that refused it: Settings' list and the other surfaces follow its Voice", async () => {
    const c = await opened(null);
    await c.run("lab");
    expect(await c.waiting()).toEqual(["lab"]);
    expect(await c.blocked()).toEqual(["lab"]);
    expect((await c.activity()).fleet).toMatchObject({ noKey: 1 });

    await c.repoint();

    // The new page has not been read: nothing waits on a key for it yet.
    expect(await c.health("lab")).toEqual({
      voice: "not yet",
      sentence: NOT_READ,
    });
    expect(await c.waiting()).toEqual([]);
    expect(await c.blocked()).toEqual([]);
    const activity = await c.activity();
    expect(activity.fleet).toMatchObject({ noKey: 0, notParsing: 0 });
    expect(activity.rows[0]!.health).toEqual({
      voice: "not yet",
      sentence: NOT_READ,
    });

    // Its first look there is refused for want of the key, and it waits again.
    await c.run("lab");
    expect(await c.waiting()).toEqual(["lab"]);
    expect((await c.activity()).fleet).toMatchObject({ noKey: 1 });
  });

  it("is waiting again once pointed back at the page that refused it", async () => {
    const c = await opened(null);
    await c.run("lab");
    await c.repoint();
    expect(await c.waiting()).toEqual([]);

    await c.back();

    expect(await c.waiting()).toEqual(["lab"]);
  });
});

describe("the fleet's claim, after a Scout is pointed elsewhere", () => {
  it("cites the newest run at the pages the Scouts watch now, never one at a page nobody reads", async () => {
    const c = await opened("sk-test");
    await c.addOther();
    await c.run("other");
    c.wait(2 * HOUR);
    await c.run("lab");
    c.wait(WEEK / 7 - 2 * HOUR);
    expect((await c.fleet()).claim).toContain("newest run");

    await c.repoint();

    // lab ran two hours after other; that run is at a page nobody reads now.
    const claim = (await c.fleet()).claim!;
    expect(claim).toContain("1 scout watching");
    expect(claim).toContain("newest run 1 day ago");
    expect(claim).toContain("Sleep Lab not looking");
  });
});
