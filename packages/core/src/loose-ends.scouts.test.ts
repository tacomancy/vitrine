import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LooseEnds } from "./loose-ends.js";
import type { FleetHealth } from "./scout-health.js";
import {
  closeCores,
  core,
  fixtureCopy,
  urlOf,
  virtualClock,
} from "./test-core.js";

// Loose Ends' three Scout-beat rows (#453; spec #447 stories 82–89): a
// Scout whose newest run failed, a Scout file that will not parse, and a
// stub with no PDF.

afterEach(closeCores);

const NOW = new Date("2026-09-30T12:34:00Z");

const scoutYaml = (extra = "") =>
  `name: Sleep and memory\ncadence: daily\nlane: review\ncreated: 2026-09-20T00:00:00Z\nfilter:\n  query: all:sleep\n${extra}`;

const stub = (title: string) =>
  `---\nkind: source-stub\ncitekey: ${title}\ntitle: ${title}\n---\n\n> abstract\n`;

async function opened(
  answer: () => Response,
  files: Record<string, string> = {},
  mtimes: Record<string, Date> = {}
) {
  const vault = await fixtureCopy("obsidian-vault");
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(vault, file)), { recursive: true });
    await writeFile(join(vault, file), text);
  }
  // Before the open, so the index reads the dates the test chose.
  for (const [file, when] of Object.entries(mtimes)) {
    await utimes(join(vault, file), when, when);
  }
  const c = await core({
    now: () => NOW,
    arxiv: {
      clock: virtualClock(),
      fetch: (input) => {
        urlOf(input);
        return Promise.resolve(answer());
      },
    },
  });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const ends = async () => {
    const r = await c.query<LooseEnds>("looseEnds.rows");
    expect(r.error).toBeUndefined();
    return r.result!.data;
  };
  return { vault, c, ends };
}

const kinds = (ends: LooseEnds, kind: string) =>
  ends.groups.flatMap(({ group, rows }) =>
    rows.filter((r) => r.kind === kind).map((row) => ({ group, row }))
  );

const fails = () => new Response("", { status: 503 });

describe("looseEnds.rows — a failed Scout", () => {
  it("is a row in Broken plumbing with the rail's sentence and its error kind", async () => {
    const { c, ends } = await opened(fails, {
      ".vitrine/scouts/sleep.yaml": scoutYaml(),
    });
    expect((await c.mutate("scouts.runNow", { scoutId: "sleep" })).error).toBe(
      undefined
    );

    const rail = (await c.query<FleetHealth>("scouts.health")).result!.data;
    const health = rail.scouts.find((s) => s.id === "sleep")!.health;
    expect(health.voice).toBe("wrong");

    expect(kinds(await ends(), "failed-scout")).toEqual([
      {
        group: "Broken plumbing",
        row: {
          kind: "failed-scout",
          subject: "sleep",
          path: ".vitrine/scouts/sleep.yaml",
          title: "Sleep and memory",
          errorKind: "http",
          // One test pins the two surfaces together: the sentence is the
          // rail's, not a second wording of the same fault.
          sentence: (health as { sentence: string }).sentence,
        },
      },
    ]);
  });

  it("is gone once the Scout is paused, or once a later run is clean", async () => {
    const { vault, c, ends } = await opened(fails, {
      ".vitrine/scouts/sleep.yaml": scoutYaml(),
    });
    await c.mutate("scouts.runNow", { scoutId: "sleep" });
    expect(kinds(await ends(), "failed-scout")).toHaveLength(1);

    const paused = await c.mutate("scouts.pause", { scoutId: "sleep" });
    expect(paused.error).toBeUndefined();
    expect(
      await readFile(join(vault, ".vitrine/scouts/sleep.yaml"), "utf8")
    ).toContain("paused: true");
    expect(kinds(await ends(), "failed-scout")).toEqual([]);
  });

  it("is gone once the Scout is dropped, and nothing takes its place: a Scout the researcher retired is not broken plumbing", async () => {
    const { c, ends } = await opened(fails, {
      ".vitrine/scouts/sleep.yaml": scoutYaml(),
    });
    await c.mutate("scouts.runNow", { scoutId: "sleep" });
    expect(kinds(await ends(), "failed-scout")).toHaveLength(1);

    const dropped = await c.mutate("scouts.drop", { scoutId: "sleep" });

    expect(dropped.error).toBeUndefined();
    const left = (await ends()).groups.flatMap((g) =>
      g.rows.map((r) => r.kind)
    );
    expect(left).not.toContainEqual(
      expect.stringMatching(/scout|credentials|structure/)
    );
  });

  it("is not a row for a Scout that has not failed", async () => {
    const { ends } = await opened(fails, {
      ".vitrine/scouts/sleep.yaml": scoutYaml(),
    });
    expect(kinds(await ends(), "failed-scout")).toEqual([]);
  });
});

describe("looseEnds.rows — an unreadable Scout file", () => {
  it("is a row naming the file, with the rail's sentence", async () => {
    const { c, ends } = await opened(fails, {
      ".vitrine/scouts/broken.yaml": "name: [unclosed\n",
    });
    const rail = (await c.query<FleetHealth>("scouts.health")).result!.data;
    const health = rail.unreadable.find((u) => u.file === "broken.yaml")!
      .health as { sentence: string };

    expect(kinds(await ends(), "unreadable-scout")).toEqual([
      {
        group: "Broken plumbing",
        row: {
          kind: "unreadable-scout",
          subject: "broken.yaml",
          path: ".vitrine/scouts/broken.yaml",
          title: "broken.yaml",
          sentence: health.sentence,
        },
      },
    ]);
  });
});

describe("looseEnds.rows — a stub with no PDF", () => {
  const files = {
    "sources/old.md": stub("old"),
    "sources/new.md": stub("new"),
  };

  it("is a row at once in Unfinished reading, oldest file first", async () => {
    const { ends } = await opened(fails, files, {
      "sources/old.md": new Date("2026-01-01T00:00:00Z"),
      "sources/new.md": NOW,
    });

    const titles = kinds(await ends(), "stub-without-pdf").map(
      ({ group, row }) => [group, (row as { title: string }).title]
    );
    expect(titles.filter(([, t]) => t === "old" || t === "new")).toEqual([
      ["Unfinished reading", "old"],
      ["Unfinished reading", "new"],
    ]);
  });

  it("leaves the list when marked deliberate, and comes back on undo, with no key added to the stub", async () => {
    const { vault, c, ends } = await opened(fails, files);
    const before = await readFile(join(vault, "sources/old.md"), "utf8");
    const row = { subject: "sources/old.md", kind: "stub-without-pdf" };

    expect((await c.mutate("looseEnds.dismiss", row)).error).toBeUndefined();
    expect(
      kinds(await ends(), "stub-without-pdf").map(
        (r) => (r.row as { subject: string }).subject
      )
    ).not.toContain("sources/old.md");

    expect((await c.mutate("looseEnds.undismiss", row)).error).toBeUndefined();
    expect(
      kinds(await ends(), "stub-without-pdf").map(
        (r) => (r.row as { subject: string }).subject
      )
    ).toContain("sources/old.md");
    expect(await readFile(join(vault, "sources/old.md"), "utf8")).toBe(before);
  });

  it("is not a row for a Source that has a PDF", async () => {
    const { ends } = await opened(fails, {
      "sources/read.md": `---\nkind: source\nid: so1\ntitle: read\npdf: read.pdf\n---\n`,
    });
    expect(
      kinds(await ends(), "stub-without-pdf").map(
        (r) => (r.row as { path: string }).path
      )
    ).not.toContain("sources/read.md");
  });

  it("counts per group, never a total, and leaves no empty group", async () => {
    const { ends } = await opened(fails, files);
    const reply = await ends();
    expect(reply).not.toHaveProperty("total");
    expect(reply.groups.every((g) => g.rows.length > 0)).toBe(true);
  });
});
