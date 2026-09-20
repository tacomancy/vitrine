import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { core, tmp } from "./test-core.js";

// The one place a test reaches below the router: `rename` is the boundary
// between a whole file and a half one, and only a failure there shows
// whether the write was atomic.
const fs = vi.hoisted(() => ({
  rename: vi.fn<(a: string, b: string) => Promise<void>>(),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  fs.rename.mockImplementation(actual.rename);
  return { ...actual, rename: fs.rename };
});

const unattached = { context: "other" as const };

describe("the write is atomic", () => {
  it("lands as a temp file in the same folder, renamed into place", async () => {
    const c = await core();
    const vault = await tmp("vault");
    await c.mutate("vault.open", { path: vault });
    fs.rename.mockClear();

    await c.mutate("questions.capture", {
      text: "Whole",
      provenance: unattached,
    });

    const folder = join(vault, "questions");
    expect(fs.rename).toHaveBeenCalledTimes(1);
    const [temp, target] = fs.rename.mock.calls[0]!;
    expect(dirname(temp)).toBe(folder);
    expect(target).toBe(join(folder, "Whole.md"));
    expect(await readdir(folder)).toEqual(["Whole.md"]);
  });

  it("leaves no partial .md — nor a temp file — when the rename fails", async () => {
    const c = await core();
    const vault = await tmp("vault");
    await c.mutate("vault.open", { path: vault });
    fs.rename.mockRejectedValueOnce(
      Object.assign(new Error("EIO: i/o error, rename"), { code: "EIO" })
    );

    const reply = await c.mutate("questions.capture", {
      text: "Half",
      provenance: unattached,
    });

    expect(reply.error?.data.kind).toBe("writeFailed");
    expect(reply.error?.message).toContain("EIO");
    expect(await readdir(join(vault, "questions"))).toEqual([]);
  });
});
