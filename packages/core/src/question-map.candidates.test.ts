import { mkdir, readFile, rename, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CandidateQuestion } from "./question-map.js";
import { closeCores, core, vaultWith } from "./test-core.js";

afterEach(closeCores);

// Candidate links (#487; ADR 0041 decisions 9–10), driven through the router
// on a temp vault, the way the review panel reads and writes them.

const question = (
  name: string,
  {
    tags = [],
    captured = "2026-09-01T10:00:00Z",
    related = [],
  }: { tags?: string[]; captured?: string; related?: string[] } = {}
) => `---
kind: question
id: q-${name}
question: "${name}?"
status: open
captured: ${captured}
context: other
tags: [${tags.join(", ")}]
${related.length === 0 ? "" : `related:\n${related.map((r) => `  - "${r}"`).join("\n")}\n`}---
`;

const paper = (name: string, tags: string[], kind = "source") => `---
kind: ${kind}
citekey: ${name}
title: ${name}
tags: [${tags.join(", ")}]
---
`;

/** `mtimes` are days after a fixed epoch, so recency is the test's to say. */
async function review(
  files: Record<string, string>,
  mtimes: Record<string, number> = {},
  settleMs?: number
) {
  const vault = await vaultWith(files);
  for (const [path, day] of Object.entries(mtimes)) {
    const when = new Date(Date.UTC(2026, 0, 1 + day));
    await utimes(join(vault, path), when, when);
  }
  const c = await core(settleMs === undefined ? {} : { settleMs });
  expect((await c.mutate("vault.open", { path: vault })).error).toBeUndefined();
  await c.indexed();
  const read = async () => {
    const reply = await c.query<CandidateQuestion[]>("questionMap.candidates");
    expect(reply.error).toBeUndefined();
    return reply.result!.data;
  };
  return { vault, c, read };
}

const papersOf = (q: CandidateQuestion) => q.candidates.map((p) => p.path);

describe("questionMap.candidates", () => {
  it("offers a paper that shares at least one Tag, and none that shares none", async () => {
    const { read } = await review({
      "q/Q.md": question("Q", { tags: ["sleep", "memory"] }),
      "s/one.md": paper("one", ["sleep"]),
      "s/two.md": paper("two", ["ml"]),
      "s/stub.md": paper("stub", ["memory"], "source-stub"),
    });
    const [q] = await read();
    expect(papersOf(q!).sort()).toEqual(["s/one.md", "s/stub.md"]);
    expect(q!.candidates.find((p) => p.path === "s/one.md")!.shared).toEqual([
      "sleep",
    ]);
  });

  it("ranks by shared Tags, then the paper's recency", async () => {
    const { read } = await review(
      {
        "q/Q.md": question("Q", { tags: ["a", "b", "c"] }),
        "s/old-three.md": paper("old-three", ["a", "b", "c"]),
        "s/new-one.md": paper("new-one", ["a"]),
        "s/old-one.md": paper("old-one", ["b"]),
        "s/new-two.md": paper("new-two", ["a", "b"]),
      },
      {
        "s/old-three.md": 1,
        "s/old-one.md": 2,
        "s/new-one.md": 9,
        "s/new-two.md": 8,
      }
    );
    expect(papersOf((await read())[0]!)).toEqual([
      "s/old-three.md",
      "s/new-two.md",
      "s/new-one.md",
      "s/old-one.md",
    ]);
  });

  it("never offers a paper already linked, and an anchored Question has no candidates", async () => {
    const { read } = await review({
      "q/Anchored.md": question("Anchored", {
        tags: ["a"],
        related: ["[[one]]"],
      }),
      "s/one.md": paper("one", ["a"]),
    });
    expect(await read()).toEqual([]);
  });

  it("lists Questions with the most candidates first, then newest, and omits those with none", async () => {
    const { read } = await review({
      "q/Few.md": question("Few", {
        tags: ["a"],
        captured: "2026-09-05T10:00:00Z",
      }),
      "q/Many.md": question("Many", {
        tags: ["b"],
        captured: "2026-09-01T10:00:00Z",
      }),
      "q/Tied older.md": question("Tied older", {
        tags: ["a"],
        captured: "2026-09-02T10:00:00Z",
      }),
      "q/None.md": question("None", { tags: ["zzz"] }),
      "s/x.md": paper("x", ["a"]),
      "s/y.md": paper("y", ["b"]),
      "s/z.md": paper("z", ["b"]),
    });
    expect((await read()).map((q) => q.path)).toEqual([
      "q/Many.md",
      "q/Few.md",
      "q/Tied older.md",
    ]);
  });
});

describe("accepting a candidate", () => {
  it("writes only a related entry, through questions.link, and the next read has the Question anchored", async () => {
    const { c, vault, read } = await review({
      "q/Q.md": question("Q", { tags: ["a"] }),
      "s/one.md": paper("one", ["a"]),
    });
    const reply = await c.mutate("questions.link", {
      path: "q/Q.md",
      target: "s/one.md",
    });
    expect(reply.error).toBeUndefined();
    const written = await readFile(join(vault, "q/Q.md"), "utf8");
    expect(written).toMatch(/related:\n\s+- "?\[\[one\]\]"?/);
    expect(written).not.toMatch(/supporting|opposing/i);
    await c.indexed();
    expect(await read()).toEqual([]);
  });

  it("leaves the file untouched for an already-linked paper", async () => {
    const { c, vault } = await review({
      "q/Q.md": question("Q", { tags: ["a"], related: ["[[one]]"] }),
      "s/one.md": paper("one", ["a"]),
    });
    const before = await readFile(join(vault, "q/Q.md"), "utf8");
    await c.mutate("questions.link", { path: "q/Q.md", target: "s/one.md" });
    expect(await readFile(join(vault, "q/Q.md"), "utf8")).toBe(before);
  });
});

describe("rejecting a candidate", () => {
  const files = {
    "q/Q.md": question("Q", { tags: ["a"] }),
    "s/one.md": paper("one", ["a"]),
    "s/two.md": paper("two", ["a"]),
  };
  const rejectionOf = async (
    read: () => Promise<CandidateQuestion[]>,
    path: string
  ) => (await read())[0]!.candidates.find((p) => p.path === path)!.rejection;
  const dismissalsOf = async (vault: string) =>
    JSON.parse(
      await readFile(join(vault, ".vitrine/dismissals.json"), "utf8")
    ) as Record<string, Record<string, string>>;

  it("records one dismissal per pair under the Question's id, and leaves its other candidates offered", async () => {
    const { c, vault, read } = await review(files);
    const rejection = await rejectionOf(read, "s/one.md");
    expect(rejection.subject).toBe("q-Q");
    expect(rejection.kind).toMatch(/^inferred-link:/);
    expect(
      (await c.mutate("looseEnds.dismiss", rejection)).error
    ).toBeUndefined();
    expect(Object.keys((await dismissalsOf(vault))["q-Q"]!)).toEqual([
      rejection.kind,
    ]);
    expect(papersOf((await read())[0]!)).toEqual(["s/two.md"]);
  });

  it("never offers a rejected pair again, and a rejected Question's last candidate removes the Question", async () => {
    const { c, read } = await review({
      "q/Q.md": files["q/Q.md"],
      "s/one.md": files["s/one.md"],
    });
    await c.mutate("looseEnds.dismiss", await rejectionOf(read, "s/one.md"));
    expect(await read()).toEqual([]);
  });

  it("undo removes exactly that pair", async () => {
    const { c, vault, read } = await review(files);
    const one = await rejectionOf(read, "s/one.md");
    const two = await rejectionOf(read, "s/two.md");
    await c.mutate("looseEnds.dismiss", one);
    await c.mutate("looseEnds.dismiss", two);
    await c.mutate("looseEnds.undismiss", one);
    expect(Object.keys((await dismissalsOf(vault))["q-Q"]!)).toEqual([
      two.kind,
    ]);
    expect(papersOf((await read())[0]!)).toEqual(["s/one.md"]);
  });

  it("is refused, saying so, when the dismissals file does not parse", async () => {
    const { c, vault, read } = await review(files);
    await mkdir(join(vault, ".vitrine"), { recursive: true });
    await writeFile(join(vault, ".vitrine/dismissals.json"), "{ not json");
    const reply = await c.mutate(
      "looseEnds.dismiss",
      await rejectionOf(read, "s/one.md")
    );
    expect(reply.error?.message).toMatch(/dismissals\.json could not be read/);
    expect(
      await readFile(join(vault, ".vitrine/dismissals.json"), "utf8")
    ).toBe("{ not json");
  });

  it("survives the Question being renamed", async () => {
    const { c, vault, read } = await review(files, {}, 40);
    await c.mutate("looseEnds.dismiss", await rejectionOf(read, "s/one.md"));
    const events = await c.events();
    await rename(join(vault, "q/Q.md"), join(vault, "q/Renamed.md"));
    await events.next("vaultChanged");
    events.close();
    const [q] = await read();
    expect(q!.path).toBe("q/Renamed.md");
    expect(papersOf(q!)).toEqual(["s/two.md"]);
  });

  it("does nothing for a dismissal naming a paper that no longer exists", async () => {
    const { c, read } = await review(files);
    await c.mutate("looseEnds.dismiss", {
      subject: "q-Q",
      kind: "inferred-link:gone-paper",
    });
    expect(papersOf((await read())[0]!).sort()).toEqual([
      "s/one.md",
      "s/two.md",
    ]);
  });
});
