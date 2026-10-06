import {
  chmod,
  mkdir,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeCores, core, tmp, type Reply } from "./test-core.js";

// The Scout file writers refuse in words, not in Node's (#530). A step the
// filesystem will not take used to leave `scouts.pause`, `scouts.setPaused`
// and `scouts.save` as an INTERNAL_SERVER_ERROR whose message was Node's
// errno, absolute path and all: the machine's layout, on a surface, in a
// screenshot (ADR 0028; #277, #285, #288 were the same defect on other
// sites). Every one is a VaultError now, vault-relative, through the router.

// The one place a test reaches below the router, as `questions.atomic.test.ts`
// does for `rename`: an edit reads a Scout's file a second time after
// listing it, and that read fails only if the file goes in between, which no
// router call can arrange. Every other read passes straight through.
const fs = vi.hoisted(() => ({
  readFile: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  actual: null as unknown as typeof import("node:fs/promises"),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  fs.actual = await importOriginal<typeof import("node:fs/promises")>();
  fs.readFile.mockImplementation(fs.actual.readFile as never);
  return { ...fs.actual, readFile: fs.readFile };
});

afterEach(async () => {
  fs.readFile.mockImplementation(fs.actual.readFile as never);
  await closeCores();
});

const FOLDER = ".vitrine/scouts";

const scoutYaml = `name: Sleep and memory\ncadence: daily\nlane: review\ncreated: 2026-09-20T00:00:00Z\nfilter:\n  query: all:sleep\n`;

/** A first Scout, as the form sends it. */
const FORM = {
  name: "Sleep and memory",
  query: "all:sleep",
  cadence: "daily",
  assigned: [],
  lane: "review",
  searchBackTo: null,
};

/**
 * A vault named as the real one is, apostrophe and all (`Wan Shi Tong's
 * Library`): a cut that stopped at the path's first quote would pass every
 * other fixture and print this one's whole path (ADR 0028).
 */
async function opened(files: Record<string, string> = {}) {
  const vault = join(await tmp("scout-write"), "Wan Shi Tong's Library");
  for (const [file, text] of Object.entries(files)) {
    await mkdir(dirname(join(vault, file)), { recursive: true });
    await writeFile(join(vault, file), text);
  }
  await mkdir(vault, { recursive: true });
  const c = await core();
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  return { vault, c };
}

/**
 * `act` with `path` at `mode`, and the mode it had put back whatever
 * happens: a folder left shut is one the temp-dir cleanup cannot enter.
 */
async function withMode<T>(
  path: string,
  mode: number,
  act: () => Promise<T>
): Promise<T> {
  const before = (await stat(path)).mode & 0o7777;
  await chmod(path, mode);
  try {
    return await act();
  } finally {
    await chmod(path, before);
  }
}

/**
 * What the surface shows for a refused step: these words, of this kind, and
 * nothing of where the vault is. The equality alone says the last, but a
 * message loosened to a `toContain` later should still fail on a path.
 */
function refusedAs(
  reply: Reply<unknown>,
  vault: string,
  kind: string,
  message: string
) {
  expect(reply.result).toBeUndefined();
  expect(reply.error?.message).toBe(message);
  expect(reply.error?.data.kind).toBe(kind);
  for (const part of [vault, dirname(vault), basename(vault)]) {
    expect(reply.error?.message).not.toContain(part);
  }
}

describe.skipIf(process.getuid?.() === 0)("a write the mode forbids", () => {
  // `pauseScout` opens the Scout's own file for writing, so it is the
  // file's mode that stops it; the folder's has no part.
  it("scouts.pause names the file it could not write", async () => {
    const { vault, c } = await opened({ [`${FOLDER}/sleep.yaml`]: scoutYaml });

    const reply = await withMode(join(vault, FOLDER, "sleep.yaml"), 0o444, () =>
      c.mutate("scouts.pause", { scoutId: "sleep" })
    );

    refusedAs(
      reply,
      vault,
      "writeFailed",
      "Couldn't write .vitrine/scouts/sleep.yaml: EACCES: permission denied"
    );
  });

  // `writeAtomically` makes a temp file beside the Scout, so here it is the
  // folder's mode that stops it, and Node names the temp file, not the Scout.
  it("scouts.setPaused names the file it could not write", async () => {
    const { vault, c } = await opened({ [`${FOLDER}/sleep.yaml`]: scoutYaml });

    const reply = await withMode(join(vault, FOLDER), 0o555, () =>
      c.mutate("scouts.setPaused", { scoutId: "sleep", paused: true })
    );

    refusedAs(
      reply,
      vault,
      "writeFailed",
      "Couldn't write .vitrine/scouts/sleep.yaml: EACCES: permission denied"
    );
  });

  it("scouts.save names the file of the Scout it could not make", async () => {
    const { vault, c } = await opened({ [`${FOLDER}/other.yaml`]: scoutYaml });

    const reply = await withMode(join(vault, FOLDER), 0o555, () =>
      c.mutate("scouts.save", FORM)
    );

    refusedAs(
      reply,
      vault,
      "writeFailed",
      "Couldn't write .vitrine/scouts/sleep-and-memory.yaml: EACCES: permission denied"
    );
  });

  it("scouts.save names the folder it could not create", async () => {
    const { vault, c } = await opened();

    const reply = await withMode(join(vault, ".vitrine"), 0o555, () =>
      c.mutate("scouts.save", FORM)
    );

    refusedAs(
      reply,
      vault,
      "writeFailed",
      "Couldn't create .vitrine/scouts/: EACCES: permission denied"
    );
  });
});

describe("a folder that cannot be made", () => {
  // A dangling link lists as no folder (ENOENT is the one absence, #526)
  // and cannot be made one: for any user, root included.
  it("scouts.save names the folder it could not create", async () => {
    const { vault, c } = await opened();
    await symlink(join(vault, "nowhere"), join(vault, FOLDER));

    const reply = await c.mutate("scouts.save", FORM);

    refusedAs(
      reply,
      vault,
      "writeFailed",
      "Couldn't create .vitrine/scouts/: ENOENT: no such file or directory"
    );
  });
});

describe("a Scout file that goes between the lookup and the edit", () => {
  // `readScouts` has read it once and the edit is about to read it again:
  // the file goes first, and Node's own `readFile` says so — ENOENT, which
  // keeps its cause here as everywhere ADR 0028 gives it no words of its own.
  const goesBeforeItsSecondRead = (path: string) => {
    let reads = 0;
    fs.readFile.mockImplementation(async (...args) => {
      if (args[0] === path && ++reads === 2) await unlink(path);
      return fs.actual.readFile(
        ...(args as Parameters<typeof fs.actual.readFile>)
      );
    });
  };

  const GONE =
    "Couldn't read .vitrine/scouts/sleep.yaml: ENOENT: no such file or directory";

  it.each([
    { call: "scouts.pause", input: { scoutId: "sleep" } },
    { call: "scouts.setPaused", input: { scoutId: "sleep", paused: true } },
    { call: "scouts.save", input: { ...FORM, id: "sleep" } },
  ])("$call names the file it could not read", async ({ call, input }) => {
    const { vault, c } = await opened({ [`${FOLDER}/sleep.yaml`]: scoutYaml });
    goesBeforeItsSecondRead(join(vault, FOLDER, "sleep.yaml"));

    const reply = await c.mutate(call, input);

    refusedAs(reply, vault, "unreadable", GONE);
  });
});
