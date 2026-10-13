import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, fixtures, vaultWith } from "./test-core.js";

afterEach(closeCores);

// What the run window's hold does when the world moves under it (#561; spec
// #556): a rename, a deletion, a vault switch and a quit inside the window. The
// hold's own rule is `run-window.test.ts`; these read it through a whole core.

/** Long enough that a step between a write and the next is well inside it, short enough for a test. */
const WINDOW_MS = 2000;
/** Past the window, the settle that comes before it, and a margin; nothing lands in this. */
const QUIET_MS = WINDOW_MS + 1500;
const TEST_MS = 20_000;

const pdf = (name: string) => readFile(join(fixtures, "pdf", name));
const source = (name: string) =>
  `---\nkind: source\nid: id-${name}\ncitekey: ${name}\npdf: ${name}.pdf\n---\n`;

async function vaultOf(name: string) {
  const vault = await vaultWith({
    [`sources/${name}.md`]: source(name),
    [`sources/pdf/${name}.pdf`]: "",
  });
  await writeFile(
    join(vault, `sources/pdf/${name}.pdf`),
    await pdf("synthetic-body.pdf")
  );
  return vault;
}

async function opened(vault: string) {
  const c = await core({ settleMs: 40, runWindowMs: WINDOW_MS });
  await c.mutate("vault.open", { path: vault });
  await c.indexed();
  const events = await c.events();
  return { c, events };
}

/** The PDF returns annotated, and the batch is known to the index: the hold is now open. */
async function returnedAndHeld(
  vault: string,
  events: Awaited<ReturnType<typeof opened>>["events"],
  name: string
) {
  await writeFile(
    join(vault, `sources/pdf/${name}.pdf`),
    await pdf("annotated.pdf")
  );
  await events.next("vaultChanged");
}

const hasBlocks = async (vault: string, name: string) =>
  /\^h\d+/.test(await readFile(join(vault, `sources/${name}.md`), "utf8"));

describe("a PDF renamed inside the run window", () => {
  it(
    "is read under its new name, and its Source's note holds the blocks",
    async () => {
      const vault = await vaultOf("a");
      const { events } = await opened(vault);
      await returnedAndHeld(vault, events, "a");
      await rename(
        join(vault, "sources/pdf/a.pdf"),
        join(vault, "sources/pdf/b.pdf")
      );
      const landed = await events.next("ingestLanded", {
        timeoutMs: 2 * QUIET_MS,
      });
      expect(landed.summary.new).toBe(6);
      const note = await readFile(join(vault, "sources/a.md"), "utf8");
      expect(note).toContain("pdf: b.pdf");
      expect(note).toMatch(/\^h\d+/);
    },
    TEST_MS
  );
});

describe("a PDF deleted inside the run window", () => {
  it(
    "is not read",
    async () => {
      const vault = await vaultOf("a");
      const { events } = await opened(vault);
      await returnedAndHeld(vault, events, "a");
      await rm(join(vault, "sources/pdf/a.pdf"));
      await expect(
        events.next("ingestLanded", { timeoutMs: QUIET_MS })
      ).rejects.toThrow();
      expect(await hasBlocks(vault, "a")).toBe(false);
    },
    TEST_MS
  );
});

describe("a vault switched inside the run window", () => {
  it(
    "reads nothing into the vault open by then, and reopening the first reads the PDF",
    async () => {
      const first = await vaultOf("a");
      const second = await vaultOf("z");
      const { c, events } = await opened(first);
      await returnedAndHeld(first, events, "a");
      await c.mutate("vault.open", { path: second });
      await expect(
        events.next("ingestLanded", { timeoutMs: QUIET_MS })
      ).rejects.toThrow();
      expect(await hasBlocks(first, "a")).toBe(false);
      expect(await hasBlocks(second, "z")).toBe(false);

      await c.mutate("vault.open", { path: first });
      const landed = await events.next("ingestLanded", {
        timeoutMs: QUIET_MS,
      });
      expect(landed.summary.new).toBe(6);
      expect(await hasBlocks(first, "a")).toBe(true);
    },
    TEST_MS
  );
});

describe("a quit inside the run window", () => {
  it(
    "reads nothing, and the next open reads what was held",
    async () => {
      const vault = await vaultOf("a");
      const { c, events } = await opened(vault);
      await returnedAndHeld(vault, events, "a");
      await c.close();
      expect(await hasBlocks(vault, "a")).toBe(false);

      const again = await core({ settleMs: 40, runWindowMs: WINDOW_MS });
      const later = await again.events();
      await again.mutate("vault.open", { path: vault });
      const landed = await later.next("ingestLanded", { timeoutMs: QUIET_MS });
      expect(landed.summary.new).toBe(6);
    },
    TEST_MS
  );
});
