import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeCores, core, heldEvents, tmp } from "./test-core.js";

// A path the watcher has heard of and not yet stat-ted (#554), at the harness
// seam: a real `fs.watch` on a temp vault whose events are the test's to hand
// over, and a `stat` whose answer is slow to come back. In its own file
// because `vi.mock` is module-global and the other watcher tests should run
// against the real `fs`. A real stat takes about a millisecond, which is why
// the window it opens is only ever hit by a loop that has frozen; here it is
// held open on purpose.

afterEach(closeCores);

/** The answer for the next stat of a path ending in `suffix` waits for `gate`. */
const slow = {
  suffix: null as string | null,
  gate: Promise.resolve(),
};
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    stat: async (...args: Parameters<typeof fs.stat>) => {
      const result = await fs.stat(...args);
      if (slow.suffix !== null && String(args[0]).endsWith(slow.suffix)) {
        // Only the first: the watcher's second stat, and the index's, are not slow.
        slow.suffix = null;
        await slow.gate;
      }
      return result;
    },
  };
});

/** Long enough that jitter cannot close a Batch early; short enough to run in a blink. */
const SETTLE_MS = 200;

describe("a path heard of and not yet stat-ted is pending (#554)", () => {
  it("a Batch waits for a path whose first stat is slow to come back, and names it", async () => {
    const vault = await tmp("slow-stat");
    await mkdir(join(vault, "notes"));
    await writeFile(join(vault, "notes", "Seed.md"), "seed\n");
    const os = heldEvents(["notes/A.md", "notes/B.md", "notes/C.md"]);
    const c = await core({ settleMs: SETTLE_MS, watch: os.watch });
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    const stream = await c.events();
    os.hold();
    for (const file of ["A", "B", "C"]) {
      await writeFile(join(vault, "notes", `${file}.md`), `${file}\n`);
    }
    const hear = await os.named();

    // C is heard just before the first two fall due; its stat does not come
    // back until after they have, so at the moment the settle timer decides it
    // is in neither map of a watcher that files a path once it has been
    // stat-ted. Released only then: a Batch that closed on the first two has
    // closed by now. Both timers count from the first callback.
    let release: () => void = () => undefined;
    slow.gate = new Promise<void>((resolve) => (release = resolve));
    slow.suffix = "notes/C.md";
    hear(["notes/A.md", "notes/B.md"]);
    setTimeout(() => hear(["notes/C.md"]), SETTLE_MS - 30);
    setTimeout(release, SETTLE_MS + 60);

    expect(await stream.next("vaultChanged")).toEqual({
      type: "vaultChanged",
      changed: ["notes/A.md", "notes/B.md", "notes/C.md"],
      removed: [],
      renamed: [],
    });
    // Said back: C's stat was the one held, so the shape occurred and this is
    // not a Batch that merely did not need to wait.
    expect(slow.suffix).toBeNull();
    stream.close();
  });
});
