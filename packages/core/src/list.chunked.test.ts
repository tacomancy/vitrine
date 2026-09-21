import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Listing } from "./list.js";
import { core, tmp } from "./test-core.js";

// The bytes every `open()`ed handle and every `readFile` has read, so a test
// can assert on how much of the vault the Inbox looked at — the one thing
// the reply cannot show. In its own file because `vi.mock` is
// module-global: the other list tests should run against the real `fs`.
const bytesRead = { total: 0 };
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    readFile: async (...args: Parameters<typeof fs.readFile>) => {
      const result = await fs.readFile(...args);
      bytesRead.total += Buffer.byteLength(result);
      return result;
    },
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

describe("questions.list is a query over the index", () => {
  it("reads no file at all: the one read of a heavy file was the index's, at open (ADR 0014 decision 3)", async () => {
    const vault = await tmp("large-body");
    // Paragraphs, not one long paragraph: `outline()` is quadratic in a
    // paragraph's length today (flagged separately), and the point here is
    // the byte count, not the parse — a few thousand is heavy enough and
    // still fits CI's clock.
    const body = "The body, read once by the indexer.\n\n".repeat(5_000);
    const file = `---\nkind: question\nquestion: Heavy\ncaptured: 2026-01-01T00:00:00Z\n---\n${body}`;
    await writeFile(join(vault, "Heavy.md"), file);
    const c = await core();
    bytesRead.total = 0;
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    expect(bytesRead.total).toBeGreaterThanOrEqual(Buffer.byteLength(file));

    bytesRead.total = 0;
    const reply = await c.query<Listing>("questions.list");
    expect(reply.result?.data.questions.map((q) => q.question)).toEqual([
      "Heavy",
    ]);
    expect(bytesRead.total).toBe(0);
  });
});
