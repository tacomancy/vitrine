import { chmod, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { Scout, UnreadableScout } from "./scout-file.js";
import { closeCores, core, tmp } from "./test-core.js";

// Loose Ends' *pause* is the form's own edit of a Scout's file, not a second
// way to write it (#533). Every edit of the file is a read-modify-write, so it
// is queued with the others and lands whole or not at all: two that overlap
// lose neither, and a write the disk cannot finish leaves the file as it was.
// Driven through the router, and what is asserted is what the researcher would
// find on the next read.

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

afterEach(async () => {
  fs.writeFile.mockImplementation(fs.actual.writeFile as never);
  await closeCores();
});

const FOLDER = ".vitrine/scouts";

const scoutYaml = `name: Sleep and memory\ncadence: daily\nlane: review\ncreated: 2026-09-20T00:00:00Z\nfilter:\n  query: all:sleep\n`;

/** The form saving an edit that changes three keys and not the Query, so it runs nothing. */
const EDITED_FORM = {
  id: "sleep",
  name: "Renamed",
  query: "all:sleep",
  cadence: "weekly",
  assigned: [],
  lane: "skim",
  searchBackTo: null,
};

/**
 * Loose Ends' *pause* and the header's. They are one edit of the file, so
 * every test that takes a pause takes both.
 */
const PAUSES = [
  { call: "scouts.pause", input: { scoutId: "sleep" } },
  { call: "scouts.setPaused", input: { scoutId: "sleep", paused: true } },
];

/** Every act that edits a Scout's file, and what the next read of the Scout shows of it. */
const EDITS = [
  ...PAUSES.map((pause) => ({ ...pause, shows: { paused: true } })),
  { call: "scouts.save", input: EDITED_FORM, shows: { name: "Renamed" } },
  {
    call: "scouts.setCadence",
    input: { scoutId: "sleep", cadence: "monthly" },
    shows: { cadence: "monthly" },
  },
];

async function opened(files: Record<string, string>) {
  const vault = await tmp("scout-pause");
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(vault, file)), { recursive: true });
    await fs.actual.writeFile(join(vault, file), text);
  }
  const c = await core();
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const listed = async () => {
    const read = await c.query<{
      scouts: Scout[];
      dropped: Scout[];
      unreadable: UnreadableScout[];
    }>("scouts.list");
    expect(read.error).toBeUndefined();
    return read.result!.data;
  };
  return {
    c,
    vault,
    listed,
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
    const target = String(args[0]);
    if (taken || !target.includes(`/${FOLDER}/`)) {
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
  // A test that fails while a write is held must not leave its call hanging.
  onTestFinished(release);
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

const ALLOWED_MS = 250;

/**
 * Give a call the chance to finish while an edit is held. One that is not
 * queued behind the held edit finishes in a few milliseconds; one that is does
 * nothing until the edit lets go, so there is no event to wait for, only a time
 * that is long next to an edit and short next to a test. Being wrong costs the
 * one side: a slow machine can only make a call that would have overlapped
 * look queued, and never the reverse.
 */
const allowToFinish = (call: Promise<unknown>) =>
  Promise.race([
    call,
    new Promise((resolve) => setTimeout(resolve, ALLOWED_MS)),
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
      const { c, listed } = await opened({
        [`${FOLDER}/sleep.yaml`]: scoutYaml,
      });
      const write = holdNextScoutWrite();
      const edit = c.mutate("scouts.save", EDITED_FORM);
      await write.reached;

      const pause = c.mutate(call, input);
      await allowToFinish(pause);
      write.release();

      expect((await edit).error).toBeUndefined();
      expect((await pause).error).toBeUndefined();
      expect((await listed()).scouts).toMatchObject([BOTH]);
    }
  );

  it.each(PAUSES)(
    "$call keeps the edit when the pause was already under way",
    async ({ call, input }) => {
      const { c, listed } = await opened({
        [`${FOLDER}/sleep.yaml`]: scoutYaml,
      });
      const write = holdNextScoutWrite();
      const pause = c.mutate(call, input);
      await write.reached;

      const edit = c.mutate("scouts.save", EDITED_FORM);
      await allowToFinish(edit);
      write.release();

      expect((await pause).error).toBeUndefined();
      expect((await edit).error).toBeUndefined();
      expect((await listed()).scouts).toMatchObject([BOTH]);
    }
  );
});

// A row's cadence menu and its pause are two narrow writes of one file, made a
// click apart on one row (#520): each reads the file and writes it back, so one
// that began while the other was mid-write must still find the other's key.
describe("a cadence change and a pause that overlap", () => {
  const CADENCE = {
    call: "scouts.setCadence",
    input: { scoutId: "sleep", cadence: "monthly" },
  };
  const PAUSE = {
    call: "scouts.setPaused",
    input: { scoutId: "sleep", paused: true },
  };
  const BOTH = { id: "sleep", cadence: "monthly", paused: true };

  it.each([
    { first: CADENCE, second: PAUSE },
    { first: PAUSE, second: CADENCE },
  ])(
    "keeps both keys when $first.call was already under way",
    async ({ first, second }) => {
      const { c, listed } = await opened({
        [`${FOLDER}/sleep.yaml`]: scoutYaml,
      });
      const write = holdNextScoutWrite();
      const under = c.mutate(first.call, first.input);
      await write.reached;

      const queued = c.mutate(second.call, second.input);
      await allowToFinish(queued);
      write.release();

      expect((await under).error).toBeUndefined();
      expect((await queued).error).toBeUndefined();
      expect((await listed()).scouts).toMatchObject([BOTH]);
    }
  );
});

describe("an edit the disk cannot finish", () => {
  // The failure injected here empties the file it opens, as a full disk does,
  // so only a writer that opens the Scout's own file can lose it. Every edit
  // writes a temp file and renames it, and so every edit leaves the Scout as
  // it was.
  it.each(EDITS)(
    "$call leaves the Scout file as it was, and still a Scout",
    async ({ call, input }) => {
      const { c, listed, file } = await opened({
        [`${FOLDER}/sleep.yaml`]: scoutYaml,
      });
      failNextScoutWrite();

      const reply = await c.mutate(call, input);

      expect(reply.result).toBeUndefined();
      expect(reply.error?.data.kind).toBe("writeFailed");
      const read = await listed();
      expect(read.unreadable).toEqual([]);
      expect(read.scouts.map((s) => s.id)).toEqual(["sleep"]);
      expect(await file()).toBe(scoutYaml);
    }
  );
});

// An edit replaces a Scout's file by rename, so only the folder's mode is
// asked of the filesystem, never the file's: all three edits replace a
// read-only file alike (`docs/architecture.md` § Scouts, *Form*).
describe.skipIf(process.getuid?.() === 0)(
  "a Scout whose file the user made read-only",
  () => {
    it.each(EDITS)(
      "is changed by $call all the same",
      async ({ call, input, shows }) => {
        const { c, listed, path } = await opened({
          [`${FOLDER}/sleep.yaml`]: scoutYaml,
        });
        await chmod(path(), 0o444);

        const reply = await c.mutate(call, input);

        expect(reply.error).toBeUndefined();
        expect((await listed()).scouts).toMatchObject([shows]);
      }
    );
  }
);

// `readScouts` takes a Scout from a `.yaml` or `.yml` name, and the lookup that
// finds its file for an edit must take the same ones: a folder, or any other
// file, named like the id sorts ahead of `sleep.yaml` and is not the Scout.
describe("a Scout with something beside it named like it", () => {
  it.each(EDITS)("is still found by $call", async ({ call, input, shows }) => {
    const { c, vault, listed } = await opened({
      [`${FOLDER}/sleep.yaml`]: scoutYaml,
    });
    await mkdir(join(vault, FOLDER, "sleep"));

    const reply = await c.mutate(call, input);

    expect(reply.error).toBeUndefined();
    expect((await listed()).scouts).toMatchObject([shows]);
  });
});

// What a hand-written file is owed (ADR 0009): a key set in place, in a
// document edited rather than re-stringified, and a file the app cannot parse
// left for its owner.
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

// A drop and a restore are edits of the Scout's file like a pause or a save
// (#521; ADR 0042 decision 1): `scouts.drop` and `scouts.restore` are the only
// writers of the key, and each takes the one path every edit takes. They are
// asserted here, beside the rest, so a second way to write the file cannot
// slip in unnoticed.
describe("a drop and a restore", () => {
  const dropped = `${scoutYaml}dropped: 2026-09-25T00:00:00Z\n`;
  const DROP = { call: "scouts.drop", input: { scoutId: "sleep" } };
  const RESTORE = { call: "scouts.restore", input: { scoutId: "sleep" } };
  const BOTH = [
    { ...DROP, file: scoutYaml },
    { ...RESTORE, file: dropped },
  ];

  it("keep an edit that was already under way, and the edit is kept too", async () => {
    const { c, listed } = await opened({ [`${FOLDER}/sleep.yaml`]: scoutYaml });
    const write = holdNextScoutWrite();
    const edit = c.mutate("scouts.save", EDITED_FORM);
    await write.reached;

    const drop = c.mutate(DROP.call, DROP.input);
    await allowToFinish(drop);
    write.release();

    expect((await edit).error).toBeUndefined();
    expect((await drop).error).toBeUndefined();
    const read = await listed();
    expect(read.scouts).toEqual([]);
    expect(read.dropped).toMatchObject([
      { id: "sleep", name: "Renamed", cadence: "weekly", lane: "skim" },
    ]);
  });

  it.each(BOTH)(
    "$call leaves the Scout file as it was, and still a Scout, when the disk cannot finish",
    async ({ call, input, file: before }) => {
      const { c, listed, file } = await opened({
        [`${FOLDER}/sleep.yaml`]: before,
      });
      failNextScoutWrite();

      const reply = await c.mutate(call, input);

      expect(reply.result).toBeUndefined();
      expect(reply.error?.data.kind).toBe("writeFailed");
      const read = await listed();
      expect(read.unreadable).toEqual([]);
      expect([...read.scouts, ...read.dropped].map((s) => s.id)).toEqual([
        "sleep",
      ]);
      expect(await file()).toBe(before);
    }
  );

  // An edit replaces the file by rename, so a file the user made read-only is
  // replaced all the same: only the folder's mode is asked of the filesystem.
  describe.skipIf(process.getuid?.() === 0)("on a read-only file", () => {
    it.each(BOTH)("$call changes it all the same", async (edit) => {
      const { c, listed, path } = await opened({
        [`${FOLDER}/sleep.yaml`]: edit.file,
      });
      await chmod(path(), 0o444);

      const reply = await c.mutate(edit.call, edit.input);

      expect(reply.error).toBeUndefined();
      const read = await listed();
      expect(read.scouts.length).toBe(edit.call === "scouts.restore" ? 1 : 0);
      expect(read.dropped.length).toBe(edit.call === "scouts.drop" ? 1 : 0);
    });
  });

  it.each(BOTH)(
    "$call still finds a Scout with something beside it named like it",
    async (edit) => {
      const { c, vault, listed } = await opened({
        [`${FOLDER}/sleep.yaml`]: edit.file,
      });
      await mkdir(join(vault, FOLDER, "sleep"));

      const reply = await c.mutate(edit.call, edit.input);

      expect(reply.error).toBeUndefined();
      const read = await listed();
      expect(read.scouts.length).toBe(edit.call === "scouts.restore" ? 1 : 0);
      expect(read.dropped.length).toBe(edit.call === "scouts.drop" ? 1 : 0);
    }
  );
});
