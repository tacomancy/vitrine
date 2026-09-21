import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createFile,
  readOutline,
  replaceFile,
  write,
  type WriteResult,
} from "./vault-files.js";
import { VaultError } from "./vault.js";
import { fixtures, tmp } from "./test-core.js";

// The write protocol at the module seam (#121): every assertion is on the
// bytes of the file afterwards, the result a caller sees, or the outline the
// next read returns. Never on the yaml Document or on how the splice ran.

// As in questions.atomic.test.ts: `rename` is the boundary between a whole
// file and a half one, and only a failure there shows the write was atomic.
const fs = vi.hoisted(() => ({
  rename: vi.fn<(a: string, b: string) => Promise<void>>(),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  fs.rename.mockImplementation(actual.rename);
  return { ...actual, rename: fs.rename };
});

const corpus = join(fixtures, "obsidian-corpus");

async function vaultWith(files: Record<string, string>): Promise<string> {
  const vault = await tmp("write");
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(vault, name, ".."), { recursive: true });
    await writeFile(join(vault, name), content);
  }
  return vault;
}

/** A temp vault holding a copy of one corpus file, untouched by Obsidian since. */
async function copyOf(
  name: string
): Promise<{ vault: string; original: string }> {
  const vault = await tmp("corpus-copy");
  await copyFile(join(corpus, name), join(vault, name));
  return { vault, original: await readFile(join(vault, name), "utf8") };
}

const sha256 = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const hashOf = async (path: string) => sha256(await readFile(path));
const bytes = (path: string) => readFile(path, "utf8");

/** The hash a caller carries into a write: what the read gave it. */
async function basedOn(vault: string, path: string): Promise<string> {
  const read = await readOutline(vault, path);
  if (!read.readable) throw new Error(`unreadable: ${read.reason}`);
  return read.hash;
}

function written(result: WriteResult) {
  if (!result.written) {
    throw new Error(`refused: ${result.reason} — ${result.detail}`);
  }
  return result;
}

function refused(result: WriteResult) {
  if (result.written) throw new Error("expected a refusal");
  return result;
}

const setFrontmatter = (keys: Record<string, unknown>) =>
  ({ op: "setFrontmatter", keys }) as const;
const addTags = (tags: string[]) =>
  ({ op: "setFrontmatter", addTags: tags }) as const;

describe("readOutline: the hash a write is based on", () => {
  it("is the SHA-256 of the file's bytes as they are on disk", async () => {
    const vault = await vaultWith({
      "a.md": "﻿---\r\nkind: note\r\n---\r\nBody\r\n",
    });
    const read = await readOutline(vault, "a.md");
    if (!read.readable) throw new Error(read.reason);
    expect(read.hash).toBe(await hashOf(join(vault, "a.md")));
  });
});

describe("setFrontmatter over the corpus: byte-identity outside the frontmatter", () => {
  // Every corpus file that has frontmatter, so a new corpus file joins the
  // test on its own. The README is not a fixture.
  const withFrontmatter = readdirSync(corpus)
    .filter((n) => n.endsWith(".md") && n !== "README.md")
    .sort();

  it("covers the props-* files at least", () => {
    expect(withFrontmatter).toEqual(
      expect.arrayContaining(["props-comma-tags.md", "props-types.md"])
    );
  });

  for (const name of withFrontmatter) {
    it(`${name}: the bytes before and after the frontmatter block are unchanged`, async () => {
      const { vault, original } = await copyOf(name);
      const read = await readOutline(vault, name);
      if (!read.readable || read.outline.frontmatter === null) {
        // A file without frontmatter is the `noFrontmatter` refusal below.
        const result = await write(vault, name, {
          operations: [setFrontmatter({ marker: "x" })],
          basedOn: read.readable ? read.hash : sha256(original),
        });
        expect(result.written).toBe(false);
        expect(await bytes(join(vault, name))).toBe(original);
        return;
      }
      const { range } = read.outline.frontmatter;
      const bom = read.file.bom ? "﻿" : "";
      const prefix = original.slice(0, bom.length + range.start);
      const suffix = original.slice(bom.length + range.end);

      const result = written(
        await write(vault, name, {
          operations: [setFrontmatter({ marker: "x" })],
          basedOn: read.hash,
        })
      );

      const after = await bytes(join(vault, name));
      expect(after).toBe(result.content);
      expect(result.hash).toBe(await hashOf(join(vault, name)));
      expect(after.startsWith(prefix)).toBe(true);
      expect(after.endsWith(suffix)).toBe(true);
      // The new key is last; every key the file had is still there, in order.
      const reread = await readOutline(vault, name);
      if (!reread.readable) throw new Error(reread.reason);
      const before = read.outline.frontmatter.value as Record<string, unknown>;
      const now = reread.outline.frontmatter?.value as Record<string, unknown>;
      expect(Object.keys(now)).toEqual([...Object.keys(before), "marker"]);
      expect(now).toMatchObject(before);
    });
  }
});

describe("setFrontmatter: what survives and what renormalises", () => {
  const messy = [
    "---",
    "# a comment the Properties panel would drop",
    "zebra: 'single quoted'",
    "kind: hypothesis # trailing comment",
    "",
    'apple: "double quoted"',
    `title: ${"a long plain scalar that yaml would fold at eighty columns ".repeat(2).trim()}`,
    "tags:",
    "    - alpha",
    "    - beta/nested",
    "flow: [a, b]",
    "mango: 43",
    "---",
    "",
    "## Criteria",
    "",
    "### One ^c1",
    "",
  ].join("\n");

  it("keeps comments, key order, blank lines, and quoting of untouched scalars; appends new keys last", async () => {
    const vault = await vaultWith({ "h.md": messy });
    written(
      await write(vault, "h.md", {
        operations: [setFrontmatter({ mango: 44, added: "Value" })],
        basedOn: await basedOn(vault, "h.md"),
      })
    );
    expect(await bytes(join(vault, "h.md"))).toBe(
      [
        "---",
        "# a comment the Properties panel would drop",
        "zebra: 'single quoted'",
        "kind: hypothesis # trailing comment",
        "",
        'apple: "double quoted"',
        `title: ${"a long plain scalar that yaml would fold at eighty columns ".repeat(2).trim()}`,
        "tags:",
        // The accepted renormalisations, asserted so a `yaml` upgrade that
        // changes them is noticed: 4-space indent to 2, `[a, b]` to `[ a, b ]`.
        "  - alpha",
        "  - beta/nested",
        "flow: [ a, b ]",
        "mango: 44",
        "added: Value",
        "---",
        "",
        "## Criteria",
        "",
        "### One ^c1",
        "",
      ].join("\n")
    );
  });

  it("never removes a key: setting one leaves every other exactly as it was", async () => {
    const vault = await vaultWith({
      "n.md": "---\nkind: note\nkeep: me\ntags: alpha, beta\n---\n",
    });
    written(
      await write(vault, "n.md", {
        operations: [setFrontmatter({ pdf: "paper.pdf" })],
        basedOn: await basedOn(vault, "n.md"),
      })
    );
    // A file the app never tags keeps its comma-string `tags:`.
    expect(await bytes(join(vault, "n.md"))).toBe(
      "---\nkind: note\nkeep: me\ntags: alpha, beta\npdf: paper.pdf\n---\n"
    );
  });

  it("sets an empty frontmatter block (`---\\n---`) as a map with keys", async () => {
    const vault = await vaultWith({ "e.md": "---\n---\nBody\n" });
    written(
      await write(vault, "e.md", {
        operations: [setFrontmatter({ pdf: "paper.pdf" })],
        basedOn: await basedOn(vault, "e.md"),
      })
    );
    expect(await bytes(join(vault, "e.md"))).toBe(
      "---\npdf: paper.pdf\n---\nBody\n"
    );
  });
});

describe("setFrontmatter: tags", () => {
  it("adds a tag as a block-sequence entry, written exactly as supplied", async () => {
    const { vault } = await copyOf("props-list-tags.md");
    written(
      await write(vault, "props-list-tags.md", {
        operations: [addTags(["Neuro/Sleep"])],
        basedOn: await basedOn(vault, "props-list-tags.md"),
      })
    );
    expect(await bytes(join(vault, "props-list-tags.md"))).toBe(
      "---\ntags:\n  - alpha\n  - ml/probing\n  - Neuro/Sleep\n---\n"
    );
  });

  it("does not add a tag the file already carries under another casing — the writer never introduces a variant", async () => {
    const { vault, original } = await copyOf("props-list-tags.md");
    written(
      await write(vault, "props-list-tags.md", {
        operations: [addTags(["ML/Probing"])],
        basedOn: await basedOn(vault, "props-list-tags.md"),
      })
    );
    expect(await bytes(join(vault, "props-list-tags.md"))).toBe(original);
  });

  it("converts a legacy comma-string `tags:` to a sequence on the first tag write, the entry verbatim and unsplit (F2a)", async () => {
    const vault = await vaultWith({
      "legacy.md": "---\nkind: note\ntags: alpha, beta\n---\nBody\n",
    });
    written(
      await write(vault, "legacy.md", {
        operations: [addTags(["gamma"])],
        basedOn: await basedOn(vault, "legacy.md"),
      })
    );
    expect(await bytes(join(vault, "legacy.md"))).toBe(
      "---\nkind: note\ntags:\n  - alpha, beta\n  - gamma\n---\nBody\n"
    );
  });

  it("writes a flow-sequence `tags:` as a block sequence when it adds to it", async () => {
    const vault = await vaultWith({ "f.md": "---\ntags: [a, b]\n---\n" });
    written(
      await write(vault, "f.md", {
        operations: [addTags(["c"])],
        basedOn: await basedOn(vault, "f.md"),
      })
    );
    expect(await bytes(join(vault, "f.md"))).toBe(
      "---\ntags:\n  - a\n  - b\n  - c\n---\n"
    );
  });

  it("creates `tags:` at the end when the file has none, and sets keys in the same write", async () => {
    const vault = await vaultWith({ "q.md": "---\nkind: question\n---\n" });
    written(
      await write(vault, "q.md", {
        operations: [setFrontmatter({ status: "open" }), addTags(["Topic"])],
        basedOn: await basedOn(vault, "q.md"),
      })
    );
    expect(await bytes(join(vault, "q.md"))).toBe(
      "---\nkind: question\nstatus: open\ntags:\n  - Topic\n---\n"
    );
  });
});

describe("re-apply: the file changed between the read and the write", () => {
  it("re-reads and applies the operation to the current content; the user's edit and the app's are both present", async () => {
    const vault = await vaultWith({
      "q.md": "---\nkind: question\n---\nFirst paragraph.\n",
    });
    const stale = await basedOn(vault, "q.md");
    await writeFile(
      join(vault, "q.md"),
      "---\nkind: question\nexternal: edit\n---\nFirst paragraph.\n\nA new paragraph.\n"
    );

    const result = written(
      await write(vault, "q.md", {
        operations: [setFrontmatter({ status: "open" })],
        basedOn: stale,
      })
    );

    expect(await bytes(join(vault, "q.md"))).toBe(
      "---\nkind: question\nexternal: edit\nstatus: open\n---\nFirst paragraph.\n\nA new paragraph.\n"
    );
    expect(result.hash).toBe(await hashOf(join(vault, "q.md")));
  });
});

describe("refusals: nothing touches the disk", () => {
  it("changedAndUnreapplyable when the frontmatter was made invalid between read and write", async () => {
    const vault = await vaultWith({ "q.md": "---\nkind: question\n---\n" });
    const stale = await basedOn(vault, "q.md");
    const broken = "---\nkind: [unclosed\n---\n";
    await writeFile(join(vault, "q.md"), broken);

    const result = refused(
      await write(vault, "q.md", {
        operations: [setFrontmatter({ status: "open" })],
        basedOn: stale,
      })
    );

    expect(result.reason).toBe("changedAndUnreapplyable");
    expect(result.detail).toMatch(/flow sequence/i);
    expect(await hashOf(join(vault, "q.md"))).toBe(sha256(broken));
  });

  it("changedAndUnreapplyable when the frontmatter was removed between read and write", async () => {
    const vault = await vaultWith({ "q.md": "---\nkind: question\n---\n" });
    const stale = await basedOn(vault, "q.md");
    await writeFile(join(vault, "q.md"), "Just prose now.\n");

    const result = refused(
      await write(vault, "q.md", {
        operations: [setFrontmatter({ status: "open" })],
        basedOn: stale,
      })
    );

    expect(result.reason).toBe("changedAndUnreapplyable");
    expect(await bytes(join(vault, "q.md"))).toBe("Just prose now.\n");
  });

  it("verificationFailed when the re-parse shows `kind` changed — set, or given to a file that had none", async () => {
    const vault = await vaultWith({
      "q.md": "---\nkind: question\n---\n",
      "e.md": "---\n---\n",
    });
    const result = refused(
      await write(vault, "q.md", {
        operations: [setFrontmatter({ kind: "hypothesis" })],
        basedOn: await basedOn(vault, "q.md"),
      })
    );
    expect(result.reason).toBe("verificationFailed");
    expect(result.detail).toMatch(/kind/);
    expect(await bytes(join(vault, "q.md"))).toBe("---\nkind: question\n---\n");

    const given = refused(
      await write(vault, "e.md", {
        operations: [setFrontmatter({ kind: "note" })],
        basedOn: await basedOn(vault, "e.md"),
      })
    );
    expect(given.reason).toBe("verificationFailed");
    expect(await bytes(join(vault, "e.md"))).toBe("---\n---\n");
  });

  it("noFrontmatter on a file that has none — only createFile makes frontmatter (ADR 0006 decision 11)", async () => {
    const { vault, original } = await copyOf("shape-no-frontmatter.md");
    const result = refused(
      await write(vault, "shape-no-frontmatter.md", {
        operations: [setFrontmatter({ kind: "note" })],
        basedOn: await basedOn(vault, "shape-no-frontmatter.md"),
      })
    );
    expect(result.reason).toBe("noFrontmatter");
    expect(await bytes(join(vault, "shape-no-frontmatter.md"))).toBe(original);
  });

  it("a blank line before `---` is no frontmatter too (S2)", async () => {
    const { vault, original } = await copyOf("shape-frontmatter-not-at-top.md");
    const result = refused(
      await write(vault, "shape-frontmatter-not-at-top.md", {
        operations: [setFrontmatter({ kind: "note" })],
        basedOn: await basedOn(vault, "shape-frontmatter-not-at-top.md"),
      })
    );
    expect(result.reason).toBe("noFrontmatter");
    expect(await bytes(join(vault, "shape-frontmatter-not-at-top.md"))).toBe(
      original
    );
  });

  it("refuses a path outside the vault as an input error, like a read", async () => {
    const vault = await vaultWith({});
    await expect(
      write(vault, "../elsewhere.md", { operations: [], basedOn: "" })
    ).rejects.toBeInstanceOf(VaultError);
  });
});

describe("replaceFile: the Vault editor's save", () => {
  const hypothesis =
    "---\nkind: hypothesis\nid: abcdefghij\n---\n## Criteria\n\n### One ^c1\n\n";

  it("refuses with changedOnDisk when the file changed, and writes nothing", async () => {
    const vault = await vaultWith({ "h.md": hypothesis });
    const stale = await basedOn(vault, "h.md");
    const edited = hypothesis + "An Obsidian edit.\n";
    await writeFile(join(vault, "h.md"), edited);

    const result = refused(await replaceFile(vault, "h.md", "Mine.\n", stale));

    expect(result.reason).toBe("changedOnDisk");
    expect(await bytes(join(vault, "h.md"))).toBe(edited);
  });

  it("succeeds when the new content breaks the Kind's shape; the next outline reports the shape problem (ADR 0015 decision 4)", async () => {
    const vault = await vaultWith({ "h.md": hypothesis });
    const content =
      "---\nkind: hypothesis\nid: abcdefghij\n---\nNo criteria any more.\n";

    const result = written(
      await replaceFile(vault, "h.md", content, await basedOn(vault, "h.md"))
    );

    expect(await bytes(join(vault, "h.md"))).toBe(content);
    expect(result.content).toBe(content);
    expect(result.hash).toBe(await hashOf(join(vault, "h.md")));
    const next = await readOutline(vault, "h.md");
    if (!next.readable) throw new Error(next.reason);
    expect(next.shape).toEqual([
      { path: "h.md", kind: "hypothesis", problem: "criteriaMissing" },
    ]);
  });

  it("lands even when the new content has no frontmatter at all — the user's typing is never refused on shape", async () => {
    const vault = await vaultWith({ "h.md": hypothesis });
    written(
      await replaceFile(
        vault,
        "h.md",
        "Prose only.\n",
        await basedOn(vault, "h.md")
      )
    );
    expect(await bytes(join(vault, "h.md"))).toBe("Prose only.\n");
  });

  it("restores the file's BOM and line endings around the editor's text", async () => {
    const vault = await vaultWith({
      "c.md": "﻿---\r\nkind: note\r\n---\r\nOld.\r\n",
    });
    written(
      await replaceFile(
        vault,
        "c.md",
        "---\nkind: note\n---\nNew.\n",
        await basedOn(vault, "c.md")
      )
    );
    expect(await bytes(join(vault, "c.md"))).toBe(
      "﻿---\r\nkind: note\r\n---\r\nNew.\r\n"
    );
  });
});

describe("createFile: a new object written whole", () => {
  it("writes UTF-8, LF, one trailing newline, no BOM, creating folders on the way", async () => {
    const vault = await vaultWith({});
    const result = written(
      await createFile(
        vault,
        "questions/New.md",
        "﻿---\r\nkind: question\r\n---\r\nBody\r\n\r\n"
      )
    );
    const content = "---\nkind: question\n---\nBody\n";
    expect(await bytes(join(vault, "questions/New.md"))).toBe(content);
    expect(result.content).toBe(content);
    expect(result.hash).toBe(sha256(content));
  });

  it("refuses to replace a file that exists", async () => {
    const vault = await vaultWith({ "a.md": "Already here.\n" });
    const result = refused(await createFile(vault, "a.md", "New.\n"));
    expect(result.reason).toBe("alreadyExists");
    expect(await bytes(join(vault, "a.md"))).toBe("Already here.\n");
  });
});

describe("atomicity", () => {
  it("lands as a temp file in the same folder, renamed into place", async () => {
    const vault = await vaultWith({
      "deep/q.md": "---\nkind: question\n---\n",
    });
    fs.rename.mockClear();
    written(
      await write(vault, "deep/q.md", {
        operations: [setFrontmatter({ status: "open" })],
        basedOn: await basedOn(vault, "deep/q.md"),
      })
    );
    expect(fs.rename).toHaveBeenCalledTimes(1);
    const [temp, target] = fs.rename.mock.calls[0]!;
    expect(join(temp, "..")).toBe(join(vault, "deep"));
    expect(target).toBe(join(vault, "deep/q.md"));
    expect(await readdir(join(vault, "deep"))).toEqual(["q.md"]);
  });

  it("a rename made to fail leaves the original intact and no partial file", async () => {
    const original = "---\nkind: question\n---\n";
    const vault = await vaultWith({ "q.md": original });
    fs.rename.mockRejectedValueOnce(
      Object.assign(new Error("EIO: i/o error, rename"), { code: "EIO" })
    );

    await expect(
      write(vault, "q.md", {
        operations: [setFrontmatter({ status: "open" })],
        basedOn: await basedOn(vault, "q.md"),
      })
    ).rejects.toMatchObject({
      kind: "writeFailed",
      message: expect.stringContaining("EIO") as string,
    });

    expect(await bytes(join(vault, "q.md"))).toBe(original);
    expect(await readdir(vault)).toEqual(["q.md"]);
  });
});

describe("EOL, BOM, and the trailing newline", () => {
  it("CRLF stays CRLF (synthetic: the corpus's shape-crlf.md is LF because Obsidian normalised it, S3)", async () => {
    const vault = await vaultWith({
      "crlf.md": "---\r\nkind: note\r\n---\r\nBody\r\n",
    });
    written(
      await write(vault, "crlf.md", {
        operations: [setFrontmatter({ x: 1 })],
        basedOn: await basedOn(vault, "crlf.md"),
      })
    );
    expect(await bytes(join(vault, "crlf.md"))).toBe(
      "---\r\nkind: note\r\nx: 1\r\n---\r\nBody\r\n"
    );
  });

  it("a BOM stays (synthetic: shape-bom.md lost its BOM to Obsidian, S4b)", async () => {
    const vault = await vaultWith({ "bom.md": "﻿---\nkind: note\n---\n" });
    written(
      await write(vault, "bom.md", {
        operations: [setFrontmatter({ x: 1 })],
        basedOn: await basedOn(vault, "bom.md"),
      })
    );
    expect(await bytes(join(vault, "bom.md"))).toBe(
      "﻿---\nkind: note\nx: 1\n---\n"
    );
  });

  it("a file without a trailing newline stays without, even when the frontmatter is the whole file", async () => {
    const vault = await vaultWith({ "cut.md": "---\nkind: note\n---" });
    written(
      await write(vault, "cut.md", {
        operations: [setFrontmatter({ x: 1 })],
        basedOn: await basedOn(vault, "cut.md"),
      })
    );
    expect(await bytes(join(vault, "cut.md"))).toBe(
      "---\nkind: note\nx: 1\n---"
    );
  });

  it("shape-no-trailing-newline.md (real) keeps its ending through the editor's save", async () => {
    const { vault } = await copyOf("shape-no-trailing-newline.md");
    written(
      await replaceFile(
        vault,
        "shape-no-trailing-newline.md",
        "Body. Edited twice.",
        await basedOn(vault, "shape-no-trailing-newline.md")
      )
    );
    expect(await bytes(join(vault, "shape-no-trailing-newline.md"))).toBe(
      "Body. Edited twice."
    );
  });
});
