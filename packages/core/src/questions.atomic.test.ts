import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bytes, closeCores, core, tmp } from "./test-core.js";

// The one place a test reaches below the router: `rename` is the boundary
// between a whole file and a half one, and only a failure there shows
// whether the write was atomic. `writeFile` is the boundary before it, where
// the temp file is made and filled, and a full disk fails it between the two.
const fs = vi.hoisted(() => ({
  rename: vi.fn<(a: string, b: string) => Promise<void>>(),
  writeFile: vi.fn<(...args: unknown[]) => Promise<void>>(),
  actual: null as unknown as typeof import("node:fs/promises"),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  fs.actual = await importOriginal<typeof import("node:fs/promises")>();
  fs.rename.mockImplementation(fs.actual.rename);
  fs.writeFile.mockImplementation(fs.actual.writeFile as never);
  return { ...fs.actual, rename: fs.rename, writeFile: fs.writeFile };
});

afterEach(async () => {
  fs.writeFile.mockImplementation(fs.actual.writeFile as never);
  await closeCores();
});

const unattached = { context: "other" as const };

/** A vault open in a core, and the folder a capture writes into. */
async function opened() {
  const c = await core();
  const vault = await tmp("vault");
  await c.mutate("vault.open", { path: vault });
  return { c, folder: join(vault, "questions") };
}

/**
 * A full disk, as the atomic write meets it (#540): the temp file is made and
 * then the write fails; with `made: false` the disk refuses before there is a
 * file at all. Only the next write into `folder` is touched — a page is a temp
 * file and a rename, so that write is the temp file — and the folder keeps the
 * watcher's and the index's own writes, which land under `.vitrine/`, from
 * using the failure up. Every other write passes through.
 */
function failNextWriteInto(folder: string, { made = true } = {}) {
  let taken = false;
  fs.writeFile.mockImplementation(async (...args) => {
    const [path, , options] = args;
    if (taken || dirname(String(path)) !== folder) {
      return fs.actual.writeFile(
        ...(args as Parameters<typeof fs.actual.writeFile>)
      );
    }
    taken = true;
    if (made) {
      await fs.actual.writeFile(
        String(path),
        "",
        options as Parameters<typeof fs.actual.writeFile>[2]
      );
    }
    throw Object.assign(new Error("ENOSPC: no space left on device, write"), {
      code: "ENOSPC",
    });
  });
}

describe("the write is atomic", () => {
  it("lands as a temp file in the same folder, renamed into place", async () => {
    const { c, folder } = await opened();
    fs.rename.mockClear();

    await c.mutate("questions.capture", {
      text: "Whole",
      provenance: unattached,
    });

    expect(fs.rename).toHaveBeenCalledTimes(1);
    const [temp, target] = fs.rename.mock.calls[0]!;
    expect(dirname(temp)).toBe(folder);
    expect(target).toBe(join(folder, "Whole.md"));
    expect(await readdir(folder)).toEqual(["Whole.md"]);
  });

  it("leaves no partial .md — nor a temp file — when the rename fails", async () => {
    const { c, folder } = await opened();
    fs.rename.mockRejectedValueOnce(
      Object.assign(new Error("EIO: i/o error, rename"), { code: "EIO" })
    );

    const reply = await c.mutate("questions.capture", {
      text: "Half",
      provenance: unattached,
    });

    expect(reply.error?.data.kind).toBe("writeFailed");
    expect(reply.error?.message).toContain("EIO");
    expect(await readdir(folder)).toEqual([]);
  });

  it("leaves no temp file when the write fails after making it", async () => {
    const { c, folder } = await opened();
    failNextWriteInto(folder);

    const reply = await c.mutate("questions.capture", {
      text: "Half",
      provenance: unattached,
    });

    expect(reply.error?.data.kind).toBe("writeFailed");
    expect(reply.error?.message).toContain("ENOSPC");
    expect(await readdir(folder)).toEqual([]);
  });

  // The cleanup runs for a write refused before the file was made too, where
  // there is nothing to remove: the caller is still told the disk's refusal.
  it("answers the disk's refusal, not the cleanup's, when the file was never made", async () => {
    const { c, folder } = await opened();
    failNextWriteInto(folder, { made: false });

    const reply = await c.mutate("questions.capture", {
      text: "Never made",
      provenance: unattached,
    });

    expect(reply.error?.data.kind).toBe("writeFailed");
    expect(reply.error?.message).toContain("ENOSPC");
    expect(await readdir(folder)).toEqual([]);
  });

  it("leaves a Question as it was, and no temp file, when an edit's write fails", async () => {
    const { c, folder } = await opened();
    const captured = await c.mutate<{ path: string }>("questions.capture", {
      text: "Whole",
      provenance: unattached,
    });
    const page = join(folder, "Whole.md");
    const before = await bytes(page);
    failNextWriteInto(folder);

    const reply = await c.mutate("questions.drop", {
      path: captured.result!.data.path,
    });

    expect(reply.error?.data.kind).toBe("writeFailed");
    expect(reply.error?.message).toContain("ENOSPC");
    expect(await bytes(page)).toBe(before);
    expect(await readdir(folder)).toEqual(["Whole.md"]);
  });
});
