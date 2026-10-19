import { afterEach, describe, expect, it } from "vitest";
import type { Attention, SyncResult } from "./lexicon.js";
import {
  closeCores,
  core,
  urlOf,
  vaultWith,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// Beat 10's standing question (spec #636, "Loose Ends and Home"): an unplaced,
// pending or unsynced Tag is analytical, not a defect, so Loose Ends gains no
// row for it (brief § Loose Ends). Driven through the router on a temp vault
// with a fake OpenAlex, the way the panel and the page read.

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

const placed = (tag: string, phrase: string, ids: string[]) =>
  Object.fromEntries(
    ids.map((id) => [
      `s/${tag}-${id}.md`,
      paper(`${tag}-${id}`, [tag], `The ${phrase} recurs. Note ${id}.`),
    ])
  );

const FILES = {
  ...placed("replay", "hippocampal replay", ["a", "b", "c"]),
  ...placed("spindles", "sleep spindle", ["a", "b", "c"]),
  // Two papers: unplaced for too few, whatever any sync says.
  ...placed("dreams", "dream report", ["a", "b"]),
};

/** An OpenAlex that fails the Tag whose Terms hold `failing`, and answers the rest. */
function openAlex(failing: { term: string | null }) {
  const requests: URL[] = [];
  const fetcher = ((input: string | URL | Request) => {
    const url = urlOf(input);
    requests.push(url);
    const filter = url.searchParams.get("filter") ?? "";
    if (failing.term !== null && filter.includes(failing.term)) {
      return Promise.resolve(new Response("down", { status: 500 }));
    }
    return Promise.resolve(Response.json({ meta: { count: 60 }, results: [] }));
  }) as typeof fetch;
  return { fetch: fetcher, requests };
}

async function opened() {
  const vault = await vaultWith(FILES);
  const failing = { term: null as string | null };
  const fake = openAlex(failing);
  const c = await core({
    now: () => NOW,
    openalex: { fetch: fake.fetch, clock: virtualClock() },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const rows = async () => {
    const reply = await c.query("looseEnds.rows");
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  const attention = async () =>
    (await c.query<Attention>("questionMap.attention")).result!.data;
  return { c, failing, rows, attention };
}

describe("Loose Ends and the attention scatter", () => {
  it("gains no row for an unsynced, unplaced, pending or failed Tag", async () => {
    const { c, failing, rows, attention } = await opened();
    const quiet = JSON.stringify(await rows());

    // Unsynced and unplaced ("dreams" has two papers).
    const before = await attention();
    expect(before.tags.find((t) => t.tag === "dreams")?.state).toBe("unplaced");
    expect(JSON.stringify(await rows())).toBe(quiet);

    // Measured, then one Tag re-queried (pending) and failing to re-measure.
    expect(
      (await c.mutate<SyncResult>("lexicon.sync", { confirm: true })).error
    ).toBeUndefined();
    await c.mutate("lexicon.seed", { tag: "replay", term: "sharp wave" });
    failing.term = "sharp wave";
    const failed = await c.mutate<SyncResult>("lexicon.sync", {});
    expect(failed.result!.data.failed).toEqual([
      { tag: "replay", kind: "http" },
    ]);
    const after = await attention();
    const replay = after.tags.find((t) => t.tag === "replay")!;
    expect(replay.pending).toBe(true);
    expect(replay.failure).toBe("http");

    expect(JSON.stringify(await rows())).toBe(quiet);
  });
});
