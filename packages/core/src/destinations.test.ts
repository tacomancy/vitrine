import { mkdir, rename, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Destinations } from "./destinations.js";
import { fileName } from "./file-name.js";
import {
  closeCores,
  core,
  fixtureCopy,
  tmp,
  type CoreOptions,
} from "./test-core.js";

afterEach(closeCores);

/** A core with the folder open and its index built, ready to be asked. */
async function opened(vault: string, opts: CoreOptions = {}) {
  const c = await core(opts);
  const reply = await c.mutate("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  await c.indexed();
  return {
    c,
    destinations: async (query: string) => {
      const reply = await c.query<Destinations>("globalCommand.destinations", {
        query,
      });
      expect(reply.error).toBeUndefined();
      return reply.result?.data as Destinations;
    },
  };
}

/** Every row as `<kind> <display>`, which is what the command's row shows. */
const shown = (d: Destinations) => d.rows.map((r) => `${r.kind} ${r.display}`);

/**
 * A vault of Questions whose file names, mtimes and frontmatter are all
 * given: `[name, text]` pairs written oldest first, one minute apart, so
 * recency is a fact of the folder and not of how fast the loop ran. A file
 * can also declare its own timestamp — a Question's `captured`, a Research
 * Question's `promoted` — which is what lets a test run the two against
 * each other.
 */
async function vaultOf(
  files: Array<{
    name: string;
    kind?: string;
    text?: string;
    stamp?: string;
  }>
): Promise<string> {
  const vault = await tmp("destinations");
  const start = Date.parse("2026-09-01T09:00:00Z");
  for (const [
    n,
    { name, kind = "question", text, stamp = "2026-09-01T09:00:00Z" },
  ] of files.entries()) {
    const path = join(vault, `${name}.md`);
    await mkdir(join(path, ".."), { recursive: true });
    const front = [`kind: ${kind}`];
    if (text !== undefined) front.push(`question: ${JSON.stringify(text)}`);
    if (kind === "question") front.push(`captured: ${stamp}`);
    if (kind === "research-question") front.push(`promoted: ${stamp}`);
    await writeFile(path, `---\n${front.join("\n")}\n---\n`);
    const when = new Date(start + n * 60_000);
    await utimes(path, when, when);
  }
  return vault;
}

describe("globalCommand.destinations", () => {
  it("names a Question by its text and a Research Question by its title", async () => {
    const c = await opened(await fixtureCopy("obsidian-vault"));
    // The Note, the two Sources and the stub have no Address, so no row
    // can lead to a dead end (ADR 0027 decision 4).
    expect(shown(await c.destinations(""))).toEqual([
      "research-question Is the overnight retention benefit attributable to consolidation, or to encoding strength at learning?",
      "question Does slow-wave density predict recall gain, or is it a proxy for encoding strength at learning?",
    ]);
  });

  it("carries the Kind and the vault-relative path beside the Display name", async () => {
    const c = await opened(await fixtureCopy("obsidian-vault"));
    expect((await c.destinations("slow-wave")).rows).toEqual([
      {
        kind: "question",
        path: "reading/Does slow-wave density predict recall gain.md",
        display:
          "Does slow-wave density predict recall gain, or is it a proxy for encoding strength at learning?",
      },
    ]);
  });

  it("finds a Question by a run of its text the file name strips out", async () => {
    // `:` and `?` are Obsidian-forbidden, so the stored name loses them
    // mid-string. Typing them is typing what the row visibly says.
    const text = "Do spindles gate consolidation: signal, or artefact?";
    const name = fileName(text, "id");
    expect(name).toBe("Do spindles gate consolidation signal, or artefact");
    const c = await opened(await vaultOf([{ name, text }]));

    expect(shown(await c.destinations("consolidation: signal"))).toEqual([
      `question ${text}`,
    ]);
  });

  it("finds a Question by a word past the length the file name is cut to", async () => {
    const text =
      "Does the overnight retention benefit depend on spindle density, on slow-wave amplitude, or on the coupling between them at encoding?";
    const name = fileName(text, "id");
    expect(name).not.toContain("coupling");
    const c = await opened(await vaultOf([{ name, text }]));

    expect(shown(await c.destinations("coupling between"))).toEqual([
      `question ${text}`,
    ]);
  });

  it("finds a hyphenated word by either half of it, and by the whole", async () => {
    // A hyphen is not a word boundary the reader can see, so all three
    // are the same word to anyone typing what the row says.
    const c = await opened(await fixtureCopy("obsidian-vault"));
    for (const typed of ["slow-wave", "slow wave", "wave density"]) {
      expect(shown(await c.destinations(typed))).toEqual([
        "question Does slow-wave density predict recall gain, or is it a proxy for encoding strength at learning?",
      ]);
    }
  });

  it("never lets a typed wildcard act as one", async () => {
    // The contains-LIKE carries no ESCAPE, which is safe only while
    // `matchKey` leaves no `%`, `_` or `\` on either side of it. A
    // surviving `%` would make each of these match; a space cannot.
    const c = await opened(await vaultOf([{ name: "q", text: "Anything" }]));
    expect(shown(await c.destinations("anything"))).toEqual([
      "question Anything",
    ]);
    for (const typed of ["any%thing", "any_thing", "any\\thing"]) {
      expect(shown(await c.destinations(typed))).toEqual([]);
    }
  });

  it("ranks by match strength, then by Kind, then by recency", async () => {
    const c = await opened(
      await vaultOf([
        { name: "q-contains", text: "Alphabeta gamma" },
        { name: "q-word-start", text: "Alpha beta gamma" },
        { name: "q-prefix-older", text: "Beta epsilon" },
        { name: "q-prefix-newer", text: "Beta zeta" },
        { name: "rq-prefix", kind: "research-question", text: "Beta delta" },
        { name: "q-exact", text: "Beta" },
        { name: "q-no-match", text: "Gamma only" },
      ])
    );

    expect(shown(await c.destinations("beta"))).toEqual([
      // Exact leads, whatever its Kind and however old it is.
      "question Beta",
      // Then the three prefixes: the Research Question, then the two
      // Questions newest first.
      "research-question Beta delta",
      "question Beta zeta",
      "question Beta epsilon",
      // Then the word start, then the bare contains.
      "question Alpha beta gamma",
      "question Alphabeta gamma",
    ]);
  });

  it("lists every object by Kind and then recency before a character is typed", async () => {
    const c = await opened(
      await vaultOf([
        { name: "q-old", text: "Oldest question" },
        { name: "rq", kind: "research-question", text: "A research question" },
        { name: "q-new", text: "Newest question" },
      ])
    );

    expect(shown(await c.destinations(""))).toEqual([
      "research-question A research question",
      "question Newest question",
      "question Oldest question",
    ]);
  });

  it("means by recent what changed on disk, not what a file says about itself", async () => {
    // Recency is the index's modification time for every Kind alike, and
    // deliberately not the timestamp the file declares: `captured` answers
    // *when I wondered it* and is the Inbox's sort, `promoted` *when I took
    // it up* (ADR 0027 decision 6). The files are written oldest first and
    // the declared timestamps run the other way, so a list sorted on
    // either one of them — or on the names, which sort against both — is a
    // different list from this.
    const long = "2026-01-02T09:00:00Z";
    const lately = "2026-09-26T09:00:00Z";
    const rq = "research-question";
    const c = await opened(
      await vaultOf([
        { name: "q-late", text: "Wondered lately", stamp: lately },
        { name: "rq-late", kind: rq, text: "Taken up lately", stamp: lately },
        { name: "rq-long", kind: rq, text: "Taken up long ago", stamp: long },
        { name: "q-long", text: "Wondered long ago", stamp: long },
      ])
    );

    expect(shown(await c.destinations(""))).toEqual([
      "research-question Taken up long ago",
      "research-question Taken up lately",
      "question Wondered long ago",
      "question Wondered lately",
    ]);
  });

  it("reaches a Question whose text is missing by the name it is stored under", async () => {
    // Partial (ADR 0009): the Inbox is where it is reported as such. It
    // still has an Address, and a row it can be reached by is better than
    // a silent omission.
    const c = await opened(await vaultOf([{ name: "Half a capture" }]));
    expect(shown(await c.destinations("half"))).toEqual([
      "question Half a capture",
    ]);
  });

  it("calls a renamed Question by the name it is stored under now", async () => {
    // A rename moves the `files` row rather than re-outlining the file
    // (#189), which is the one path on which a Display name derived from
    // the file name could be left saying the old one. Only a Partial
    // Question can show it: every other Question's name is its text, and
    // renaming the file does not touch that.
    const vault = await vaultOf([{ name: "Half a capture" }]);
    const c = await opened(vault, { settleMs: 200 });
    const stream = await c.c.events();

    await rename(
      join(vault, "Half a capture.md"),
      join(vault, "Half a rename.md")
    );
    expect((await stream.next("vaultChanged")).renamed).toHaveLength(1);

    expect(shown(await c.destinations("rename"))).toEqual([
      "question Half a rename",
    ]);
    expect(shown(await c.destinations("capture"))).toEqual([]);
    stream.close();
  });

  it("caps the rows and says how many there really are", async () => {
    const many = Array.from({ length: 60 }, (_, n) => ({
      name: `q${String(n).padStart(2, "0")}`,
      text: `Question ${String(n).padStart(2, "0")}`,
    }));
    const c = await opened(await vaultOf(many));

    const all = await c.destinations("question");
    expect(all.rows).toHaveLength(50);
    expect(all.total).toBe(60);

    const few = await c.destinations("question 1");
    expect(few.rows).toHaveLength(10);
    expect(few.total).toBe(10);
  });

  it("refuses when no vault is open", async () => {
    const c = await core();
    const reply = await c.query<Destinations>("globalCommand.destinations", {
      query: "a",
    });
    expect(reply.error?.message).toMatch(/no vault/i);
  });
});
