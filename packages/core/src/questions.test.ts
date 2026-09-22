import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fileName, randomId } from "./questions.js";
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

describe("a capture from a Research Question's page", () => {
  const page = "questions/Does slow-wave density predict recall gain (RQ).md";
  const PAGE =
    '---\nid: rq7m2p9q4w\nkind: research-question\nquestion: "Does slow-wave density predict recall gain?"\nstatus: open\ncontext: other\n---\n\n## Working answer\n\n## Supporting sources\n\n## Opposing sources\n\n## Related questions\n\n- [[What counts as a reactivation event]] — shares 2 sources\n\n## Open threads\n\n## Position history\n';

  it("writes `from` and `context: pursuing` on the Question and appends its link under the page's related section, in one call", async () => {
    const c = await core({
      now: () => at,
      newId: ids("k7m2p9q4wx", "vault0id00"),
    });
    const vault = await openVault(c);
    await mkdir(join(vault, "questions"), { recursive: true });
    await writeFile(join(vault, page), PAGE);
    await c.indexed();

    const reply = await c.mutate<Question & { from?: string }>(
      "questions.capture",
      {
        text: "Does the effect survive a nap?",
        provenance: { context: "pursuing", researchQuestion: page },
      }
    );

    expect(reply.error).toBeUndefined();
    expect(reply.result?.data).toEqual({
      id: "k7m2p9q4wx",
      path: join(vault, "questions", "Does the effect survive a nap.md"),
      question: "Does the effect survive a nap?",
      status: "open",
      captured: "2026-09-19T07:04:00+05:30",
      from: "[[Does slow-wave density predict recall gain (RQ)]]",
      context: "pursuing",
    });
    expect(
      await readFile(
        join(vault, "questions", "Does the effect survive a nap.md"),
        "utf8"
      )
    ).toBe(await readFile(join(fixtures, "pursuing.md"), "utf8"));
    // Appended to the section, joining the list already there; nothing else moved.
    expect(await readFile(join(vault, page), "utf8")).toBe(
      PAGE.replace(
        "shares 2 sources\n",
        "shares 2 sources\n- [[Does the effect survive a nap]]\n"
      )
    );
  });

  it("is whole or not at all: a page that cannot take the link leaves no Question behind", async () => {
    const c = await core({ now: () => at });
    const vault = await openVault(c);
    // The page is a Question, not a Research Question: nothing to append to.
    await mkdir(join(vault, "questions"), { recursive: true });
    await writeFile(
      join(vault, page),
      '---\nkind: question\nquestion: "q"\ncaptured: 2026-08-01T09:00:00+01:00\n---\n'
    );
    await c.indexed();
    const before = await fingerprint(vault);

    const reply = await c.mutate("questions.capture", {
      text: "Orphaned?",
      provenance: { context: "pursuing", researchQuestion: page },
    });

    expect(reply.error?.data.kind).toBe("writeFailed");
    expect(reply.error?.message).toContain(
      `${page} is not a Research Question`
    );
    // The vault's marker is the first write's and stays; no Question does.
    const marker = /^\.vitrine\/vault\.json:/;
    expect((await fingerprint(vault)).filter((e) => !marker.test(e))).toEqual(
      before
    );
  });

  it("refuses a `researchQuestion` on an Unattached capture, and a pursuing capture without one, as input errors", async () => {
    const c = await core();
    const vault = await openVault(c);
    for (const provenance of [
      { context: "other", researchQuestion: page },
      { context: "pursuing" },
    ]) {
      const reply = await c.mutate("questions.capture", {
        text: "x",
        provenance,
      });
      expect(reply.error).toBeDefined();
      expect(reply.error?.data.kind).toBeUndefined();
    }
    expect(await fingerprint(vault)).toEqual([".vitrine/"]);
  });
});

describe("the first write into a vault", () => {
  it("creates questions/ and .vitrine/vault.json — and an open before it creates only the index's folder", async () => {
    const c = await core({
      now: () => at,
      newId: ids("q0000id000", "vault0id00"),
    });
    const vault = await openVault(c);
    // `.vitrine/` holds the index from the open on (ADR 0014); the marker
    // that makes the folder a Vitrine vault is still the first capture's.
    expect(await fingerprint(vault)).toEqual([".vitrine/"]);

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

describe("randomId (pure)", () => {
  it("is 10 characters of lowercase RFC 4648 base32", () => {
    for (let i = 0; i < 200; i++) {
      expect(randomId()).toMatch(/^[a-z2-7]{10}$/);
    }
  });

  it("differs between calls", () => {
    expect(randomId()).not.toBe(randomId());
  });
});

const restore: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of restore.splice(0)) await fn();
});

describe("a write that fails", () => {
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

describe("the capture input", () => {
  it.each([
    ["empty text", { text: "", provenance: unattached }],
    ["whitespace-only text", { text: " \t\n ", provenance: unattached }],
    [
      "a context this slice does not have",
      { text: "x", provenance: { context: "reading" } },
    ],
    [
      "a `from` on an Unattached capture",
      { text: "x", provenance: { context: "other", from: "somewhere" } },
    ],
    ["no provenance at all", { text: "x" }],
  ])("rejects %s as an input error, writing nothing", async (_, input) => {
    const c = await core();
    const vault = await openVault(c);

    const reply = await c.mutate("questions.capture", input);

    expect(reply.error).toBeDefined();
    expect(reply.error?.data.kind).toBeUndefined();
    expect(await fingerprint(vault)).toEqual([".vitrine/"]);
  });
});

describe("a capture happens whole or not at all", () => {
  it("removes the Question again when the vault marker cannot follow it", async () => {
    const c = await core();
    const vault = await openVault(c);
    // The index's folder exists from the open; the marker cannot be written
    // into it.
    await chmod(join(vault, ".vitrine"), 0o500);
    restore.push(() => chmod(join(vault, ".vitrine"), 0o700));
    const before = await fingerprint(vault);

    const reply = await c.mutate("questions.capture", {
      text: "Whole or nothing",
      provenance: unattached,
    });

    expect(reply.error?.data.kind).toBe("writeFailed");
    expect(reply.error?.message).toContain(".vitrine");
    expect(await readdir(join(vault, "questions")).catch(() => [])).toEqual([]);
    expect((await fingerprint(vault)).filter((e) => !e.endsWith("/"))).toEqual(
      before.filter((e) => !e.endsWith("/"))
    );
  });

  it("gives two captures of one text arriving together two files, not one", async () => {
    const c = await core();
    const vault = await openVault(c);
    const text = "Twice at once";

    const replies = await Promise.all([
      c.mutate<Question>("questions.capture", { text, provenance: unattached }),
      c.mutate<Question>("questions.capture", { text, provenance: unattached }),
    ]);

    const paths = replies.map((r) => r.result?.data.path).sort();
    expect(paths).toEqual([
      join(vault, "questions", "Twice at once (2).md"),
      join(vault, "questions", "Twice at once.md"),
    ]);
  });
});

describe("a capture lands in the list", () => {
  it("is the first Question under newest, captured within the test's clock window", async () => {
    const c = await core();
    const vault = await tmp("vault");
    await mkdir(join(vault, "questions"));
    await writeFile(
      join(vault, "questions", "Earlier.md"),
      "---\nkind: question\nquestion: Earlier\nstatus: open\ncaptured: 2026-01-01T00:00:00+00:00\ncontext: other\n---\n"
    );
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
    const before = Date.now();

    const captured = await c.mutate<Question>("questions.capture", {
      text: "Does this hold for sparse inputs?",
      provenance: unattached,
    });
    const after = Date.now();

    type Listing = { questions: Question[] };
    const newest = await c.query<Listing>("questions.list", {
      order: "newest",
    });
    const oldest = await c.query<Listing>("questions.list", {
      order: "oldest",
    });
    const texts = (r: typeof newest) =>
      r.result?.data.questions.map((q) => q.question);
    expect(texts(newest)).toEqual([
      "Does this hold for sparse inputs?",
      "Earlier",
    ]);
    expect(texts(oldest)).toEqual([
      "Earlier",
      "Does this hold for sparse inputs?",
    ]);

    const landed = newest.result?.data.questions[0];
    expect(landed?.id).toBe(captured.result?.data.id);
    expect(landed?.path).toBe(captured.result?.data.path);
    // `captured` is written at seconds precision, so the window is widened to
    // the second on either side.
    const stamp = Date.parse(landed?.captured ?? "");
    expect(stamp).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(stamp).toBeLessThanOrEqual(Math.ceil(after / 1000) * 1000);
  });
});
