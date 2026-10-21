import { utimes } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeCores, core, fingerprint, vaultWith } from "./test-core.js";

// Home's *changed while you were away* (spec #728, story RES-4): what happened
// in the vault since the researcher was last here, grouped under the Tag each
// item is about. Every case injects both the clock and the open days — a test
// that does not would pass or fail by the date it runs on.

afterEach(closeCores);

type Item = { path: string; sentence: string; title: string; at: string };
type Group = {
  topic:
    | { kind: "tag"; tag: string }
    | { kind: "invalid"; reason: string }
    | { kind: "untagged" };
  items: Item[];
};

/** A wall-clock time on this machine: the window opens at a *local* midnight. */
const local = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min).toISOString();

const TODAY = "2026-09-21T10:00:00+01:00";

const question = (captured: string, tags: string[] = [], text = "q") =>
  `---\nkind: question\nquestion: "${text}"\ncaptured: ${captured}\ntags: [${tags
    .map((t) => `"${t}"`)
    .join(", ")}]\n---\n`;

/** Open the vault on each earlier day, then read Home's changed section on `today`. */
async function changed(
  files: Record<string, string>,
  opts: {
    opens?: string[];
    today?: string;
    touch?: Record<string, string>;
  } = {}
) {
  const vault = await vaultWith(files);
  const today = opts.today ?? TODAY;
  let at = new Date(opts.opens?.[0] ?? today);
  const c = await core({ now: () => at });
  await c.mutate("vault.open", { path: vault });
  await c.indexed();
  for (const day of (opts.opens ?? []).slice(1)) {
    at = new Date(day);
    await c.focused();
  }
  at = new Date(today);
  await c.focused();
  for (const [path, when] of Object.entries(opts.touch ?? {})) {
    const date = new Date(when);
    await utimes(join(vault, path), date, date);
  }
  if (opts.touch) {
    await c.mutate("vault.open", { path: vault });
    await c.indexed();
  }
  const reply = await c.query<{ groups: Group[] }>("home.changed");
  return { vault, c, reply, groups: reply.result?.data.groups ?? [] };
}

const titles = (groups: Group[]) =>
  groups.map((g) => g.items.map((i) => i.path));

describe("home.changed — the window", () => {
  const files = (captured: string[]) =>
    Object.fromEntries(
      captured.map((c, i) => [`questions/q${i}.md`, question(c)])
    );

  it("begins at the start of the previous open day, so a week away reaches back to it", async () => {
    const { groups } = await changed(
      files([
        local(2026, 9, 14, 0, 30),
        local(2026, 9, 13, 23, 30),
        "2026-09-20T09:00:00+01:00",
      ]),
      { opens: ["2026-09-14T10:00:00+01:00"] }
    );
    expect(titles(groups)).toEqual([["questions/q2.md", "questions/q0.md"]]);
  });

  it("is seven days when there is no previous open day", async () => {
    const { groups } = await changed(
      files(["2026-09-14T11:00:00+01:00", "2026-09-14T09:00:00+01:00"])
    );
    expect(titles(groups)).toEqual([["questions/q0.md"]]);
  });

  it("is capped at fourteen days, so a month away reads as a fortnight", async () => {
    const { groups } = await changed(
      files([
        "2026-09-08T11:00:00+01:00",
        "2026-09-06T11:00:00+01:00",
        "2026-08-25T11:00:00+01:00",
      ]),
      { opens: ["2026-08-20T10:00:00+01:00"] }
    );
    expect(titles(groups)).toEqual([["questions/q0.md"]]);
  });

  it("never takes today as its own previous open day", async () => {
    // Opened this morning and a week ago: the window runs from the week ago,
    // not from the start of today, so yesterday's capture is still shown.
    const { groups } = await changed(files(["2026-09-20T09:00:00+01:00"]), {
      opens: ["2026-09-14T10:00:00+01:00", "2026-09-21T08:00:00+01:00"],
    });
    expect(titles(groups)).toEqual([["questions/q0.md"]]);
  });
});

describe("home.changed — what counts as an item", () => {
  it("names a Question captured in the window, with when", async () => {
    const { groups } = await changed({
      "questions/a.md": question("2026-09-20T09:00:00+01:00", [], "Why?"),
    });
    expect(groups[0]?.items).toEqual([
      {
        path: "questions/a.md",
        kind: "question",
        sentence: "Question captured",
        title: "Why?",
        at: "2026-09-20T08:00:00.000Z",
      },
    ]);
  });

  it("gives a Note edited in the window its mtime as its one item", async () => {
    const { groups } = await changed(
      { "notes/n.md": "# n\n" },
      { touch: { "notes/n.md": "2026-09-19T12:00:00+01:00" } }
    );
    expect(groups[0]?.items).toMatchObject([
      { path: "notes/n.md", kind: "note", sentence: "Note edited" },
    ]);
  });

  it("gives a structured file touched only by mtime no item", async () => {
    const { groups } = await changed(
      { "questions/old.md": question("2026-06-01T09:00:00+01:00") },
      { touch: { "questions/old.md": "2026-09-19T12:00:00+01:00" } }
    );
    expect(groups).toEqual([]);
  });

  it("gives a file changed outside the window nothing", async () => {
    const { groups } = await changed(
      { "notes/n.md": "# n\n" },
      { touch: { "notes/n.md": "2026-08-01T12:00:00+01:00" } }
    );
    expect(groups).toEqual([]);
  });
});

describe("home.changed — topics", () => {
  const at = "2026-09-20T09:00:00+01:00";
  const later = "2026-09-20T10:00:00+01:00";

  it("lands an item with two Tags once, under the Tag more items share", async () => {
    const { groups } = await changed({
      "questions/a.md": question(at, ["alpha", "zeta"]),
      "questions/b.md": question(at, ["zeta"]),
    });
    expect(
      groups.map((g) => [g.topic, g.items.map((i) => i.path).sort()])
    ).toEqual([
      [{ kind: "tag", tag: "zeta" }, ["questions/a.md", "questions/b.md"]],
    ]);
  });

  it("breaks a tie alphabetically", async () => {
    const { groups } = await changed({
      "questions/a.md": question(at, ["zeta", "alpha"]),
    });
    expect(groups.map((g) => g.topic)).toEqual([{ kind: "tag", tag: "alpha" }]);
  });

  it("groups a Tag as written, rolling nothing up", async () => {
    const { groups } = await changed({
      "questions/a.md": question(at, ["ml/interpretability/probing"]),
      "questions/b.md": question(at, ["ml"]),
    });
    expect(
      groups
        .map((g) => g.topic)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    ).toEqual([
      { kind: "tag", tag: "ml" },
      { kind: "tag", tag: "ml/interpretability/probing" },
    ]);
  });

  it("puts an untagged item in a final group named untagged", async () => {
    const { groups } = await changed({
      "questions/a.md": question(later),
      "questions/b.md": question(at, ["ml"]),
    });
    expect(groups.map((g) => g.topic)).toEqual([
      { kind: "tag", tag: "ml" },
      { kind: "untagged" },
    ]);
  });

  it("groups an invalid Tag by its reason and never drops the item", async () => {
    const { groups } = await changed({
      "questions/a.md": question(at, ["machine learning"]),
    });
    expect(groups).toMatchObject([
      {
        topic: { kind: "invalid", reason: "contains whitespace" },
        items: [{ path: "questions/a.md" }],
      },
    ]);
  });

  it("orders groups by their newest item and items newest first", async () => {
    const { groups } = await changed({
      "questions/a.md": question(at, ["a"]),
      "questions/b.md": question(later, ["b"]),
      "questions/c.md": question("2026-09-20T09:30:00+01:00", ["a"]),
    });
    expect(groups.map((g) => g.topic)).toEqual([
      { kind: "tag", tag: "b" },
      { kind: "tag", tag: "a" },
    ]);
    expect(groups[1]?.items.map((i) => i.path)).toEqual([
      "questions/c.md",
      "questions/a.md",
    ]);
  });

  it("stops at five groups of three and carries no total", async () => {
    const many: Record<string, string> = {};
    for (let g = 0; g < 7; g++) {
      for (let i = 0; i < 5; i++) {
        many[`questions/g${g}-${i}.md`] = question(
          `2026-09-20T0${g + 1}:0${i}:00+01:00`,
          [`t${g}`]
        );
      }
    }
    const { reply, groups } = await changed(many);
    expect(groups).toHaveLength(5);
    expect(groups.every((g) => g.items.length === 3)).toBe(true);
    expect(Object.keys(reply.result?.data ?? {}).sort()).toEqual([
      "groups",
      "since",
    ]);
    expect(JSON.stringify(reply.result?.data)).not.toMatch(/total|count/i);
  });
});

describe("home.changed — reading", () => {
  it("changes no file in the vault", async () => {
    const { vault, c } = await changed({
      "questions/a.md": question("2026-09-20T09:00:00+01:00"),
    });
    const before = await fingerprint(vault);
    await c.query("home.changed");
    expect(await fingerprint(vault)).toEqual(before);
  });
});
