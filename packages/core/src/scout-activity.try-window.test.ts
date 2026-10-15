import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ScoutActivity } from "./scout-activity.js";
import type { TriedWindow } from "./scout-form.js";
import {
  closeCores,
  core,
  fixtureCopy,
  urlOf,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// *Try over the last run's window* (#522; spec #511 story 52, ADR 0042
// decision 5): an arXiv Scout's edited Query sent over the window of the last
// completed run, its total beside what that run fetched. Driven through the
// router on a stand-in arXiv that answers by Query; nothing is written.

const NOW = new Date("2026-09-30T12:00:00Z");

/** A page of the stand-in's feed: `total` matches, `count` entries from `start`. */
function feed(total: number, start = 0, count = 0): string {
  const entries = Array.from({ length: count }, (_, i) => {
    const id = `2609.${String(start + i).padStart(5, "0")}`;
    return `<entry><id>http://arxiv.org/abs/${id}v1</id><published>2026-09-28T00:00:00Z</published><title>Paper ${id}</title><summary>s</summary><author><name>A B</name></author><link href="http://arxiv.org/abs/${id}v1" rel="alternate" type="text/html"/></entry>`;
  });
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>${total}</opensearch:totalResults>${entries.join("")}</feed>`;
}

const scoutYaml = (name: string, query = "all:sleep") =>
  [
    `name: ${name}`,
    "cadence: daily",
    "lane: review",
    "created: 2026-09-20T00:00:00Z",
    "filter:",
    `  query: ${query}`,
    "",
  ].join("\n");

const WATCHED = [
  "name: Lab page",
  "cadence: daily",
  "lane: review",
  "created: 2026-09-20T00:00:00Z",
  "source:",
  "  kind: watched",
  "  url: https://example.test/papers",
  "",
].join("\n");

async function opened(
  scouts: Record<string, string>,
  answer: (url: URL) => Response
) {
  const vault = await fixtureCopy("obsidian-vault");
  for (const [file, text] of Object.entries(scouts)) {
    const path = join(vault, ".vitrine/scouts", file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  const requests: URL[] = [];
  const c = await core({
    now: () => NOW,
    arxiv: {
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
  const sql = <T>(text: string): T[] => {
    const handle = new DatabaseSync(join(vault, ".vitrine/queue.sqlite"), {
      readOnly: true,
    });
    try {
      return handle.prepare(text).all() as T[];
    } finally {
      handle.close();
    }
  };
  return {
    c,
    vault,
    requests,
    sql,
    run: async (id: string) =>
      expect(
        (await c.mutate("scouts.runNow", { scoutId: id })).error
      ).toBeUndefined(),
    file: (id: string) =>
      readFile(join(vault, ".vitrine/scouts", `${id}.yaml`), "utf8"),
    row: async (id: string) => {
      const r = await c.query<ScoutActivity>("scouts.activity");
      return r.result!.data.rows.find(
        (row) => row.kind === "scout" && row.id === id
      );
    },
    tryIt: async (scoutId: string, query: string) => {
      const r = await c.mutate<TriedWindow>("scouts.tryWindow", {
        scoutId,
        query,
      });
      return r;
    },
  };
}

// The last run asked "all:sleep" and was told 214; the edit asks for less.
const standIn = (url: URL) => {
  const total = (url.searchParams.get("search_query") ?? "").includes(
    "all:sleep AND"
  )
    ? 23
    : 214;
  const start = Number(url.searchParams.get("start") ?? 0);
  const max = Number(url.searchParams.get("max_results") ?? 0);
  return new Response(
    feed(total, start, Math.max(0, Math.min(max, total - start)))
  );
};

describe("scouts.tryWindow", () => {
  it("sends the edited Query over the last run's window and returns its total beside what that run fetched", async () => {
    const f = await opened({ "sleep.yaml": scoutYaml("Sleep") }, standIn);
    await f.run("sleep");
    const [last] = f.sql<{
      window_from: string;
      window_to: string;
      fetched: number;
    }>(
      "SELECT window_from, window_to, fetched FROM scout_runs ORDER BY id DESC"
    );
    f.requests.length = 0;

    const r = await f.tryIt("sleep", "all:sleep AND cat:q-bio");

    expect(r.error).toBeUndefined();
    expect(last!.fetched).toBe(214);
    expect(r.result!.data).toEqual({
      outcome: "found",
      would: 23,
      fetched: 214,
      from: last!.window_from,
      to: last!.window_to,
    });
    expect(f.requests).toHaveLength(1);
    const q = f.requests[0]!.searchParams.get("search_query")!;
    expect(q).toContain("(all:sleep AND cat:q-bio) AND submittedDate:[");
  });

  it("writes nothing: not the Scout, the run table, the queue or a stub", async () => {
    const f = await opened({ "sleep.yaml": scoutYaml("Sleep") }, standIn);
    await f.run("sleep");
    const before = {
      file: await f.file("sleep"),
      runs: f.sql("SELECT * FROM scout_runs"),
      proposals: f.sql("SELECT * FROM proposals"),
      triage: f.sql("SELECT * FROM triage"),
    };

    await f.tryIt("sleep", "all:sleep AND other");

    expect(await f.file("sleep")).toBe(before.file);
    expect(f.sql("SELECT * FROM scout_runs")).toEqual(before.runs);
    expect(f.sql("SELECT * FROM proposals")).toEqual(before.proposals);
    expect(f.sql("SELECT * FROM triage")).toEqual(before.triage);
  });

  it("says why in the fault sentence for its kind, with no comparison, when arXiv fails", async () => {
    let failing = false;
    const f = await opened({ "sleep.yaml": scoutYaml("Sleep") }, (u) =>
      failing ? new Response("", { status: 503 }) : standIn(u)
    );
    await f.run("sleep");
    failing = true;

    const r = await f.tryIt("sleep", "all:sleep AND x");

    expect(r.result!.data).toEqual({
      outcome: "failed",
      sentence:
        "arXiv answered with an error (HTTP 503), so nothing was checked.",
    });
  });

  it("says a rate limit in its own sentence", async () => {
    let limited = false;
    const f = await opened({ "sleep.yaml": scoutYaml("Sleep") }, (u) =>
      limited ? new Response("", { status: 429 }) : standIn(u)
    );
    await f.run("sleep");
    limited = true;

    const r = await f.tryIt("sleep", "all:sleep AND x");

    expect(r.result!.data).toEqual({
      outcome: "failed",
      sentence:
        "arXiv asked Vitrine to slow down (HTTP 429), so nothing was checked.",
    });
  });

  it("is refused for a Scout with no completed run, and the row says it has nothing to try over", async () => {
    const f = await opened({ "sleep.yaml": scoutYaml("Sleep") }, standIn);

    expect(await f.row("sleep")).toMatchObject({ lastWindow: null });
    const r = await f.tryIt("sleep", "all:sleep AND x");

    expect(r.error).toBeDefined();
    expect(f.requests).toHaveLength(0);
  });

  it("is refused for a Watched Scout, whose row offers no window", async () => {
    const f = await opened({ "lab.yaml": WATCHED }, standIn);

    expect(await f.row("lab")).toMatchObject({ lastWindow: null });
    expect((await f.tryIt("lab", "anything")).error).toBeDefined();
    expect(f.requests).toHaveLength(0);
  });

  it("carries the last completed run's window on the arXiv row", async () => {
    const f = await opened({ "sleep.yaml": scoutYaml("Sleep") }, standIn);
    await f.run("sleep");
    const [last] = f.sql<{
      window_from: string;
      window_to: string;
      fetched: number;
    }>(
      "SELECT window_from, window_to, fetched FROM scout_runs ORDER BY id DESC"
    );

    expect(await f.row("sleep")).toMatchObject({
      lastWindow: {
        from: last!.window_from,
        to: last!.window_to,
        fetched: last!.fetched,
      },
    });
  });
});
