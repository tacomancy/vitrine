import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Listing } from "./list.js";
import { closeCores, core, fingerprint, vaultWith } from "./test-core.js";

afterEach(closeCores);

// `answered` carries the local offset, so the clock is pinned to one zone.
beforeAll(() => {
  process.env["TZ"] = "Asia/Kolkata";
});
const at = new Date("2026-09-21T10:00:00+05:30");
const ANSWERED_AT = "2026-09-21T10:00:00+05:30";

const HEAD = `---
id: k7m2p9q4wx
kind: question
question: "Does slow-wave density predict recall gain?"
status: open
captured: 2026-08-14T09:12:00+01:00
context: reading
from: "[[Rasch & Born 2013]]"
page: 699
---
`;

const PATH = "questions/Does slow-wave density predict recall gain.md";
const LINE =
  "Only above 1.5 Hz, and only in the first cycle. [[Rasch & Born 2013]]";

/** The file after *answer*: `status` in place, `answered` appended, the line at the end of the lead. */
const ANSWERED = `---
id: k7m2p9q4wx
kind: question
question: "Does slow-wave density predict recall gain?"
status: answered
captured: 2026-08-14T09:12:00+01:00
context: reading
from: "[[Rasch & Born 2013]]"
page: 699
answered: 2026-09-21T10:00:00+05:30
---

Something the user wrote.

${LINE}
`;

const withStatus = (file: string, status: string) =>
  file.replace("status: open", `status: ${status}`);

async function openedVault(files: Record<string, string>) {
  const vault = await vaultWith(files);
  const c = await core({ now: () => at });
  const opened = await c.mutate("vault.open", { path: vault });
  expect(opened.error).toBeUndefined();
  await c.indexed();
  return { vault, c };
}

const statusIn = async (
  c: Awaited<ReturnType<typeof openedVault>>["c"],
  path: string
) => {
  const listing = await c.query<Listing>("questions.list");
  return listing.result?.data.questions.find((q) => q.path.endsWith(path))
    ?.status;
};

describe("questions.answer", () => {
  it("appends the typed line to the lead and sets status then answered, leaving the rest of the body as written", async () => {
    const { vault, c } = await openedVault({
      [PATH]: `${HEAD}\nSomething the user wrote.\n`,
    });

    const reply = await c.mutate("questions.answer", {
      path: join(vault, PATH),
      line: LINE,
    });

    expect(reply.error).toBeUndefined();
    expect(await readFile(join(vault, PATH), "utf8")).toBe(ANSWERED);
    expect(await statusIn(c, PATH)).toBe("answered");
  });

  it("puts the line above a `##` section the body already has, never inside it", async () => {
    const { vault, c } = await openedVault({
      [PATH]: `${HEAD}\nA lead paragraph.\n\n## Notes\n\nSomething under a heading.\n`,
    });

    await c.mutate("questions.answer", { path: PATH, line: LINE });

    const after = await readFile(join(vault, PATH), "utf8");
    expect(after).toContain(
      `A lead paragraph.\n\n${LINE}\n\n## Notes\n\nSomething under a heading.\n`
    );
  });

  it("answers a freshly captured Question, whose body is empty", async () => {
    const { vault, c } = await openedVault({ [PATH]: HEAD });
    await c.mutate("questions.answer", { path: PATH, line: LINE });
    const after = await readFile(join(vault, PATH), "utf8");
    // The protocol opens no blank line the file did not have.
    expect(after.endsWith(`---\n${LINE}\n`)).toBe(true);
  });

  it("refuses a Question that is not open, and writes nothing", async () => {
    const { vault, c } = await openedVault({
      [PATH]: withStatus(HEAD, "promoted"),
    });
    const before = await fingerprint(vault);
    const reply = await c.mutate("questions.answer", {
      path: PATH,
      line: LINE,
    });
    expect(reply.error?.data.kind).toBe("refused");
    expect(reply.error?.message).toMatch(/promoted/);
    expect(await fingerprint(vault)).toEqual(before);
  });

  it("refuses a file that is not a Question, one outside the vault, and with no vault open", async () => {
    const { c } = await openedVault({
      "notes/Plain.md": "---\nkind: note\n---\n",
    });
    const note = await c.mutate("questions.answer", {
      path: "notes/Plain.md",
      line: LINE,
    });
    expect(note.error?.data.kind).toBe("refused");
    expect(note.error?.message).toMatch(/not a Question/);
    const outside = await c.mutate("questions.answer", {
      path: "../Elsewhere.md",
      line: LINE,
    });
    expect(outside.error?.data.kind).toBe("outsideVault");

    const bare = await core();
    expect(
      (await bare.mutate("questions.answer", { path: PATH, line: LINE })).error
        ?.data.kind
    ).toBe("noVault");
  });

  it("refuses an empty line before anything is written", async () => {
    const { vault, c } = await openedVault({ [PATH]: HEAD });
    const before = await fingerprint(vault);
    const reply = await c.mutate("questions.answer", {
      path: PATH,
      line: "  ",
    });
    expect(reply.error).toBeDefined();
    expect(await fingerprint(vault)).toEqual(before);
  });
});

describe("questions.drop", () => {
  it("sets status: abandoned with the body byte-identical", async () => {
    const body = "\nSomething the user wrote.\n";
    const { vault, c } = await openedVault({ [PATH]: HEAD + body });

    const reply = await c.mutate("questions.drop", { path: PATH });

    expect(reply.error).toBeUndefined();
    expect(await readFile(join(vault, PATH), "utf8")).toBe(
      withStatus(HEAD, "abandoned") + body
    );
    expect(await statusIn(c, PATH)).toBe("abandoned");
  });

  it("refuses a Question that is not open, and writes nothing", async () => {
    const { vault, c } = await openedVault({
      [PATH]: withStatus(HEAD, "abandoned"),
    });
    const before = await fingerprint(vault);
    const reply = await c.mutate("questions.drop", { path: PATH });
    expect(reply.error?.data.kind).toBe("refused");
    expect(await fingerprint(vault)).toEqual(before);
  });
});

describe("questions.reopen", () => {
  it("sets status: open on a dropped Question, body byte-identical", async () => {
    const body = "\nSomething the user wrote.\n";
    const { vault, c } = await openedVault({
      [PATH]: withStatus(HEAD, "abandoned") + body,
    });

    const reply = await c.mutate("questions.reopen", { path: PATH });

    expect(reply.error).toBeUndefined();
    expect(await readFile(join(vault, PATH), "utf8")).toBe(HEAD + body);
    expect(await statusIn(c, PATH)).toBe("open");
  });

  it("sets status: open on an answered Question and keeps the answer text", async () => {
    const { vault, c } = await openedVault({ [PATH]: HEAD });
    await c.mutate("questions.answer", { path: PATH, line: LINE });
    const answered = await readFile(join(vault, PATH), "utf8");

    await c.mutate("questions.reopen", { path: PATH });

    const after = await readFile(join(vault, PATH), "utf8");
    expect(after).toContain(LINE);
    expect(bodyOf(after)).toBe(bodyOf(answered));
    expect(after).toContain("status: open");
    // `answered:` is left as the record of when it was answered, not removed:
    // no operation removes a key, and the status is what says it is open.
    expect(after).toContain(`answered: ${ANSWERED_AT}`);
    expect(await statusIn(c, PATH)).toBe("open");
  });

  it("refuses a Question that is already open, and writes nothing", async () => {
    const { vault, c } = await openedVault({ [PATH]: HEAD });
    const before = await fingerprint(vault);
    const reply = await c.mutate("questions.reopen", { path: PATH });
    expect(reply.error?.data.kind).toBe("refused");
    expect(reply.error?.message).toMatch(/open/);
    expect(await fingerprint(vault)).toEqual(before);
  });
});

/** Everything after the frontmatter block. */
const bodyOf = (file: string) => file.slice(file.indexOf("\n---\n", 4) + 5);
