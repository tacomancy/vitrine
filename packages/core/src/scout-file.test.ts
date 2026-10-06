import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LooseEnds } from "./loose-ends.js";
import type { Scout, UnreadableScout } from "./scout-file.js";
import type { FleetHealth } from "./scout-health.js";
import { closeCores, core, tmp } from "./test-core.js";

// A Scouts folder the app cannot list is not a vault with no Scouts. Only the
// folder's absence is empty (CLAUDE.md § Invariants, no silent failures; ADR
// 0032: a failed read is the *wrong* Voice and never passes for a quiet
// field), and every surface that reads the Scouts says so instead of
// answering an empty list.

afterEach(closeCores);

const NOW = new Date("2026-09-30T12:34:00Z");
const FOLDER = ".vitrine/scouts";

// What a surface prints, verbatim, in its footer: vault-relative, and Node's
// own `, scandir '<path>'` cut off (ADR 0028).
const NOT_A_FOLDER = "Couldn't read .vitrine/scouts/: ENOTDIR: not a directory";
const DENIED = "Couldn't read .vitrine/scouts/: EACCES: permission denied";

const scoutYaml = `name: Sleep and memory\ncadence: daily\nlane: review\ncreated: 2026-09-20T00:00:00Z\nfilter:\n  query: all:sleep\n`;

/**
 * A vault named as the real one is, apostrophe and all (`Wan Shi Tong's
 * Library`): a reason that kept its path only when the path has no quote in
 * it would pass every other fixture and fail on this one (ADR 0028).
 */
async function opened(files: Record<string, string> = {}) {
  const vault = join(await tmp("scout-file"), "Wan Shi Tong's Library");
  await mkdir(vault);
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(vault, file)), { recursive: true });
    await writeFile(join(vault, file), text);
  }
  const c = await core({ now: () => NOW });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  return { vault, c };
}

type Call = { call: string; how: "query" | "mutate"; input?: unknown };

/** Every procedure that needs to know what the Scouts are, and what it answers when there are none. */
const READS: Array<Call & { empty: unknown }> = [
  { call: "scouts.list", how: "query", empty: { scouts: [], unreadable: [] } },
  {
    call: "scouts.health",
    how: "query",
    empty: { scouts: [], unreadable: [] },
  },
  {
    call: "scouts.fleet",
    how: "query",
    empty: { claim: null, naming: [] },
  },
  { call: "scouts.groups", how: "query", empty: [] },
  { call: "scouts.queue", how: "query", empty: [] },
  { call: "scouts.skim", how: "query", empty: { recent: [], older: [] } },
  {
    call: "credentials.waiting",
    how: "query",
    input: { provider: "anthropic" },
    empty: [],
  },
  { call: "scouts.checkDue", how: "mutate", empty: [] },
];

/** A first Scout, as the form sends it. */
const FORM = {
  name: "Sleep and memory",
  query: "all:sleep",
  cadence: "daily",
  assigned: [],
  lane: "review",
  searchBackTo: null,
};

/** The acts that look a Scout up first: one that cannot be looked up is not a Scout that is not there. */
const ACTS: Call[] = [
  { call: "scouts.runNow", how: "mutate", input: { scoutId: "sleep" } },
  { call: "scouts.pause", how: "mutate", input: { scoutId: "sleep" } },
  {
    call: "scouts.setPaused",
    how: "mutate",
    input: { scoutId: "sleep", paused: true },
  },
  { call: "scouts.save", how: "mutate", input: FORM },
];

describe("a Scouts folder that cannot be listed", () => {
  // A file where the folder should be is ENOTDIR for any user, root included.
  it.each([...READS, ...ACTS])(
    "$call answers a failed read, with no path in its reason, when a file stands in its place",
    async ({ call, how, input }) => {
      const { vault, c } = await opened();
      await writeFile(join(vault, FOLDER), "a file, where a folder should be");

      const reply = await c[how](call, input);

      expect(reply.result).toBeUndefined();
      expect(reply.error?.message).toBe(NOT_A_FOLDER);
      expect(reply.error?.data.kind).toBe("unreadable");
      expect(reply.error?.message).not.toContain("Wan Shi Tong");
    }
  );

  // The mode the defect was first seen with. Root reads a 000 folder anyway,
  // so it is skipped there; ENOTDIR above is the case that never is.
  describe.skipIf(process.getuid?.() === 0)("whose mode forbids it", () => {
    it.each(["scouts.list", "scouts.health"])(
      "%s answers a failed read",
      async (call) => {
        const { vault, c } = await opened();
        const folder = join(vault, FOLDER);
        await mkdir(folder, { recursive: true });
        await chmod(folder, 0o000);
        try {
          const reply = await c.query(call);

          expect(reply.result).toBeUndefined();
          expect(reply.error?.message).toBe(DENIED);
          expect(reply.error?.data.kind).toBe("unreadable");
        } finally {
          await chmod(folder, 0o755);
        }
      }
    );
  });

  it("leaves Loose Ends answering, with the reason as a line it could not judge", async () => {
    const stub =
      "---\nkind: source-stub\ncitekey: old\ntitle: old\n---\n\n> a\n";
    const { vault, c } = await opened({ "sources/old.md": stub });
    await writeFile(join(vault, FOLDER), "a file, where a folder should be");

    const reply = await c.query<LooseEnds>("looseEnds.rows");

    // The rest of the dashboard is still judged; what it could not judge is
    // said, so a Scout that is broken cannot hide behind a tidy list.
    expect(reply.error).toBeUndefined();
    const ends = reply.result!.data;
    expect(ends.problems).toEqual([NOT_A_FOLDER]);
    expect(ends.groups.flatMap((g) => g.rows.map((row) => row.kind))).toContain(
      "stub-without-pdf"
    );
  });
});

describe("a vault with no Scouts folder yet", () => {
  // The one absence: nothing was ever made, so nothing is hidden.
  it.each(READS)("$call answers empty", async ({ call, how, input, empty }) => {
    const { c } = await opened();

    const reply = await c[how](call, input);

    expect(reply.error).toBeUndefined();
    expect(reply.result!.data).toEqual(empty);
  });

  it("is not a Scout that was lost: acting on one says there is none", async () => {
    const { c } = await opened();

    const reply = await c.mutate("scouts.runNow", { scoutId: "sleep" });

    expect(reply.error?.message).toBe("There is no Scout named sleep.");
  });

  it("has nothing to say in Loose Ends either", async () => {
    const { c } = await opened();

    const reply = await c.query<LooseEnds>("looseEnds.rows");

    expect(reply.result!.data.problems).toEqual([]);
  });

  it("is made by saving the first Scout", async () => {
    const { c } = await opened();

    const saved = await c.mutate("scouts.save", FORM);

    expect(saved.error).toBeUndefined();
    const listed = await c.query<{ scouts: Scout[] }>("scouts.list");
    expect(listed.result!.data.scouts.map((s) => s.id)).toEqual([
      "sleep-and-memory",
    ]);
  });
});

describe("a Scout file whose bytes cannot be read", () => {
  // A dangling link is a file `readdir` lists and `readFile` cannot open, for
  // any user — the same as a file whose mode forbids it, without chmod.
  it("is listed by name like one that does not parse, and the others are still read", async () => {
    const { vault, c } = await opened({ [`${FOLDER}/sleep.yaml`]: scoutYaml });
    await symlink(
      join(vault, "nowhere.yaml"),
      join(vault, FOLDER, "linked.yaml")
    );

    const listed = await c.query<{
      scouts: Scout[];
      unreadable: UnreadableScout[];
    }>("scouts.list");

    expect(listed.error).toBeUndefined();
    expect(listed.result!.data.scouts.map((s) => s.id)).toEqual(["sleep"]);
    expect(listed.result!.data.unreadable).toEqual([
      {
        file: "linked.yaml",
        sentence:
          "This file could not be read: ENOENT: no such file or directory.",
      },
    ]);
    // The rail says the same words, and the fleet makes no claim over it.
    const health = (await c.query<FleetHealth>("scouts.health")).result!.data;
    expect(health.unreadable.map((u) => u.file)).toEqual(["linked.yaml"]);
    const fleet = await c.query<{ claim: string | null; naming: string[] }>(
      "scouts.fleet"
    );
    expect(fleet.result!.data.claim).toBeNull();
    expect(fleet.result!.data.naming).toEqual(["linked.yaml"]);
  });
});
