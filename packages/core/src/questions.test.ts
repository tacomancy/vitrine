import { chmod, mkdir, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { core, fixtures, tmp } from "./testing.js";

type Question = {
  id?: string;
  path: string;
  question: string;
  status: "open" | "promoted" | "answered" | "abandoned";
  captured: string;
  context: string;
  from?: string;
  page?: number;
  annotation?: string;
};
type Listing = {
  questions: Question[];
  partial: Array<{ path: string; name: string; mtime: string }>;
  unreadable: Array<{ path: string; reason: string }>;
};

/** A core with the given folder open, ready to list. */
async function opened(vault: string) {
  const c = await core();
  const reply = await c.mutate("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  return {
    list: async (input?: { order: "newest" | "oldest" }) => {
      const reply = await c.query<Listing>("questions.list", input);
      expect(reply.error).toBeUndefined();
      return reply.result?.data as Listing;
    },
  };
}

function questionFile(text: string, captured: string, extra = "") {
  return `---\nkind: question\nquestion: ${text}\nstatus: open\ncaptured: ${captured}\ncontext: other\n${extra}---\n`;
}

describe("questions.list", () => {
  it("is empty for an empty vault", async () => {
    const c = await opened(await tmp("empty"));
    expect(await c.list()).toEqual({
      questions: [],
      partial: [],
      unreadable: [],
    });
  });

  it("finds the Question Obsidian wrote outside questions/, and nothing else", async () => {
    const vault = join(fixtures, "obsidian-vault");
    const c = await opened(vault);
    const listing = await c.list();
    expect(listing.partial).toEqual([]);
    expect(listing.unreadable).toEqual([]);
    expect(listing.questions).toEqual([
      {
        id: "k7m2p9q4wx",
        path: join(
          vault,
          "reading/Does slow-wave density predict recall gain.md"
        ),
        question:
          "Does slow-wave density predict recall gain, or is it a proxy for encoding strength at learning?",
        status: "open",
        captured: "2026-08-14T09:12:00+01:00",
        context: "other",
      },
    ]);
  });

  it("does not list a file whose kind is note, or one with no frontmatter", async () => {
    const vault = await tmp("notes");
    await writeFile(
      join(vault, "A note.md"),
      "---\nkind: note\nquestion: looks like one\ncaptured: 2026-01-01T00:00:00Z\n---\n"
    );
    await writeFile(join(vault, "Plain.md"), "# No frontmatter at all\n");
    await writeFile(join(vault, "Tagged.md"), "---\ntags:\n  - x\n---\nbody\n");
    const c = await opened(vault);
    expect(await c.list()).toEqual({
      questions: [],
      partial: [],
      unreadable: [],
    });
  });

  it("orders by captured, newest first by default and oldest on request", async () => {
    const vault = await tmp("ordered");
    await mkdir(join(vault, "questions"));
    await writeFile(
      join(vault, "questions/Middle.md"),
      questionFile("Middle", "2026-05-01T12:00:00+02:00")
    );
    await writeFile(
      join(vault, "questions/Newest.md"),
      questionFile("Newest", "2026-09-01T08:00:00+02:00")
    );
    await writeFile(
      join(vault, "questions/Oldest.md"),
      questionFile("Oldest", "2025-12-24T23:59:00-05:00")
    );
    const c = await opened(vault);
    const texts = (l: Listing) => l.questions.map((q) => q.question);
    expect(texts(await c.list())).toEqual(["Newest", "Middle", "Oldest"]);
    expect(texts(await c.list({ order: "newest" }))).toEqual([
      "Newest",
      "Middle",
      "Oldest",
    ]);
    expect(texts(await c.list({ order: "oldest" }))).toEqual([
      "Oldest",
      "Middle",
      "Newest",
    ]);
  });

  it("lists a kind: question file missing question or captured as partial, by name and mtime", async () => {
    const vault = await tmp("partial");
    const path = join(vault, "Half a thought.md");
    await writeFile(path, "---\nkind: question\nstatus: open\n---\n");
    const stamp = new Date("2026-03-03T10:00:00Z");
    await utimes(path, stamp, stamp);
    const c = await opened(vault);
    const listing = await c.list();
    expect(listing.questions).toEqual([]);
    expect(listing.partial).toEqual([
      { path, name: "Half a thought", mtime: stamp.toISOString() },
    ]);
  });

  it("counts a file it cannot read, and one whose frontmatter does not parse, with reasons", async () => {
    const vault = await tmp("broken");
    const garbled = join(vault, "Garbled.md");
    await writeFile(garbled, "---\nkind: question\nquestion: [unclosed\n---\n");
    const locked = join(vault, "Locked.md");
    await writeFile(locked, questionFile("Locked", "2026-01-01T00:00:00Z"));
    await chmod(locked, 0o000);
    restore.push(() => chmod(locked, 0o644));
    const good = join(vault, "Good.md");
    await writeFile(good, questionFile("Good", "2026-01-02T00:00:00Z"));

    const c = await opened(vault);
    const listing = await c.list();
    expect(listing.questions.map((q) => q.question)).toEqual(["Good"]);
    expect(listing.partial).toEqual([]);
    expect(listing.unreadable.map((u) => u.path).sort()).toEqual([
      garbled,
      locked,
    ]);
    for (const u of listing.unreadable) expect(u.reason).not.toBe("");
  });

  it("skips every dot-entry and never follows a symlink", async () => {
    const vault = await tmp("dots");
    const outside = await tmp("outside");
    await writeFile(
      join(outside, "Elsewhere.md"),
      questionFile("Elsewhere", "2026-01-01T00:00:00Z")
    );
    await mkdir(join(vault, ".obsidian"));
    await writeFile(
      join(vault, ".obsidian/Hidden.md"),
      questionFile("Hidden", "2026-01-01T00:00:00Z")
    );
    await writeFile(
      join(vault, ".Dotfile.md"),
      questionFile("Dotfile", "2026-01-01T00:00:00Z")
    );
    await symlink(outside, join(vault, "linked-folder"));
    await symlink(join(outside, "Elsewhere.md"), join(vault, "linked.md"));
    await mkdir(join(vault, "deep/er"), { recursive: true });
    await writeFile(
      join(vault, "deep/er/Nested.md"),
      questionFile("Nested", "2026-01-01T00:00:00Z")
    );
    const c = await opened(vault);
    const listing = await c.list();
    expect(listing.questions.map((q) => q.question)).toEqual(["Nested"]);
    expect(listing.unreadable).toEqual([]);
  });

  it("reads the Provenance keys that are present and no others", async () => {
    const vault = await tmp("provenance");
    await writeFile(
      join(vault, "From a paper.md"),
      '---\nid: abcdefghij\nkind: question\nquestion: From a paper\nstatus: promoted\ncaptured: 2026-01-01T00:00:00Z\nfrom: "[[klinzing2019]]"\npage: 7\nannotation: h12\ncontext: reading\npromoted_to: "[[From a paper (RQ)]]"\n---\nBody text that is never read.\n'
    );
    const c = await opened(vault);
    expect((await c.list()).questions).toEqual([
      {
        id: "abcdefghij",
        path: join(vault, "From a paper.md"),
        question: "From a paper",
        status: "promoted",
        captured: "2026-01-01T00:00:00Z",
        context: "reading",
        from: "[[klinzing2019]]",
        page: 7,
        annotation: "h12",
      },
    ]);
  });

  it("refuses when no vault is open", async () => {
    const c = await core();
    const reply = await c.query<Listing>("questions.list");
    expect(reply.error?.message).toMatch(/no vault/i);
  });
});

const restore: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of restore.splice(0)) await fn();
});
