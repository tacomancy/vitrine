import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Listing } from "./list.js";
import { core, tmp } from "./test-core.js";

// The bytes every `open()`ed handle has read, so a test can assert on how
// much of a file the Inbox looked at — the one thing the reply cannot show.
// In its own file because `vi.mock` is module-global: the other list tests
// should run against the real `open`.
const bytesRead = { total: 0 };
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      const read = handle.read.bind(handle);
      handle.read = (async (...readArgs: unknown[]) => {
        const result = await (
          read as (...a: unknown[]) => Promise<{ bytesRead: number }>
        )(...readArgs);
        bytesRead.total += result.bytesRead;
        return result;
      }) as typeof handle.read;
      return handle;
    },
  };
});

describe("questions.list reads to the closing fence and no further", () => {
  it("never loads the body of a file with a large one (ADR 0009 decision 1)", async () => {
    const vault = await tmp("large-body");
    const body = "The body, never read.\n".repeat(50_000);
    await writeFile(
      join(vault, "Heavy.md"),
      `---\nkind: question\nquestion: Heavy\ncaptured: 2026-01-01T00:00:00Z\n---\n${body}`
    );
    const c = await core();
    await c.mutate("vault.open", { path: vault });
    bytesRead.total = 0;
    const reply = await c.query<Listing>("questions.list");
    expect(reply.result?.data.questions.map((q) => q.question)).toEqual([
      "Heavy",
    ]);
    // The block fits in one 4 KiB chunk; a second read would mean the
    // reader went looking past the closing fence.
    expect(bytesRead.total).toBeLessThanOrEqual(4096);
  });
});
