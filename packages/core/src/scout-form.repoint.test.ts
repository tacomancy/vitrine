import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
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

// #614 (spec #563, ADR 0043): a saved page Scout is pointed at another page on
// the form. Driven through the router on a temp vault with a clock the test
// moves, the page and the model injected. What is read back is what the
// researcher sees (the Voice, the Warrant, what is due) and the file's bytes.

const START = Date.parse("2026-10-05T12:00:00Z");
const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;
const OLD = "https://lab.example/publications";
const NEW = "https://lab.example/moved";
const NOT_READ = "Not yet — this page has not been read; first check due now.";

const FILE = `# the sleep lab's page
name: Sleep Lab
source:
  kind: watched
  url: ${OLD} # moved in the spring
cadence: weekly
lane: review
created: 2026-09-20T00:00:00Z
cap: 40 # a later beat's key
`;

async function opened(
  options: {
    text?: string;
    served?: (path: string) => string | undefined;
    key?: string | null;
  } = {}
) {
  const vault = await fixtureCopy("obsidian-vault");
  const path = join(vault, ".vitrine/scouts/lab.yaml");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, options.text ?? FILE);
  const page = await readFile(
    join(fixtures, "watched", "lab-page.html"),
    "utf8"
  );
  // The new page lists the same papers under other markup, so its text differs
  // from the old one's and the page-unchanged lookup does not mask the test.
  const served =
    options.served ??
    ((p: string) =>
      p === "/publications"
        ? page
        : p === "/moved"
          ? page.replace("</body>", "<p>Moved here in October.</p></body>")
          : undefined);
  let at = START;
  let extractions = 0;
  const models: ModelProvider = {
    countTokens: ({ text }) => Promise.resolve(Math.ceil(text.length / 4)),
    extract: () => {
      extractions++;
      return Promise.resolve({
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
      });
    },
  };
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
        options.key === null ? {} : { anthropic: options.key ?? "sk-test" }
      ),
      model: "claude-sonnet-5-5",
      fetch: (input) => {
        const body = served(urlOf(input).pathname);
        return Promise.resolve(
          body === undefined
            ? new Response("", { status: 404 })
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
  const form = (input: Record<string, unknown>) => ({
    id: "lab",
    name: "Sleep Lab",
    watching: "watched",
    query: OLD,
    cadence: "weekly",
    assigned: [],
    lane: "review",
    searchBackTo: null,
    ...input,
  });
  const db = <T>(sql: string, write = false) => {
    const handle = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"), {
      readOnly: !write,
    });
    try {
      return write
        ? (handle.exec(sql) as unknown as T)
        : (handle.prepare(sql).all() as T);
    } finally {
      handle.close();
    }
  };
  return {
    c,
    vault,
    extractions: () => extractions,
    wait: (ms: number) => (at += ms),
    save: (input: Record<string, unknown>) =>
      ok<{ id: string; run: unknown }>("mutate", "scouts.save", form(input)),
    refused: (input: Record<string, unknown>) =>
      c.mutate("scouts.save", form(input)),
    run: () => ok("mutate", "scouts.runNow", { scoutId: "lab" }),
    checkDue: () => ok<string[]>("mutate", "scouts.checkDue"),
    setCadence: (cadence: string) =>
      ok<{ dueAtNextCheck: boolean }>("mutate", "scouts.setCadence", {
        scoutId: "lab",
        cadence,
      }),
    health: async () =>
      (
        await ok<{ scouts: Array<{ id: string; health: Health }> }>(
          "query",
          "scouts.health"
        )
      ).scouts[0]!.health,
    file: () => readFile(join(vault, ".vitrine/scouts/lab.yaml"), "utf8"),
    runs: () =>
      db<Array<{ query: string | null }>>("SELECT query FROM scout_runs"),
    sql: (statement: string) => db(statement, true),
  };
}

type Opened = Awaited<ReturnType<typeof opened>>;

/** Three clean weekly looks at the old page, so it has a baseline to lend. */
async function read(c: Opened, times: number) {
  for (let n = 0; n < times; n++) {
    await c.run();
    c.wait(WEEK);
  }
}

const warrant = (health: Health) =>
  health.voice === "claim" ? health.warrant : undefined;

describe("pointing a saved page Scout at another page", () => {
  it("writes source.url and nothing else, keeps comments, order and unknown keys, and runs nothing", async () => {
    const c = await opened();

    const saved = await c.save({ query: `  ${NEW}  ` });

    expect(saved.run).toBeNull();
    expect(await c.file()).toBe(FILE.replace(`url: ${OLD}`, `url: ${NEW}`));
    expect(c.runs()).toEqual([]);
    expect(c.extractions()).toBe(0);
  });

  it("keeps a paused Scout paused", async () => {
    const paused = `${FILE}paused: true\n`;
    const c = await opened({ text: paused });

    await c.save({ query: NEW });

    expect(await c.file()).toBe(paused.replace(`url: ${OLD}`, `url: ${NEW}`));
    expect((await c.health()).voice).toBe("not yet");
    expect(c.runs()).toEqual([]);
  });

  it("refuses an address that is not a web address, and writes nothing", async () => {
    const c = await opened();

    const reply = await c.refused({ query: "lab.example/moved" });

    expect(reply.error?.message).toBe(
      "An address needs to start with http:// or https://."
    );
    expect(await c.file()).toBe(FILE);
  });

  it("refuses a switch between a page and arXiv, in words about a kind of source, and writes nothing", async () => {
    const c = await opened();

    const toArxiv = await c.refused({ watching: "arxiv", query: "all:sleep" });

    expect(toArxiv.error?.message).toBe(
      "A Scout keeps its kind of source. To watch arXiv instead, make a new Scout."
    );
    expect(toArxiv.error?.data).toMatchObject({ kind: "refused" });
    expect(await c.file()).toBe(FILE);

    const arxiv = await opened({
      text: `name: Sleep\nsource:\n  kind: arxiv\nfilter:\n  query: all:sleep\ncadence: daily\nlane: review\ncreated: 2026-09-20T00:00:00Z\n`,
    });
    const toPage = await arxiv.refused({ query: NEW });
    expect(toPage.error?.message).toBe(
      "A Scout keeps its kind of source. To watch a page instead, make a new Scout."
    );
  });

  it("refuses a dropped Scout until it is restored", async () => {
    const dropped = `${FILE}dropped: 2026-10-01T00:00:00Z\n`;
    const c = await opened({ text: dropped });

    const reply = await c.refused({ query: NEW });

    expect(reply.error?.data).toMatchObject({ kind: "refused" });
    expect(await c.file()).toBe(dropped);
  });

  it("still saves an arXiv Query edit as before: it runs at once", async () => {
    const c = await opened({
      text: `name: Sleep\nsource:\n  kind: arxiv\nfilter:\n  query: all:sleep\ncadence: daily\nlane: review\ncreated: 2026-09-20T00:00:00Z\n`,
    });

    const saved = await c.save({ watching: "arxiv", query: "all:memory" });

    expect(saved.run).not.toBeNull();
    expect(await c.file()).toContain("query: all:memory");
  });
});

describe("what a re-pointed Scout says about its page", () => {
  it("says the page has not been read, where a Scout that never ran says its own sentence", async () => {
    const never = await opened();
    expect(await never.health()).toEqual({
      voice: "not yet",
      sentence: "Not yet — first check due now.",
    });
    await never.save({ query: NEW });
    // No run of any page: nothing was read, so nothing was read elsewhere.
    expect(await never.health()).toEqual({
      voice: "not yet",
      sentence: "Not yet — first check due now.",
    });

    const c = await opened();
    await read(c, 1);
    expect((await c.health()).voice).toBe("claim");

    await c.save({ query: NEW });

    expect(await c.health()).toEqual({ voice: "not yet", sentence: NOT_READ });
  });

  it("does not show the old page's failure against the new page", async () => {
    // The old page answers 404; the new one is fine.
    const c = await opened({
      served: (p) => (p === "/moved" ? "<p>x</p>" : undefined),
    });
    await c.run();
    expect((await c.health()).voice).toBe("wrong");

    await c.save({ query: NEW });

    expect(await c.health()).toEqual({ voice: "not yet", sentence: NOT_READ });
  });

  it("lends the new page none of the old page's clean runs: no baseline yet until three have read it", async () => {
    const c = await opened();
    await read(c, 3);
    expect(warrant(await c.health())?.fragments[2]).not.toBe("no baseline yet");

    await c.save({ query: NEW });
    await c.run();

    const health = await c.health();
    expect(warrant(health)?.fragments[1]).toBe("parsed cleanly");
    expect(warrant(health)?.fragments[2]).toBe("no baseline yet");
  });

  it("is due at the next check, however long the cadence", async () => {
    const c = await opened();
    await c.run();
    c.wait(HOUR);
    // An hour after a clean weekly look, nothing is due.
    expect(await c.checkDue()).toEqual([]);

    await c.save({ query: NEW });

    expect(await c.checkDue()).toEqual(["lab"]);
    expect(c.runs().map((r) => r.query)).toEqual([OLD, NEW]);
  });

  it("is already due, so the cadence menu names no cadence that would make it so", async () => {
    const c = await opened();
    await c.run();
    c.wait(HOUR);
    // Before the change a shorter cadence would bring a run at the next check.
    expect((await c.setCadence("daily")).dueAtNextCheck).toBe(false);
    await c.setCadence("weekly");

    await c.save({ query: NEW });

    // Due already, so the change is not what makes it so.
    expect((await c.setCadence("daily")).dueAtNextCheck).toBe(false);
  });

  it("takes a run from before the page was recorded for one at this page, never for an edit", async () => {
    const c = await opened();
    await c.run();
    c.sql("UPDATE scout_runs SET query = NULL");
    c.wait(HOUR);

    const health = await c.health();

    expect(health.voice).toBe("claim");
    expect(await c.checkDue()).toEqual([]);
  });

  it("gives a hand edit of the file the same treatment at the next read", async () => {
    const c = await opened();
    await c.run();
    c.wait(HOUR);
    await writeFile(
      join(c.vault, ".vitrine/scouts/lab.yaml"),
      FILE.replace(OLD, NEW)
    );

    expect(await c.health()).toEqual({ voice: "not yet", sentence: NOT_READ });
    expect(await c.checkDue()).toEqual(["lab"]);
  });

  it("takes up a page's own runs again when the Scout is pointed back at it", async () => {
    const c = await opened();
    await c.run();
    c.wait(HOUR);
    await c.save({ query: NEW });
    expect((await c.health()).voice).toBe("not yet");

    await c.save({ query: OLD });

    expect((await c.health()).voice).toBe("claim");
  });
});
