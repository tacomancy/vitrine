import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fingerprint, sha256, tmp } from "./test-core.js";

// What `fingerprint` does with a file that is listed and then gone (#529; the
// cause is in its doc comment). The window is a few milliseconds wide — it
// failed one test in 2597, once, on CI — so it is reached by the one seam it
// passes through: `after` runs once a folder has been listed and before the
// walk is handed the listing. In its own file because `vi.mock` is
// module-global: no other test should walk through this `readdir`.
const listing = vi.hoisted(() => ({
  after: null as null | ((folder: string) => Promise<void>),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: async (folder: string, options: { withFileTypes: true }) => {
      const entries = await actual.readdir(folder, options);
      await listing.after?.(folder);
      return entries;
    },
  };
});

afterEach(() => {
  listing.after = null;
});

// The shape `writeAtomically` gives its temp file, and the folder the open's
// Ingest keeps its sidecars in: the name and place #529 was seen at.
const temp = ".52f278ff39d7.tmp";

async function sidecarFolder() {
  const root = await tmp("fingerprint-in-flight");
  const folder = join(root, ".vitrine", "annotations");
  await mkdir(folder, { recursive: true });
  return { root, folder };
}

describe("fingerprint beside an app write in flight", () => {
  it("is not failed by a temp file that was listed and then renamed into place", async () => {
    const { root, folder } = await sidecarFolder();
    await writeFile(join(folder, "other.json"), "{}\n");
    await writeFile(join(folder, "sidecar.json"), "before\n");
    await writeFile(join(folder, temp), "after\n");
    // The write finishes between the walk's listing and its reads.
    listing.after = async (listed) => {
      if (listed === folder) {
        await rename(join(folder, temp), join(folder, "sidecar.json"));
      }
    };

    expect(await fingerprint(root)).toEqual([
      ".vitrine/",
      ".vitrine/annotations/",
      `.vitrine/annotations/other.json:${sha256("{}\n")}`,
      `.vitrine/annotations/sidecar.json:${sha256("after\n")}`,
    ]);
  });

  // The assertions that a failed write "leaves the folder as it was" look for
  // exactly this, so a walk that forgave every temp file by name would blind
  // them: only a file that is gone when it is read is not an entry.
  it("still reports a temp file that is left behind", async () => {
    const { root, folder } = await sidecarFolder();
    await writeFile(join(folder, temp), "half\n");

    expect(await fingerprint(root)).toContain(
      `.vitrine/annotations/${temp}:${sha256("half\n")}`
    );
  });

  // Root reads a 000 file anyway, so it is skipped there, as in the other
  // tests that deny a read by mode (`scout-file.test.ts`).
  it.skipIf(process.getuid?.() === 0)(
    "still fails on a file that is there and cannot be read",
    async () => {
      const root = await tmp("fingerprint-unreadable");
      const locked = join(root, "locked.md");
      await writeFile(locked, "closed\n");
      await chmod(locked, 0o000);
      try {
        await expect(fingerprint(root)).rejects.toThrow(/EACCES/);
      } finally {
        await chmod(locked, 0o644);
      }
    }
  );
});
