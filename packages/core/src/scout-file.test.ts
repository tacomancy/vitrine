import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryCredentialStore } from "./credentials.js";
import type { LooseEnds } from "./loose-ends.js";
import type { ModelProvider } from "./model-provider.js";
import type { Scout, UnreadableScout } from "./scout-file.js";
import type { FleetHealth } from "./scout-health.js";
import { closeCores, core, tmp, type CoreOptions } from "./test-core.js";

// A Scouts folder the app cannot list is not a vault with no Scouts (#526).
// Only the folder's absence is empty (`CLAUDE.md` § Invariants, no silent
// failures; ADR 0032: a failed read is the *wrong* Voice and never passes for
// a quiet field), so every call that needs to know what the Scouts are says
// it cannot, through the router in process.

afterEach(() => {
  vi.restoreAllMocks();
  return closeCores();
});

const NOW = new Date("2026-09-30T12:34:00Z");
const FOLDER = ".vitrine/scouts";

// The reason as every surface prints it: vault-relative, with Node's own
// `, scandir '<path>'` cut off (ADR 0028).
const NOT_A_FOLDER = "Couldn't read .vitrine/scouts/: ENOTDIR: not a directory";
const DENIED = "Couldn't read .vitrine/scouts/: EACCES: permission denied";

const scoutYaml = `name: Sleep and memory\ncadence: daily\nlane: review\ncreated: 2026-09-20T00:00:00Z\nfilter:\n  query: all:sleep\n`;

/**
 * A vault named as the real one is, apostrophe and all (`Wan Shi Tong's
 * Library`): a strip that cut the path only when it held no quote would pass
 * every other fixture and fail on this one (ADR 0028).
 */
async function opened(
  files: Record<string, string> = {},
  options: CoreOptions = {}
) {
  const vault = join(await tmp("scout-file"), "Wan Shi Tong's Library");
  await mkdir(vault);
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(vault, file)), { recursive: true });
    await writeFile(join(vault, file), text);
  }
  const c = await core({ now: () => NOW, ...options });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  return { vault, c };
}

type Call = { call: string; how: "query" | "mutate"; input?: unknown };

/** Every call that reads the Scouts, and what it answers when there are none. */
const READS: Array<Call & { empty: unknown }> = [
  { call: "scouts.list", how: "query", empty: { scouts: [], unreadable: [] } },
  {
    call: "scouts.health",
    how: "query",
    empty: { scouts: [], unreadable: [] },
  },
  { call: "scouts.fleet", how: "query", empty: { claim: null, naming: [] } },
  {
    call: "scouts.activity",
    how: "query",
    empty: { rows: [], fleet: { parsingCleanly: 0, notParsing: 0, noKey: 0 } },
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

/** The acts that look a Scout up first: a folder that cannot be read is not a Scout that is not there. */
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
    "$call answers the failed read, with no path in its reason, when a file stands in its place",
    async ({ call, how, input }) => {
      const { vault, c } = await opened();
      await writeFile(join(vault, FOLDER), "a file, where a folder should be");

      const reply = await c[how](call, input);

      expect(reply.result).toBeUndefined();
      expect(reply.error?.message).toBe(NOT_A_FOLDER);
      expect(reply.error?.data.kind).toBe("unreadable");
    }
  );

  // The mode the defect was first seen with. Root reads a 000 folder anyway,
  // so it is skipped there; the ENOTDIR case above never is.
  describe.skipIf(process.getuid?.() === 0)("whose mode forbids it", () => {
    it.each(["scouts.list", "scouts.health"])(
      "%s answers the failed read",
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

    // Every other group is still judged; what could not be is said, so a
    // broken Scout cannot hide behind a tidy list.
    expect(reply.error).toBeUndefined();
    const ends = reply.result!.data;
    expect(ends.problems).toEqual([NOT_A_FOLDER]);
    expect(ends.groups.flatMap((g) => g.rows.map((row) => row.kind))).toContain(
      "stub-without-pdf"
    );
  });

  // The key is stored and it works; starting what waited on it is the
  // follow-on that cannot happen, and is no reason to tell whoever stored it
  // that they failed. The core's log carries the reason.
  it("does not fail a stored key, or a passing test of it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = createMemoryCredentialStore();
    const models: ModelProvider = {
      countTokens: () => Promise.resolve(8),
      extract: () => Promise.reject(new Error("not called")),
    };
    const { vault, c } = await opened(
      {},
      { watched: { credentials: store, models } }
    );
    await writeFile(join(vault, FOLDER), "a file, where a folder should be");

    const set = await c.mutate("credentials.set", {
      provider: "anthropic",
      key: "sk-test",
    });
    const tested = await c.mutate("credentials.test", {
      provider: "anthropic",
    });

    expect(set.error).toBeUndefined();
    expect(await store.get("anthropic")).toBe("sk-test");
    expect(tested.result?.data).toEqual({ result: "ok" });
    expect(log).toHaveBeenCalledWith(
      `vitrine-core: no Scout started for the key: ${NOT_A_FOLDER}`
    );
  });
});

describe("a vault with no Scouts folder yet", () => {
  // The one absence: nothing was made, so nothing is hidden.
  it.each(READS)("$call answers empty", async ({ call, how, input, empty }) => {
    const { c } = await opened();

    const reply = await c[how](call, input);

    expect(reply.error).toBeUndefined();
    expect(reply.result!.data).toEqual(empty);
  });

  it("says there is no such Scout when asked to act on one, not that the folder failed", async () => {
    const { c } = await opened();

    const reply = await c.mutate("scouts.runNow", { scoutId: "sleep" });

    expect(reply.error?.message).toBe("There is no Scout named sleep.");
  });

  it("has nothing to say in Loose Ends either", async () => {
    const { c } = await opened();

    const reply = await c.query<LooseEnds>("looseEnds.rows");

    expect(reply.result!.data.problems).toEqual([]);
  });

  it("gets the folder when the first Scout is saved", async () => {
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
  const SENTENCE =
    "This file could not be read: ENOENT: no such file or directory.";

  // A dangling link is listed by `readdir` and cannot be opened by
  // `readFile`, for any user — as a file whose mode forbids it, without chmod.
  async function withDanglingLink() {
    const made = await opened({ [`${FOLDER}/sleep.yaml`]: scoutYaml });
    await symlink(
      join(made.vault, "nowhere.yaml"),
      join(made.vault, FOLDER, "linked.yaml")
    );
    return made.c;
  }

  it("is listed by name like one that does not parse, and the other Scouts are still read", async () => {
    const c = await withDanglingLink();

    const listed = await c.query<{
      scouts: Scout[];
      unreadable: UnreadableScout[];
    }>("scouts.list");

    expect(listed.error).toBeUndefined();
    expect(listed.result!.data.scouts.map((s) => s.id)).toEqual(["sleep"]);
    expect(listed.result!.data.unreadable).toEqual([
      { file: "linked.yaml", sentence: SENTENCE },
    ]);
  });

  // One sentence, derived once, on every surface (ADR 0032 decision 7).
  it("says the same sentence in the rail and in Loose Ends, and the fleet claims nothing over it", async () => {
    const c = await withDanglingLink();

    const rail = (await c.query<FleetHealth>("scouts.health")).result!.data;
    const fleet = (
      await c.query<{ claim: string | null; naming: string[] }>("scouts.fleet")
    ).result!.data;
    const ends = (await c.query<LooseEnds>("looseEnds.rows")).result!.data;

    expect(rail.unreadable).toEqual([
      {
        file: "linked.yaml",
        health: { voice: "wrong", kind: null, sentence: SENTENCE },
      },
    ]);
    expect(fleet).toEqual({ claim: null, naming: ["linked.yaml"] });
    expect(
      ends.groups
        .flatMap((g) => g.rows)
        .filter((r) => r.kind === "unreadable-scout")
    ).toEqual([
      {
        kind: "unreadable-scout",
        subject: "linked.yaml",
        path: ".vitrine/scouts/linked.yaml",
        title: "linked.yaml",
        sentence: SENTENCE,
      },
    ]);
  });
});
