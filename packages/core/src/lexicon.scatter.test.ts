import { afterEach, describe, expect, it } from "vitest";
import type { Attention } from "./lexicon.js";
import {
  closeCores,
  core,
  urlOf,
  vaultWith,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// Where the attention scatter's axes cross (#655; ADR 0045 decision 6): the
// median papers and median growth of the *placed* Tags at the page's depth,
// and nothing at all under four of them. Driven through the router on a temp
// vault with a fake OpenAlex, as `lexicon.sync.test.ts` is.

const NOW = new Date("2026-10-16T09:00:00.000Z");

/** `n` papers of one Tag that recur on `marker`, which the fake reads off the query. */
const tagged = (tag: string, marker: string, n: number) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      `s/${marker}${i}.md`,
      `---
kind: source
citekey: ${marker}${i}
title: ${marker}${i} on ${marker} work
tags: [${tag}]
---
> The ${marker} gadget recurs. Distinct${marker}${i}${marker} stands alone.
`,
    ])
  );

/** Prior twelve months hold 10 a month; the last twelve hold the figure given, so growth is figure ÷ 10 − 1. */
function fakeOpenAlex(
  lastByMarker: Record<string, number>,
  priorByMarker: Record<string, number> = {}
) {
  return ((input: string | URL | Request) => {
    const filter = urlOf(input).searchParams.get("filter") ?? "";
    const month = /from_publication_date:(\d{4}-\d{2})/.exec(filter)![1]!;
    const marker = Object.keys(lastByMarker).find((m) => filter.includes(m))!;
    const count =
      month >= "2025-10"
        ? lastByMarker[marker]!
        : (priorByMarker[marker] ?? 10);
    return Promise.resolve(Response.json({ meta: { count }, results: [] }));
  }) as typeof fetch;
}

async function synced(
  files: Record<string, string>,
  lastByMarker: Record<string, number>,
  priorByMarker: Record<string, number> = {}
) {
  const c = await core({
    now: () => NOW,
    openalex: {
      fetch: fakeOpenAlex(lastByMarker, priorByMarker),
      clock: virtualClock(),
    },
  });
  const vault = await vaultWith(files);
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  expect(
    (await c.mutate("lexicon.sync", { confirm: true })).error
  ).toBeUndefined();
  return async (depth?: number) => {
    const reply = await c.query<Attention>(
      "questionMap.attention",
      depth === undefined ? undefined : { depth }
    );
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
}

// Papers 3, 4, 5, 6, 7 and last-year volume 11, 15, 20, 30, 40 (growth 10%,
// 50%, 100%, 200%, 300%): the medians are 5 papers and 100%.
const FIVE = {
  ...tagged("a/one", "mkone", 3),
  ...tagged("a/two", "mktwo", 4),
  ...tagged("b/three", "mkthree", 5),
  ...tagged("b/four", "mkfour", 6),
  ...tagged("b/five", "mkfive", 7),
};
const GROWING = { mkone: 11, mktwo: 15, mkthree: 20, mkfour: 30, mkfive: 40 };

describe("where the scatter's axes cross", () => {
  it("is the median papers and median growth of the placed Tags, and says how many", async () => {
    const attention = await synced(FIVE, GROWING);
    expect((await attention()).crossing).toEqual({
      placed: 5,
      papers: 5,
      growth: 1,
    });
  });

  it("leaves a Tag the field is too thin to measure out of both medians", async () => {
    // Ten papers would drag the median of papers up to 5.5 if it counted.
    const attention = await synced(
      { ...FIVE, ...tagged("c/thin", "mkthin", 10) },
      { ...GROWING, mkthin: 2 },
      // 48 works in the prior twelve months, under the floor of 50.
      { mkthin: 4 }
    );
    const view = await attention();
    expect(view.tags.find((t) => t.tag === "c/thin")!.state).toBe("unplaced");
    expect(view.crossing).toEqual({ placed: 5, papers: 5, growth: 1 });
  });

  it("is not drawn under four placed Tags — a median of two is not a split", async () => {
    const attention = await synced(
      {
        ...tagged("a/one", "mkone", 3),
        ...tagged("a/two", "mktwo", 4),
        ...tagged("b/three", "mkthree", 5),
      },
      GROWING
    );
    const view = await attention();
    expect(view.tags.filter((t) => t.state === "measured")).toHaveLength(3);
    expect(view.crossing).toBeNull();
  });

  it("draws from four, averaging the middle two of an even count", async () => {
    const attention = await synced(
      {
        ...tagged("a/one", "mkone", 3),
        ...tagged("a/two", "mktwo", 4),
        ...tagged("b/three", "mkthree", 5),
        ...tagged("b/four", "mkfour", 6),
      },
      GROWING
    );
    expect((await attention()).crossing).toEqual({
      placed: 4,
      papers: 4.5,
      growth: 0.75,
    });
  });

  it("obeys the page's depth: a parent stands for its children, never beside them", async () => {
    const attention = await synced(FIVE, GROWING);
    const deep = await attention();
    expect(deep.tags.map((t) => t.tag)).toContain("a/one");
    const shallow = await attention(1);
    expect(shallow.tags.map((t) => t.tag).sort()).toEqual(["a", "b"]);
    // The parents were never measured, so nothing is placed to cross on.
    expect(shallow.crossing).toBeNull();
  });
});
