import { chmod, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Scout, UnreadableScout } from "./scout-file.js";
import { closeCores, core, tmp } from "./test-core.js";

// Loose Ends' *pause* is the form's own edit of a Scout's file, not a second
// way to write it (#533). Every edit of the file is a read-modify-write, so
// it is queued with the others and lands whole or not at all: two that
// overlap lose neither, and a write the disk cannot finish leaves the file
// as it was. Driven through the router, and what is asserted is what the
// researcher would find on the next read.

// The one place a test reaches below the router, as `questions.atomic.test.ts`
// does for `rename`: an overlap and a full disk both happen *between* an
// edit's read and its write, and only a hook on the write can put one there.
// Only a write into the Scouts folder is ever touched; the rest pass through.
const fs = vi.hoisted(() => ({
  writeFile: vi.fn<(...args: unknown[]) => Promise<void>>(),
  actual: null as unknown as typeof import("node:fs/promises"),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  fs.actual = await importOriginal<typeof import("node:fs/promises")>();
  fs.writeFile.mockImplementation(fs.actual.writeFile as never);
  return { ...fs.actual, writeFile: fs.writeFile };
});

/** What lets go of the write a test is holding, so a failure cannot leave a call hanging. */
let letGo: (() => void) | undefined;

afterEach(async () => {
  letGo?.();
  letGo = undefined;
  fs.writeFile.mockImplementation(fs.actual.writeFile as never);
  await closeCores();
});

const NOW = new Date("2026-09-30T12:34:00Z");
const FOLDER = ".vitrine/scouts";

const scoutYaml = `name: Sleep and memory\ncadence: daily\nlane: review\ncreated: 2026-09-20T00:00:00Z\nfilter:\n  query: all:sleep\n`;

/** An edit from the form that changes three keys and not the Query, so it runs nothing. */
const EDIT = {
  id: "sleep",
  name: "Renamed",
  query: "all:sleep",
  cadence: "weekly",
  assigned: [],
  lane: "skim",
  searchBackTo: null,
};

/**
 * The two ways to pause a Scout: Loose Ends' *pause*, and the header's
 * *pause*, which is the form's own. `scouts.setPaused` is the control
 * wherever it appears: it was queued and atomic before #533, so a test that
 * fails for `scouts.pause` alone is failing on what `pauseScout` did.
 */
const PAUSES = [
  { call: "scouts.pause", input: { scoutId: "sleep" } },
  { call: "scouts.setPaused", input: { scoutId: "sleep", paused: true } },
];

/** Every act that edits a Scout's file, and what the next read of the Scout shows of it. */
const EDITS = [
  ...PAUSES.map((pause) => ({ ...pause, shows: { paused: true } })),
  { call: "scouts.save", input: EDIT, shows: { name: "Renamed" } },
];

async function opened(files: Record<string, string>) {
  const vault = await tmp("scout-pause");
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(vault, file)), { recursive: true });
    await fs.actual.writeFile(join(vault, file), text);
  }
  const c = await core({ now: () => NOW });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const scouts = async () => {
    const listed = await c.query<{
      scouts: Scout[];
      unreadable: UnreadableScout[];
    }>("scouts.list");
    expect(listed.error).toBeUndefined();
    return listed.result!.data;
  };
  return {
    c,
    vault,
    scouts,
    file: () => readFile(join(vault, FOLDER, "sleep.yaml"), "utf8"),
    path: () => join(vault, FOLDER, "sleep.yaml"),
  };
}

/** `behave` takes over the first write into the Scouts folder from here on; later ones pass through. */
function interceptNextScoutWrite(
  behave: (args: Parameters<typeof fs.actual.writeFile>) => Promise<void>
) {
  let taken = false;
  fs.writeFile.mockImplementation(async (...args) => {
    const into = String(args[0]);
    if (taken || !into.includes(`/${FOLDER}/`)) {
      return fs.actual.writeFile(
        ...(args as Parameters<typeof fs.actual.writeFile>)
      );
    }
    taken = true;
    return behave(args as Parameters<typeof fs.actual.writeFile>);
  });
}

/**
 * Stop the next edit just before it writes: it has read the file and worked
 * out what to put there, and nothing has changed on disk yet.
 */
function holdNextScoutWrite() {
  let held!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => (held = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  letGo = release;
  interceptNextScoutWrite(async (args) => {
    held();
    await released;
    return fs.actual.writeFile(...args);
  });
  return { reached, release };
}

/**
 * A full disk, as it reaches a writer: the file is opened — and emptied,
 * unless the caller asked for a new one with `wx` — and then nothing more
 * lands.
 */
function failNextScoutWrite() {
  interceptNextScoutWrite(async ([path, , options]) => {
    await fs.actual.writeFile(path, "", options);
    throw Object.assign(new Error("ENOSPC: no space left on device, write"), {
      code: "ENOSPC",
    });
  });
}

/**
 * Whether a call has finished once nothing is holding it back. One that is
 * not queued behind the held edit finishes in a few milliseconds; one that
 * is does nothing until the edit lets go, so there is no event to wait for,
 * only a time that is long next to an edit and short next to a test. Being
 * wrong costs the one side: a slow machine can only make a call that would
 * have overlapped look queued, and never the reverse.
 */
const SETTLE_MS = 250;
const settled = (call: Promise<unknown>) =>
  Promise.race([
    call,
    new Promise((resolve) => setTimeout(resolve, SETTLE_MS)),
  ]);

describe("a pause and an edit of one Scout that overlap", () => {
  const BOTH = {
    id: "sleep",
    name: "Renamed",
    cadence: "weekly",
    lane: "skim",
    paused: true,
  };

  it.each(PAUSES)(
    "$call keeps the pause when the edit was already under way",
    async ({ call, input }) => {
      const { c, scouts } = await opened({
        [`${FOLDER}/sleep.yaml`]: scoutYaml,
      });
      const write = holdNextScoutWrite();
      const edit = c.mutate("scouts.save", EDIT);
      await write.reached;

      const pause = c.mutate(call, input);
      await settled(pause);
      write.release();

      expect((await edit).error).toBeUndefined();
      expect((await pause).error).toBeUndefined();
      expect((await scouts()).scouts).toMatchObject([BOTH]);
    }
  );

  it.each(PAUSES)(
    "$call keeps the edit when the pause was already under way",
    async ({ call, input }) => {
      const { c, scouts } = await opened({
        [`${FOLDER}/sleep.yaml`]: scoutYaml,
      });
      const write = holdNextScoutWrite();
      const pause = c.mutate(call, input);
      await write.reached;

      const edit = c.mutate("scouts.save", EDIT);
      await settled(edit);
      write.release();

      expect((await pause).error).toBeUndefined();
      expect((await edit).error).toBeUndefined();
      expect((await scouts()).scouts).toMatchObject([BOTH]);
    }
  );
});

describe("an edit the disk cannot finish", () => {
  // The injected failure does not destroy a Scout by itself: only a write
  // that empties the file first does, as `pauseScout`'s did and the atomic
  // writer's never does. `scouts.setPaused` and `scouts.save` are the
  // controls that say so.
  it.each([...PAUSES, { call: "scouts.save", input: EDIT }])(
    "$call leaves the Scout file as it was, and still a Scout",
    async ({ call, input }) => {
      const { c, scouts, file } = await opened({
        [`${FOLDER}/sleep.yaml`]: scoutYaml,
      });
      failNextScoutWrite();

      const reply = await c.mutate(call, input);

      expect(reply.result).toBeUndefined();
      expect(reply.error?.data.kind).toBe("writeFailed");
      const read = await scouts();
      expect(read.unreadable).toEqual([]);
      expect(read.scouts.map((s) => s.id)).toEqual(["sleep"]);
      expect(await file()).toBe(scoutYaml);
    }
  );
});

// `pauseScout` opened the Scout's own file for writing, so a file the user
// made read-only refused it, where the form's save and pause have always
// replaced the file by rename and asked only the folder's mode (#533). One
// rule for what the app does to such a file, whichever act asked: it is
// replaced. Honouring a read-only mark would be a rule for all three, and a
// decision of its own.
describe.skipIf(process.getuid?.() === 0)(
  "a Scout whose file the user made read-only",
  () => {
    it.each(EDITS)(
      "is changed by $call all the same",
      async ({ call, input, shows }) => {
        const { c, scouts, path } = await opened({
          [`${FOLDER}/sleep.yaml`]: scoutYaml,
        });
        await chmod(path(), 0o444);

        const reply = await c.mutate(call, input);

        expect(reply.error).toBeUndefined();
        expect((await scouts()).scouts).toMatchObject([shows]);
      }
    );
  }
);

// `readScouts` takes a Scout from a `.yaml` or `.yml` name, and the lookup that
// finds its file for an edit must take the same ones: a folder, or any other
// file, named like the id sorts ahead of `sleep.yaml` and is not the Scout.
// `pauseScout` had that check; the form's lookup did not, so a pause from
// Loose Ends would have lost it (#533).
describe("a Scout with something beside it named like it", () => {
  it.each(EDITS)("is still found by $call", async ({ call, input, shows }) => {
    const { c, vault, scouts } = await opened({
      [`${FOLDER}/sleep.yaml`]: scoutYaml,
    });
    await mkdir(join(vault, FOLDER, "sleep"));

    const reply = await c.mutate(call, input);

    expect(reply.error).toBeUndefined();
    expect((await scouts()).scouts).toMatchObject([shows]);
  });
});

// What `pauseScout`'s own comment promised, and what a hand-written file is
// owed (ADR 0009): a key set in place, in a document edited rather than
// re-stringified, and a file the app cannot parse left for its owner.
describe("a pause", () => {
  it.each(PAUSES)(
    "$call sets one key, and leaves a hand-written file's comments, unknown keys and order as they were",
    async ({ call, input }) => {
      const hand = `# Watching sleep for the lab\nname: Sleep and memory\ncadence: daily # not weekly: it is slow\nlane: review\ncreated: 2026-09-20T00:00:00Z\ncap: 40\nfilter:\n  query: all:sleep\n`;
      const { c, file } = await opened({ [`${FOLDER}/sleep.yaml`]: hand });

      const reply = await c.mutate(call, input);

      expect(reply.error).toBeUndefined();
      expect(await file()).toBe(`${hand}paused: true\n`);
    }
  );

  it.each(PAUSES)(
    "$call refuses a Scout that is not there",
    async ({ call, input }) => {
      const { c } = await opened({ [`${FOLDER}/other.yaml`]: scoutYaml });

      const reply = await c.mutate(call, input);

      expect(reply.error?.message).toBe("There is no Scout named sleep.");
      // A refusal, not a fault: the 400 `refusing` makes of a `VaultError`.
      expect(reply.error?.data).toMatchObject({
        code: "BAD_REQUEST",
        kind: "refused",
      });
    }
  );

  // The app would be guessing at the shape of a file it cannot read as a Scout.
  it.each(PAUSES)(
    "$call refuses a file that does not parse, and does not rewrite it",
    async ({ call, input }) => {
      const broken = "name: [unclosed\n";
      const { c, file } = await opened({ [`${FOLDER}/sleep.yaml`]: broken });

      const reply = await c.mutate(call, input);

      expect(reply.error?.data).toMatchObject({
        code: "BAD_REQUEST",
        kind: "refused",
      });
      expect(await file()).toBe(broken);
    }
  );
});
