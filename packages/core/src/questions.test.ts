import { chmod, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fileName, newId } from "./questions.js";
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
    const c = await core({
      now: () => at,
      newId: ids("q0000id000", "vault0id00"),
    });
    const vault = await openVault(c);
    expect(await fingerprint(vault)).toEqual([]);

    await c.mutate("questions.capture", {
      text: "First",
      provenance: unattached,
    });

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
    await c.mutate("questions.capture", {
      text: "First",
      provenance: unattached,
    });
    const before = await fingerprint(vault);

    await c.mutate("questions.capture", {
      text: "Second",
      provenance: unattached,
    });

    const after = await fingerprint(vault);
    expect(after.filter((e) => !before.includes(e))).toEqual([
      expect.stringMatching(/^questions\/Second\.md:/),
    ]);
  });
});

describe("file names", () => {
  it("gives a second capture of the same text ` (2)` rather than overwriting the first", async () => {
    const c = await core({
      now: () => at,
      newId: ids("k7m2p9q4wx", "vault0id00", "b3n8r5t2yz"),
    });
    const vault = await openVault(c);
    const text = "Does this hold for sparse inputs?";
    await c.mutate("questions.capture", { text, provenance: unattached });
    const second = await c.mutate<Question>("questions.capture", {
      text,
      provenance: unattached,
    });

    const path = join(
      vault,
      "questions",
      "Does this hold for sparse inputs (2).md"
    );
    expect(second.result?.data.path).toBe(path);
    expect(await readFile(path, "utf8")).toBe(
      await readFile(join(fixtures, "collision.md"), "utf8")
    );
    expect(
      await readFile(
        join(vault, "questions", "Does this hold for sparse inputs.md"),
        "utf8"
      )
    ).toBe(await readFile(join(fixtures, "plain.md"), "utf8"));
  });

  it("falls back to <id>.md when nothing of the text survives stripping", async () => {
    const c = await core({
      now: () => at,
      newId: ids("c6d4f8h2jk", "vault0id00"),
    });
    const vault = await openVault(c);
    const reply = await c.mutate<Question>("questions.capture", {
      text: "???",
      provenance: unattached,
    });

    const path = join(vault, "questions", "c6d4f8h2jk.md");
    expect(reply.result?.data.path).toBe(path);
    expect(await readFile(path, "utf8")).toBe(
      await readFile(join(fixtures, "stripped-to-nothing.md"), "utf8")
    );
  });
});

describe("fileName (pure)", () => {
  const id = "c6d4f8h2jk";
  const a = (n: number) => "a".repeat(n);
  it.each([
    [
      "a trailing ? goes",
      "Does this hold for sparse inputs?",
      "Does this hold for sparse inputs",
    ],
    ["Obsidian-forbidden characters go", 'a*b"c\\d/e<f>g:h|i?j', "abcdefghij"],
    ["link-breaking characters go", "#tag ^block [[link]]", "tag block link"],
    [
      "whitespace collapses and trims",
      "  many   spaces\t\tand\nnewlines  ",
      "many spaces and newlines",
    ],
    [
      "a leading dot goes, or the file would be a dot-entry the vault scan skips",
      "...why",
      "why",
    ],
    ["80 characters pass untouched", `${a(77)} bc`, `${a(77)} bc`],
    ["81 characters cut back to the last word boundary", `${a(78)} bc`, a(78)],
    ["a word ending exactly at 80 is kept", `${a(80)} b`, a(80)],
    ["one unbroken word is cut hard at 80", a(100), a(80)],
    ["nothing surviving yields the id", "???", id],
    ["empty yields the id", "", id],
  ])("%s", (_, text, expected) => {
    expect(fileName(text, id)).toBe(expected);
  });
});

describe("newId (pure)", () => {
  it("is 10 characters of lowercase RFC 4648 base32", () => {
    for (let i = 0; i < 200; i++) {
      expect(newId()).toMatch(/^[a-z2-7]{10}$/);
    }
  });

  it("differs between calls", () => {
    expect(newId()).not.toBe(newId());
  });
});

describe("a write that fails", () => {
  const restore: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const fn of restore.splice(0)) await fn();
  });

  it("is typed writeFailed, carries the reason, and leaves the vault as it was", async () => {
    const c = await core();
    const vault = await openVault(c);
    const folder = join(vault, "questions");
    await mkdir(folder);
    await chmod(folder, 0o500);
    restore.push(() => chmod(folder, 0o700));
    const before = await fingerprint(vault);

    const reply = await c.mutate("questions.capture", {
      text: "Will this land?",
      provenance: unattached,
    });

    expect(reply.error?.data.kind).toBe("writeFailed");
    expect(reply.error?.message).toMatch(/permission denied|EACCES/);
    expect(reply.error?.message).toContain(folder);
    expect(await fingerprint(vault)).toEqual(before);
  });
});
