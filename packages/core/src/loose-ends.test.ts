import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LooseEnds } from "./loose-ends.js";
import { closeCores, core, vaultWith } from "./test-core.js";

afterEach(closeCores);

const now = new Date("2026-09-21T10:00:00+01:00");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) =>
  new Date(now.getTime() - days * DAY).toISOString();

/** A promoted page, `promoted:` and its two sides filled in by the caller. */
const page = (
  name: string,
  {
    promoted,
    status = "open",
    supporting = "",
    opposing = "",
    id = `rq-${name}`,
  }: {
    promoted?: string;
    status?: string;
    supporting?: string;
    opposing?: string;
    id?: string | null;
  }
) => `---
${id === null ? "" : `id: ${id}\n`}kind: research-question
question: "${name}?"
status: ${status}
promoted_from: "[[${name}]]"
${promoted === undefined ? "" : `promoted: ${promoted}\n`}context: other
---

## Working answer

## Supporting sources
${supporting}
## Opposing sources
${opposing}
## Related questions

## Open threads

## Position history
`;

const SOURCE = `---
kind: source
citekey: rasch2013
---
`;

async function opened(files: Record<string, string>) {
  const vault = await vaultWith(files);
  const c = await core({ now: () => now });
  const reply = await c.mutate("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  return { vault, c };
}

/** The dashboard's rows, or the failure that stopped it. */
async function rows(c: {
  query: <T>(p: string) => Promise<{ result?: { data: T }; error?: unknown }>;
}) {
  const reply = await c.query<LooseEnds>("looseEnds.rows");
  expect(reply.error).toBeUndefined();
  return reply.result!.data;
}

/** Every row's title across every group, for the assertions that only care which rows are drawn. */
const titles = (ends: LooseEnds) =>
  ends.groups.flatMap((g) => g.rows.map((r) => r.title));

describe("looseEnds.rows — the stalled Research Question", () => {
  it("leaves out a Research Question younger than the threshold", async () => {
    const { c } = await opened({
      "q/young (RQ).md": page("young", { promoted: daysAgo(13) }),
    });
    expect(titles(await rows(c))).toEqual([]);
  });

  it("lists one older than the threshold with no source on either side", async () => {
    const { c } = await opened({
      "q/stale (RQ).md": page("stale", { promoted: daysAgo(15) }),
    });
    const ends = await rows(c);
    expect(ends.groups).toHaveLength(1);
    expect(ends.groups[0]?.group).toBe("Stalled questions");
    expect(ends.groups[0]?.rows).toEqual([
      {
        kind: "stalled-research-question",
        subject: "rq-stale",
        path: "q/stale (RQ).md",
        title: "stale?",
        since: daysAgo(15),
      },
    ]);
  });

  it("leaves out one with a source on either side", async () => {
    const { c } = await opened({
      "sources/rasch2013.md": SOURCE,
      "q/fed (RQ).md": page("fed", {
        promoted: daysAgo(30),
        supporting: "\n- [[rasch2013]] — it holds up.\n",
      }),
      "q/opposed (RQ).md": page("opposed", {
        promoted: daysAgo(30),
        opposing: "\n- [[rasch2013]]\n",
      }),
    });
    expect(titles(await rows(c))).toEqual([]);
  });

  it("leaves out one that is answered or abandoned", async () => {
    const { c } = await opened({
      "q/done (RQ).md": page("done", {
        promoted: daysAgo(30),
        status: "answered",
      }),
      "q/gone (RQ).md": page("gone", {
        promoted: daysAgo(30),
        status: "abandoned",
      }),
    });
    expect(titles(await rows(c))).toEqual([]);
  });

  it("leaves out one with no promoted: — there is no date to be stalled since", async () => {
    const { c } = await opened({
      "q/undated (RQ).md": page("undated", {}),
    });
    expect(titles(await rows(c))).toEqual([]);
  });

  it("takes the threshold from the core's options, so a test can shorten it", async () => {
    const vault = await vaultWith({
      "q/stale (RQ).md": page("stale", { promoted: daysAgo(1) }),
    });
    const c = await core({ now: () => now, stalledMs: DAY / 2 });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    expect(titles(await rows(c))).toEqual(["stale?"]);
  });
});

describe("looseEnds.dismiss — mark deliberate", () => {
  const stalled = {
    "q/stale (RQ).md": page("stale", { promoted: daysAgo(15) }),
  };

  it("removes the row and writes dismissals.json keyed by the object and the row kind", async () => {
    const { vault, c } = await opened(stalled);

    const reply = await c.mutate("looseEnds.dismiss", {
      subject: "rq-stale",
      kind: "stalled-research-question",
    });

    expect(reply.error).toBeUndefined();
    expect(titles(await rows(c))).toEqual([]);
    const written: unknown = JSON.parse(
      await readFile(join(vault, ".vitrine/dismissals.json"), "utf8")
    );
    expect(written).toEqual({
      "rq-stale": { "stalled-research-question": now.toISOString() },
    });
  });

  it("keeps the row silenced across a vault reopen", async () => {
    const { vault, c } = await opened(stalled);
    await c.mutate("looseEnds.dismiss", {
      subject: "rq-stale",
      kind: "stalled-research-question",
    });

    const second = await core({ now: () => now });
    await second.mutate("vault.open", { path: vault });
    await second.indexed();

    expect(titles(await rows(second))).toEqual([]);
  });

  it("does not silence a different row kind about the same object", async () => {
    const { vault, c } = await opened(stalled);

    await c.mutate("looseEnds.dismiss", {
      subject: "rq-stale",
      kind: "ambiguous-link",
    });

    expect(titles(await rows(c))).toEqual(["stale?"]);
    expect(
      JSON.parse(
        await readFile(join(vault, ".vitrine/dismissals.json"), "utf8")
      )
    ).toEqual({ "rq-stale": { "ambiguous-link": now.toISOString() } });
  });

  it("adds a second row kind beside the first rather than replacing it", async () => {
    const { vault, c } = await opened(stalled);
    await c.mutate("looseEnds.dismiss", {
      subject: "rq-stale",
      kind: "ambiguous-link",
    });
    await c.mutate("looseEnds.dismiss", {
      subject: "rq-stale",
      kind: "stalled-research-question",
    });

    expect(
      JSON.parse(
        await readFile(join(vault, ".vitrine/dismissals.json"), "utf8")
      )
    ).toEqual({
      "rq-stale": {
        "ambiguous-link": now.toISOString(),
        "stalled-research-question": now.toISOString(),
      },
    });
  });

  it("says so rather than silencing nothing when dismissals.json cannot be read", async () => {
    const { vault, c } = await opened({
      ...stalled,
      ".vitrine/dismissals.json": "{ not json",
    });

    const ends = await rows(c);
    expect(ends.problem).toMatch(/dismissals\.json/);
    expect(titles(ends)).toEqual(["stale?"]);

    // And the write refuses rather than overwriting what it could not read.
    const reply = await c.mutate("looseEnds.dismiss", {
      subject: "rq-stale",
      kind: "stalled-research-question",
    });
    expect(reply.error?.message).toMatch(/dismissals\.json/);
    expect(
      await readFile(join(vault, ".vitrine/dismissals.json"), "utf8")
    ).toBe("{ not json");
  });
});

describe("looseEnds.rows — the dashboard's shape", () => {
  it("draws no group at all when nothing is loose", async () => {
    const { c } = await opened({
      "q/young (RQ).md": page("young", { promoted: daysAgo(1) }),
    });
    expect(await rows(c)).toEqual({ groups: [], problem: null });
  });

  it("keys a page that carries no id by its path", async () => {
    const { c } = await opened({
      "q/anon (RQ).md": page("anon", { promoted: daysAgo(15), id: null }),
    });
    expect((await rows(c)).groups[0]?.rows[0]?.subject).toBe("q/anon (RQ).md");
  });
});
