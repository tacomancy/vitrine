import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Attention, LexiconView, SyncResult } from "./lexicon.js";
import {
  closeCores,
  core,
  urlOf,
  vaultWith,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// The first *Sync now* (#653; ADR 0045 decisions 1, 4, 5 and 10), driven
// through the router on a temp vault with a fake OpenAlex `fetch` and the
// virtual clock, so nothing here reaches the real API.

const NOW = new Date("2026-10-16T09:00:00.000Z");

const paper = (name: string, tags: string[], abstract: string) => `---
kind: source
citekey: ${name}
title: ${name} on ${abstract.split(".")[0]}
tags: [${tags.join(", ")}]
---
${abstract
  .split(". ")
  .map((s) => `> ${s}`)
  .join("\n")}
`;

// One placeable Tag: three papers that recur on two phrases.
const PROBING = {
  "s/z.md": paper("z", [], "Rats sleep deeply."),
  "s/a.md": paper(
    "a",
    ["ml/probing"],
    "The residual stream carries features. A linear probe reads alpha."
  ),
  "s/b.md": paper(
    "b",
    ["ml/probing"],
    "The residual stream is sparse. A linear probe reads beta."
  ),
  "s/c.md": paper(
    "c",
    ["ml/probing"],
    "The residual stream grows. A linear probe reads gamma."
  ),
};

// A second, smaller-than-the-first placeable Tag.
const SLEEP = {
  "s/d.md": paper(
    "d",
    ["bio/sleep"],
    "Slow waves consolidate memory. Spindle density rises."
  ),
  "s/e.md": paper(
    "e",
    ["bio/sleep"],
    "Slow waves shift at night. Spindle density falls."
  ),
  "s/f.md": paper(
    "f",
    ["bio/sleep"],
    "Slow waves return. Spindle density holds."
  ),
};

type Fake = {
  fetch: typeof fetch;
  urls: URL[];
  /** The publication months asked for, in order. */
  months: () => string[];
};

/** An OpenAlex that answers each month's count from `countFor`, or the Response a test wants. */
function fakeOpenAlex(
  answer: (month: string, url: URL) => number | Response
): Fake {
  const urls: URL[] = [];
  const fetcher = ((input: string | URL | Request) => {
    const url = urlOf(input);
    urls.push(url);
    const month = monthOf(url);
    const reply = answer(month, url);
    return Promise.resolve(
      reply instanceof Response
        ? reply
        : Response.json({ meta: { count: reply }, results: [] })
    );
  }) as typeof fetch;
  return { fetch: fetcher, urls, months: () => urls.map(monthOf) };
}

const monthOf = (url: URL) =>
  /from_publication_date:(\d{4}-\d{2})-01/.exec(
    url.searchParams.get("filter") ?? ""
  )?.[1] ?? "";

/** Twice the field's volume this year as last: 20 a month lately, 10 before that. */
const DOUBLING = (month: string) => (month >= "2025-10" ? 20 : 10);

async function opened(
  files: Record<string, string>,
  fake: Fake,
  more: { vault?: string; now?: () => Date } = {}
) {
  const vault = more.vault ?? (await vaultWith(files));
  const c = await core({
    now: more.now ?? (() => NOW),
    openalex: { fetch: fake.fetch, clock: virtualClock() },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const attention = async () => {
    const reply = await c.query<Attention>("questionMap.attention");
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  const sync = async (input: { confirm?: boolean } = { confirm: true }) =>
    c.mutate<SyncResult>("lexicon.sync", input);
  const get = async (tag: string) => {
    const reply = await c.query<LexiconView>("lexicon.get", { tag });
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  return { c, vault, attention, sync, get };
}

const tagOf = (view: Attention, tag: string) =>
  view.tags.find((t) => t.tag === tag)!;

describe("the first Sync now — consent", () => {
  it("makes no request on open, on reading the panel or a Lexicon, in a vault that never pressed Sync now", async () => {
    const fake = fakeOpenAlex(() => 1);
    const { attention, get } = await opened(PROBING, fake);
    const view = await attention();
    await get("ml/probing");
    expect(fake.urls).toEqual([]);
    expect(view.synced).toBe(false);
    expect(view.asOf).toBeNull();
    expect(tagOf(view, "ml/probing").state).toBe("not yet measured");
  });

  it("refuses a Sync now that was not confirmed, and makes no request", async () => {
    const fake = fakeOpenAlex(() => 1);
    const { sync, attention } = await opened(PROBING, fake);
    const reply = await sync({});
    expect(reply.error).toBeDefined();
    expect(fake.urls).toEqual([]);
    expect((await attention()).synced).toBe(false);
  });

  it("is consent once given: a later Sync now needs no confirm", async () => {
    const fake = fakeOpenAlex(DOUBLING);
    const { sync, attention } = await opened(PROBING, fake);
    expect((await sync({ confirm: true })).error).toBeUndefined();
    expect((await attention()).synced).toBe(true);
    expect((await sync({})).error).toBeUndefined();
  });
});

describe("a Measurement", () => {
  it("asks one count for each of the last 24 complete months and never the current one", async () => {
    const fake = fakeOpenAlex(DOUBLING);
    const { sync } = await opened(PROBING, fake);
    expect((await sync()).error).toBeUndefined();
    const months = fake.months();
    expect(months).toHaveLength(24);
    expect(months[0]).toBe("2024-10");
    expect(months[23]).toBe("2026-09");
    expect(months).not.toContain("2026-10");
  });

  it("sends the Terms and nothing else of the vault", async () => {
    const fake = fakeOpenAlex(DOUBLING);
    const { sync } = await opened(PROBING, fake);
    await sync();
    const filter = fake.urls[0]!.searchParams.get("filter")!;
    expect(filter).toMatch(
      /^title_and_abstract\.search:\(.*"linear probe".*\),from_publication_date:2024-10-01,to_publication_date:2024-10-31$/
    );
    expect(fake.urls[0]!.href).not.toMatch(/alpha|rats|ml%2Fprobing/);
  });

  it("sends the Seeds and leaves out the Exclusions, so the query sent is the one the editor shows (#652)", async () => {
    const fake = fakeOpenAlex(DOUBLING);
    const { c, sync } = await opened(PROBING, fake);
    await c.mutate("lexicon.seed", { tag: "ml/probing", term: "grokking" });
    await c.mutate("lexicon.exclude", {
      tag: "ml/probing",
      term: "linear probe",
    });
    await sync();
    const filter = fake.urls[0]!.searchParams.get("filter")!;
    expect(filter).toContain('"grokking"');
    expect(filter).not.toContain('"linear probe"');
  });

  it("stores the query and the 24 monthly counts, and survives an Index rebuild", async () => {
    const fake = fakeOpenAlex(DOUBLING);
    const first = await opened(PROBING, fake);
    await first.sync();
    const stored = JSON.parse(
      await readFile(join(first.vault, ".vitrine", "measurements.json"), "utf8")
    ) as {
      measurements: Array<{
        tag: string;
        query: string;
        months: Array<{ month: string; count: number }>;
        measuredAt: string;
      }>;
    };
    const row = stored.measurements.find((m) => m.tag === "ml/probing")!;
    expect(row.query).toMatch(/^filter=title_and_abstract\.search:\(/);
    expect(row.months).toHaveLength(24);
    expect(row.months[0]).toEqual({ month: "2024-10", count: 10 });
    expect(row.months[23]).toEqual({ month: "2026-09", count: 20 });
    expect(row.measuredAt).toBe(NOW.toISOString());

    for (const name of [
      "index.sqlite",
      "index.sqlite-wal",
      "index.sqlite-shm",
    ]) {
      await rm(join(first.vault, ".vitrine", name), { force: true });
    }
    await first.c.close();
    const requested = fake.urls.length;
    const again = await opened({}, fake, { vault: first.vault });
    const view = await again.attention();
    expect(tagOf(view, "ml/probing").growth).toBe(1);
    expect(fake.urls).toHaveLength(requested);
  });

  it("does not ask again for a Tag measured within the week under the same query", async () => {
    const fake = fakeOpenAlex(DOUBLING);
    const { sync } = await opened(PROBING, fake);
    await sync();
    await sync();
    expect(fake.urls).toHaveLength(24);
  });
});

describe("growth, derived on read", () => {
  it("is the last 12 months less the 12 before, over the 12 before", async () => {
    const fake = fakeOpenAlex((month) => (month >= "2025-10" ? 15 : 10));
    const { sync, attention } = await opened(PROBING, fake);
    await sync();
    const probing = tagOf(await attention(), "ml/probing");
    // 180 now against 120 before.
    expect(probing.state).toBe("measured");
    expect(probing.growth).toBeCloseTo(0.5);
    expect(probing.counts).toEqual({ last12: 180, prior12: 120 });
  });

  it("places a Tag whose prior twelve months hold exactly 50 works", async () => {
    // 50 over 12 months: 4 in ten of them, 5 in the last two.
    const fake = fakeOpenAlex((month) =>
      month >= "2025-10" ? 10 : month >= "2025-08" ? 5 : 4
    );
    const { sync, attention } = await opened(PROBING, fake);
    await sync();
    const probing = tagOf(await attention(), "ml/probing");
    expect(probing.counts!.prior12).toBe(50);
    expect(probing.state).toBe("measured");
  });

  it("leaves a Tag unplaced, saying the field is too thin, when the prior twelve months hold 49", async () => {
    // 4 × 12 = 48, plus one in a single month: 49.
    const fake = fakeOpenAlex((month) =>
      month >= "2025-10" ? 10 : month === "2025-09" ? 5 : 4
    );
    const { sync, attention, get } = await opened(PROBING, fake);
    await sync();
    const probing = tagOf(await attention(), "ml/probing");
    expect(probing.counts!.prior12).toBe(49);
    expect(probing.state).toBe("unplaced");
    expect(probing.reason).toBe("few-in-field");
    expect(probing.growth).toBeNull();
    // The editor shows the counts it was judged on.
    const view = await get("ml/probing");
    expect(view.reason).toBe("few-in-field");
    expect(view.counts).toEqual({ last12: 120, prior12: 49 });
  });
});

describe("the as-of line", () => {
  it("is the oldest measurement among the Tags shown, and an unmeasured Tag has no date", async () => {
    const fake = fakeOpenAlex(() => 1);
    const vault = await vaultWith({
      ...PROBING,
      ...SLEEP,
      "s/g.md": paper(
        "g",
        ["chem/ions"],
        "Ion channels gate. Ion channels open."
      ),
      "s/h.md": paper(
        "h",
        ["chem/ions"],
        "Ion channels close. Ion channels leak."
      ),
      "s/i.md": paper(
        "i",
        ["chem/ions"],
        "Ion channels adapt. Ion channels sing."
      ),
    });
    // App state written by an earlier sync, two Tags measured on different days.
    const months = Array.from({ length: 24 }, (_, i) => ({
      month: `m${i}`,
      count: 10,
    }));
    await mkdir(join(vault, ".vitrine"), { recursive: true });
    await writeFile(
      join(vault, ".vitrine", "measurements.json"),
      JSON.stringify({
        consentedAt: "2026-10-01T00:00:00.000Z",
        measurements: [
          {
            tag: "ml/probing",
            query: "q",
            months,
            measuredAt: "2026-10-12T08:00:00.000Z",
          },
          {
            tag: "bio/sleep",
            query: "q",
            months,
            measuredAt: "2026-10-09T08:00:00.000Z",
          },
        ],
      })
    );
    const { attention } = await opened({}, fake, { vault });
    const view = await attention();
    expect(view.asOf).toBe("2026-10-09T08:00:00.000Z");
    expect(tagOf(view, "chem/ions").state).toBe("not yet measured");
    expect(tagOf(view, "chem/ions").measuredAt).toBeNull();
    expect(tagOf(view, "bio/sleep").measuredAt).toBe(
      "2026-10-09T08:00:00.000Z"
    );
  });
});

describe("a sync that cannot finish", () => {
  it("keeps the other Tags going when one fails, and names the one that failed", async () => {
    let first = true;
    const fake = fakeOpenAlex((month) => {
      if (first) {
        first = false;
        return new Response("down", { status: 500 });
      }
      return DOUBLING(month);
    });
    const { sync, attention } = await opened({ ...PROBING, ...SLEEP }, fake);
    const result = (await sync()).result!.data;
    expect(result.failed).toEqual([
      { tag: expect.any(String) as string, kind: "http" },
    ]);
    expect(result.measured).toBe(1);
    const view = await attention();
    expect(view.tags.filter((t) => t.state === "measured")).toHaveLength(1);
  });

  it("stops at the first rate limit and says how many Tags are waiting", async () => {
    const fake = fakeOpenAlex(() => new Response("slow down", { status: 429 }));
    const { sync } = await opened({ ...PROBING, ...SLEEP }, fake);
    const result = (await sync()).result!.data;
    expect(fake.urls).toHaveLength(1);
    expect(result.measured).toBe(0);
    expect(result.failed.map((f) => f.kind)).toEqual(["rate_limited"]);
    expect(result.waiting).toBe(2);
  });
});
