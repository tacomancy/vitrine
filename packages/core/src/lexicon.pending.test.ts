import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { vi, afterEach, describe, expect, it } from "vitest";
import type { Attention, LexiconView, SyncResult } from "./lexicon.js";
import {
  closeCores,
  core,
  urlOf,
  vaultWith,
  virtualClock,
} from "./test-core.js";

afterEach(closeCores);

// Re-measure pending and the automatic sync (#656; ADR 0045 decisions 2, 4
// and 10), driven through the router on a temp vault with a fake OpenAlex
// `fetch`, a virtual clock for the request gaps and an injected `now`.

const DAY = 86_400_000;
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

/** An OpenAlex answering every month with the same count; `urls` is what was asked. */
function fakeOpenAlex(count = 20) {
  const urls: URL[] = [];
  const fetcher = ((input: string | URL | Request) => {
    urls.push(urlOf(input));
    return Promise.resolve(Response.json({ meta: { count }, results: [] }));
  }) as typeof fetch;
  return { fetch: fetcher, urls };
}
type Fake = ReturnType<typeof fakeOpenAlex>;

const search = (url: URL) => url.searchParams.get("filter") ?? "";

/** Open a vault at `at` in a fresh core, as the app is launched. */
async function launch(vault: string, fake: Fake, at: Date) {
  const c = await core({
    now: () => at,
    openalex: { fetch: fake.fetch, clock: virtualClock() },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const attention = async (depth?: number) => {
    const reply = await c.query<Attention>(
      "questionMap.attention",
      depth === undefined ? undefined : { depth }
    );
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  return { c, attention };
}

const tagOf = (view: Attention, tag: string) =>
  view.tags.find((t) => t.tag === tag)!;

/** A vault that has synced once, at NOW, then been closed. */
async function syncedVault(files: Record<string, string>) {
  const vault = await vaultWith(files);
  const fake = fakeOpenAlex();
  const first = await launch(vault, fake, NOW);
  expect(
    (await first.c.mutate<SyncResult>("lexicon.sync", { confirm: true })).error
  ).toBeUndefined();
  await first.c.close();
  return { vault, requested: fake.urls.length };
}

describe("re-measure pending", () => {
  it("keeps the old point, marked pending, once a Seed changes the compiled query, and clears it on the next sync", async () => {
    const vault = await vaultWith(PROBING);
    const fake = fakeOpenAlex();
    const { c, attention } = await launch(vault, fake, NOW);
    await c.mutate("lexicon.sync", { confirm: true });
    const before = tagOf(await attention(), "ml/probing");
    expect(before.pending).toBe(false);

    await c.mutate("lexicon.seed", { tag: "ml/probing", term: "grokking" });
    const after = tagOf(await attention(), "ml/probing");
    expect(after.pending).toBe(true);
    // The point is the one that was measured, not a gap and not a re-derivation.
    expect(after.state).toBe("measured");
    expect(after.growth).toBe(before.growth);
    expect(after.measuredAt).toBe(before.measuredAt);

    await c.mutate("lexicon.sync", {});
    expect(tagOf(await attention(), "ml/probing").pending).toBe(false);
  });

  it("is also set by an Exclusion", async () => {
    const vault = await vaultWith(PROBING);
    const { c, attention } = await launch(vault, fakeOpenAlex(), NOW);
    await c.mutate("lexicon.sync", { confirm: true });
    await c.mutate("lexicon.exclude", {
      tag: "ml/probing",
      term: "linear probe",
    });
    expect(tagOf(await attention(), "ml/probing").pending).toBe(true);
  });

  it("is not set on a Tag that was never measured, or on one measured under the query it has now", async () => {
    const vault = await vaultWith({ ...PROBING, ...SLEEP });
    const { c, attention } = await launch(vault, fakeOpenAlex(), NOW);
    expect(tagOf(await attention(), "ml/probing").pending).toBe(false);
    await c.mutate("lexicon.sync", { confirm: true });
    const view = await attention();
    expect(view.tags.map((t) => t.pending)).toEqual([false, false]);
  });

  it("is not set on a measured Tag left with no Terms, which no sync could clear", async () => {
    const vault = await vaultWith(PROBING);
    const { c, attention } = await launch(vault, fakeOpenAlex(), NOW);
    await c.mutate("lexicon.sync", { confirm: true });
    const view = await c.query<LexiconView>("lexicon.get", {
      tag: "ml/probing",
    });
    for (const { term } of view.result!.data.terms) {
      await c.mutate("lexicon.exclude", { tag: "ml/probing", term });
    }
    const after = tagOf(await attention(), "ml/probing");
    expect(after.query).toBeNull();
    expect(after.pending).toBe(false);
    expect((await attention()).due).toBe(0);
  });

  it("counts the pending Tag as due, so a failed re-measure is never a quiet field", async () => {
    const vault = await vaultWith(PROBING);
    const { c, attention } = await launch(vault, fakeOpenAlex(), NOW);
    await c.mutate("lexicon.sync", { confirm: true });
    expect((await attention()).due).toBe(0);
    await c.mutate("lexicon.seed", { tag: "ml/probing", term: "grokking" });
    expect((await attention()).due).toBe(1);
  });
});

describe("sync when the vault opens", () => {
  it("makes no request in a vault that never pressed Sync now", async () => {
    const vault = await vaultWith({ ...PROBING, ...SLEEP });
    const fake = fakeOpenAlex();
    const { attention } = await launch(vault, fake, NOW);
    await attention();
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.urls).toEqual([]);
  });

  it("makes no request on opening a synced vault whose Tags are all fresh", async () => {
    const { vault } = await syncedVault(PROBING);
    const fake = fakeOpenAlex();
    const { attention } = await launch(vault, fake, new Date(+NOW + 6 * DAY));
    await attention();
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.urls).toEqual([]);
  });

  it("re-measures every Tag older than seven days", async () => {
    const { vault, requested } = await syncedVault({ ...PROBING, ...SLEEP });
    const fake = fakeOpenAlex();
    const later = new Date(+NOW + 7 * DAY + 1000);
    const { attention } = await launch(vault, fake, later);
    await vi.waitFor(() => expect(fake.urls).toHaveLength(requested));
    await vi.waitFor(async () =>
      expect((await attention()).asOf).toBe(later.toISOString())
    );
  });

  it("does not ask again for a Tag measured exactly seven days ago", async () => {
    const { vault } = await syncedVault(PROBING);
    const fake = fakeOpenAlex();
    await launch(vault, fake, new Date(+NOW + 7 * DAY));
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.urls).toEqual([]);
  });

  it("measures only the Tags that were never measured or whose query changed", async () => {
    const { vault } = await syncedVault(PROBING);
    // A new Tag arrives, and an existing one is Seeded, while the app is closed.
    const probing = await core({
      now: () => NOW,
      openalex: { fetch: fakeOpenAlex().fetch, clock: virtualClock() },
    });
    await probing.mutate("vault.open", { path: vault });
    await probing.indexed();
    await probing.mutate("lexicon.seed", {
      tag: "ml/probing",
      term: "grokking",
    });
    await probing.close();
    await vaultWithMore(vault, SLEEP);

    const fake = fakeOpenAlex();
    await launch(vault, fake, NOW);
    await vi.waitFor(() => expect(fake.urls).toHaveLength(48));
    const queries = new Set(
      fake.urls.map((u) => /search:\((.*?)\),from/.exec(search(u))?.[1])
    );
    expect(queries.size).toBe(2);
  });
});

describe("viewed depths", () => {
  it("queues a depth once it has been viewed, once, and keeps it", async () => {
    const vault = await vaultWith(PROBING);
    const fake = fakeOpenAlex();
    const first = await launch(vault, fake, NOW);
    // Never synced: viewing a depth records it and sends nothing.
    await first.attention(1);
    expect(fake.urls).toEqual([]);
    await first.c.mutate("lexicon.sync", { confirm: true });
    // "ml/probing" at the default depth and "ml" at the one viewed.
    expect(fake.urls).toHaveLength(48);
    await first.c.mutate("lexicon.sync", {});
    expect(fake.urls).toHaveLength(48);
    await first.c.close();

    // Remembered across a restart: a week on, both are due again, nothing is viewed.
    const later = fakeOpenAlex();
    await launch(vault, later, new Date(+NOW + 8 * DAY));
    await vi.waitFor(() => expect(later.urls).toHaveLength(48));
  });

  it("does not measure a depth nobody has viewed", async () => {
    const vault = await vaultWith(PROBING);
    const fake = fakeOpenAlex();
    const { c, attention } = await launch(vault, fake, NOW);
    await attention();
    await c.mutate("lexicon.sync", { confirm: true });
    expect(fake.urls).toHaveLength(24);
  });
});

async function vaultWithMore(vault: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(vault, path)), { recursive: true });
    await writeFile(join(vault, path), text);
  }
}
