import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { core, fingerprint, tmp } from "./test-core.js";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/captures"
);

const unattached = { context: "other" as const };

// The fixtures are byte-for-byte, and `captured` carries the local offset, so
// the clock is pinned to one zone — one with a half-hour offset, so the
// formatter is seen to do more than pick a sign.
beforeAll(() => {
  process.env["TZ"] = "Asia/Kolkata";
});
const at = new Date("2026-09-19T07:04:00+05:30");

/** Ids handed out in order, so a test knows which id a file will get. */
function ids(...list: string[]) {
  const queue = [...list];
  return () => {
    const next = queue.shift();
    if (next === undefined)
      throw new Error("test asked for more ids than seeded");
    return next;
  };
}

type Question = {
  id: string;
  path: string;
  question: string;
  status: string;
  captured: string;
  context: string;
};

async function openVault(c: Awaited<ReturnType<typeof core>>) {
  const folder = await tmp("vault");
  await c.mutate("vault.open", { path: folder });
  return folder;
}

describe("questions.capture", () => {
  it("refuses when no vault is open, typed noVault", async () => {
    const c = await core();
    const reply = await c.mutate("questions.capture", {
      text: "Does this hold for sparse inputs?",
      provenance: unattached,
    });
    expect(reply.error?.data.kind).toBe("noVault");
    expect(reply.error?.message).toMatch(/no vault/i);
  });

  it("writes questions/<text>.md in the ADR 0006 shape and returns the Question", async () => {
    const c = await core({
      now: () => at,
      newId: ids("k7m2p9q4wx", "vault0id00"),
    });
    const vault = await openVault(c);

    const reply = await c.mutate<Question>("questions.capture", {
      text: "  Does this hold for sparse inputs?  ",
      provenance: unattached,
    });

    const path = join(
      vault,
      "questions",
      "Does this hold for sparse inputs.md"
    );
    expect(reply.result?.data).toEqual({
      id: "k7m2p9q4wx",
      path,
      question: "Does this hold for sparse inputs?",
      status: "open",
      captured: "2026-09-19T07:04:00+05:30",
      context: "other",
    });
    expect(await readFile(path, "utf8")).toBe(
      await readFile(join(fixtures, "plain.md"), "utf8")
    );
  });
});

describe("the first write into a vault", () => {
  it("creates questions/ and .vitrine/vault.json — and an open before it creates nothing", async () => {
    const c = await core({ now: () => at, newId: ids("q0000id000", "vault0id00") });
    const vault = await openVault(c);
    expect(await fingerprint(vault)).toEqual([]);

    await c.mutate("questions.capture", { text: "First", provenance: unattached });

    const meta = JSON.parse(
      await readFile(join(vault, ".vitrine", "vault.json"), "utf8")
    ) as unknown;
    expect(meta).toEqual({
      id: "vault0id00",
      schema: 1,
      created: "2026-09-19T07:04:00+05:30",
    });
    expect((await fingerprint(vault)).filter((e) => e.endsWith("/"))).toEqual([
      ".vitrine/",
      "questions/",
    ]);
  });

  it("is the only write that creates anything: a second capture adds one file and nothing else", async () => {
    const c = await core({ now: () => at });
    const vault = await openVault(c);
    await c.mutate("questions.capture", { text: "First", provenance: unattached });
    const before = await fingerprint(vault);

    await c.mutate("questions.capture", { text: "Second", provenance: unattached });

    const after = await fingerprint(vault);
    expect(after.filter((e) => !before.includes(e))).toEqual([
      expect.stringMatching(/^questions\/Second\.md:/),
    ]);
  });
});
