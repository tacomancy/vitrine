import { readdirSync } from "node:fs";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import type { OutlineResponse } from "./vault-files.js";
import { core, fingerprint, fixtures, tmp } from "./test-core.js";

// Golden tests over the Obsidian-written corpus (#112) through the router,
// the seam every later surface reads through: one snapshot per file, and the
// README rows asserted by id. The README's Observed column is the oracle.
const corpus = join(fixtures, "obsidian-corpus");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(full));
    else if (entry.name.endsWith(".md") && entry.name !== "README.md")
      out.push(full);
  }
  return out.sort();
}

/** A core with the given folder open, ready to outline. */
async function opened(vault: string) {
  const c = await core();
  const reply = await c.mutate("vault.open", { path: vault });
  expect(reply.error).toBeUndefined();
  return {
    raw: (path: string) => c.query<OutlineResponse>("vault.outline", { path }),
    outline: async (path: string) => {
      const reply = await c.query<OutlineResponse>("vault.outline", { path });
      expect(reply.error).toBeUndefined();
      return reply.result?.data as OutlineResponse;
    },
    readable: async (path: string) => {
      const reply = await c.query<OutlineResponse>("vault.outline", { path });
      expect(reply.error).toBeUndefined();
      const data = reply.result?.data as OutlineResponse;
      if (!data.readable) throw new Error(`unreadable: ${data.reason}`);
      return data;
    },
  };
}

const read = (name: string) => readFile(join(corpus, name), "utf8");
const slice = (
  source: string,
  { start, end }: { start: number; end: number }
) => source.slice(start, end);
const canonical = (r: Extract<OutlineResponse, { readable: true }>) =>
  r.outline.tags.map((t) => (t.valid ? t.canonical : `invalid:${t.text}`));

describe("vault.outline over the corpus", () => {
  it("reads every file without writing a byte", async () => {
    const before = await fingerprint(corpus);
    const c = await opened(corpus);
    for (const path of files(corpus)) await c.outline(path);
    expect(await fingerprint(corpus)).toEqual(before);
  });

  for (const name of files(corpus).map((p) => relative(corpus, p))) {
    it(`${name}: snapshot`, async () => {
      const c = await opened(corpus);
      expect(await c.outline(name)).toMatchSnapshot();
    });
  }

  it("props-comment-and-order.md is a Hypothesis with no ## Criteria: one shape problem, an empty criteria list, the outline intact", async () => {
    const c = await opened(corpus);
    const r = await c.readable("props-comment-and-order.md");
    expect(r.kind).toBe("hypothesis");
    expect(r.shape).toEqual([
      {
        path: "props-comment-and-order.md",
        kind: "hypothesis",
        problem: "criteriaMissing",
      },
    ]);
    expect(r.criteria).toEqual([]);
    expect(canonical(r)).toEqual(["alpha", "beta/nested"]);
  });
});

describe("vault.outline: input", () => {
  it("refuses a path outside the vault, a dot-entry, a symlink out, and a non-Markdown file, each typed", async () => {
    const vault = await tmp("input");
    const outside = await tmp("outside");
    await writeFile(join(outside, "Elsewhere.md"), "text\n");
    await writeFile(join(vault, "image.png"), "");
    await symlink(join(outside, "Elsewhere.md"), join(vault, "linked.md"));
    const c = await opened(vault);
    for (const path of [
      join(outside, "Elsewhere.md"),
      "../Elsewhere.md",
      ".obsidian/workspace.md",
      "linked.md",
    ]) {
      const reply = await c.raw(path);
      expect(reply.error?.data.kind, path).toBe("outsideVault");
    }
    const reply = await c.raw("image.png");
    expect(reply.error?.data.kind).toBe("notMarkdown");
  });

  it("refuses when no vault is open", async () => {
    const c = await core();
    const reply = await c.query("vault.outline", { path: "a.md" });
    expect(reply.error?.message).toMatch(/no vault/i);
  });
});

describe("README rows: frontmatter", () => {
  it("F1 — a two-entry list with a nested tag", async () => {
    const c = await opened(corpus);
    expect(canonical(await c.readable("props-list-tags.md"))).toEqual([
      "alpha",
      "ml/probing",
    ]);
  });

  it("F2a, F2b — `tags:` is a sequence with the comma entry unsplit; alpha counts, beta is invalid", async () => {
    const c = await opened(corpus);
    const r = await c.readable("props-comma-tags.md");
    expect(r.outline.frontmatter).toMatchObject({
      parsed: true,
      value: { tags: ["alpha, beta", "gamma"] },
    });
    expect(canonical(r)).toEqual(["alpha", "invalid: beta", "gamma"]);
  });

  it("F3a, F3b — `tag: legacy` is a plain key and contributes no tag", async () => {
    const c = await opened(corpus);
    const r = await c.readable("props-legacy-tag-key.md");
    expect(r.outline.frontmatter).toMatchObject({ value: { tag: "legacy" } });
    expect(canonical(r)).toEqual([]);
  });

  it("F4a–f — no comments, no quotes, no blank line, a 2-space list, key order kept", async () => {
    const c = await opened(corpus);
    const source = await read("props-comment-and-order.md");
    const r = await c.readable("props-comment-and-order.md");
    if (!r.outline.frontmatter?.parsed) throw new Error("unreadable");
    const yaml = slice(source, r.outline.frontmatter.content);
    expect(yaml).not.toContain("#");
    expect(yaml).toContain("zebra: single quoted\n");
    expect(yaml).toContain("apple: double quoted\n");
    expect(yaml).not.toMatch(/\n\n/);
    expect(yaml).toContain("\n  - alpha\n");
    expect(Object.keys(r.outline.frontmatter.value as object)).toEqual([
      "zebra",
      "kind",
      "apple",
      "tags",
      "mango",
    ]);
  });

  it("F5 — a wikilink in a text property is a string, not a link", async () => {
    const c = await opened(corpus);
    const r = await c.readable("props-link-value.md");
    expect(r.outline.frontmatter).toMatchObject({
      value: { related: "[[Sleep and consolidation]]" },
    });
    expect(r.outline.links).toEqual([]);
  });

  it("F6 — property types as Obsidian writes them", async () => {
    const c = await opened(corpus);
    const r = await c.readable("props-types.md");
    expect(r.outline.frontmatter).toMatchObject({
      value: {
        title: "Types demo",
        aliases: ["td"],
        priority: 3,
        done: true,
        due: "1988-11-18",
        reviewed: "1988-11-18T12:34:00",
      },
    });
  });

  it("F7 — a hashtag in a text property is not counted", async () => {
    const c = await opened(corpus);
    expect(
      canonical(await c.readable("props-hashtag-in-text-property.md"))
    ).toEqual([]);
  });

  it("F8 — `[machine learning, other]` counts other only; the space entry is invalid", async () => {
    const c = await opened(corpus);
    expect(canonical(await c.readable("props-tag-with-space.md"))).toEqual([
      "invalid:machine learning",
      "other",
    ]);
  });
});

describe("README rows: body tags", () => {
  it("T1a–d — the distinct tags of tags-valid.md, one for both casings, emoji counted", async () => {
    const c = await opened(corpus);
    const r = await c.readable("tags-valid.md");
    expect(new Set(canonical(r))).toEqual(
      new Set([
        "simple",
        "with-dash",
        "with_underscore",
        "nested/two/levels",
        "y1984",
        "émoji🙂",
        "ml/probing",
      ])
    );
    expect(
      r.outline.tags
        .filter((t) => t.valid && t.canonical === "ml/probing")
        .map((t) => t.text)
    ).toEqual(["ML/Probing", "ml/probing"]);
  });

  it("T2a–e — the invalid forms", async () => {
    const c = await opened(corpus);
    expect(canonical(await c.readable("tags-invalid.md"))).toEqual([
      "tag",
      "a//b",
    ]);
  });

  it("T3a–k — excluded and included contexts", async () => {
    const c = await opened(corpus);
    expect(canonical(await c.readable("tags-excluded-contexts.md"))).toEqual([
      "control",
      "incomment",
    ]);
  });

  it("T4a–c — an unclosed backtick fence runs to the next backtick fence", async () => {
    const c = await opened(corpus);
    expect(canonical(await c.readable("fence-unclosed.md"))).toEqual([
      "afterfence",
    ]);
  });

  it("T5, T5b — `a < b` and inline HTML are not excluded contexts", async () => {
    const c = await opened(corpus);
    expect(canonical(await c.readable("lt-before-tag.md"))).toEqual([
      "comparison",
      "insidehtml",
    ]);
  });
});

describe("README rows: links, as parsed", () => {
  it("L1a–l — every form in links-all-forms.md", async () => {
    const c = await opened(corpus);
    const r = await c.readable("links-all-forms.md");
    expect(
      r.outline.links.map((l) => [
        l.target,
        l.heading,
        l.blockId,
        l.alias,
        l.embed,
      ])
    ).toEqual([
      ["Sleep and consolidation", [], null, null, false],
      ["Sleep and consolidation", [], null, "alias", false],
      ["Sleep and consolidation", ["Heading"], null, null, false],
      ["Sleep and consolidation", ["H1", "H2"], null, null, false],
      ["Sleep and consolidation", [], "blockid", null, false],
      ["", ["Own heading"], null, null, false],
      ["Sleep and consolidation", [], null, null, true],
      ["image.png", [], null, "200", true],
      ["Sleep and consolidation.md", [], null, "md link", false],
      ["Sleep and consolidation.md", ["Heading"], null, "md link", false],
      ["Sleep and consolidation", [], null, "shown", false],
    ]);
  });

  it("L2a, L3, L4a–c — targets and fragments are kept as written for the index to resolve", async () => {
    const c = await opened(corpus);
    expect(
      (await c.readable("links-same-name.md")).outline.links.map(
        (l) => l.target
      )
    ).toEqual(["Klinzing 2019"]);
    expect(
      (await c.readable("links-case.md")).outline.links.map((l) => l.target)
    ).toEqual(["sleep AND consolidation"]);
    expect(
      (await c.readable("links-heading-fragment.md")).outline.links.map(
        (l) => l.heading
      )
    ).toEqual([["heading"], [" Heading "], ["HEADING"]]);
  });
});

describe("README rows: block ids", () => {
  it("B1a–e — where Obsidian places its generated ids", async () => {
    const c = await opened(corpus);
    const source = await read("blocks-generated.md");
    const r = await c.readable("blocks-generated.md");
    expect(
      r.outline.blockIds.map((b) => [b.id, slice(source, b.range)])
    ).toEqual([
      ["6ea9c9", "A plain paragraph to link to. ^6ea9c9"],
      ["aa75c2", "- list item two ^aa75c2"],
      ["e4e371", "| col a | col b |\n| ----- | ----- |\n| 1     | 2     |"],
      ["86acd3", "> [!note]\n> A callout to link to."],
    ]);
    for (const block of r.outline.blockIds)
      expect(block.id).toMatch(/^[0-9a-f]{6}$/);
  });

  it("B2 — ^c1 on a ### line names that heading", async () => {
    const c = await opened(corpus);
    const r = await c.readable("blocks-on-heading.md");
    expect(r.outline.blockIds.map((b) => b.id)).toEqual(["c1"]);
    expect(r.outline.headings[1]).toMatchObject({
      level: 3,
      text: "Criterion text",
      blockId: "c1",
    });
    expect(
      (await c.readable("blocks-on-heading-link.md")).outline.links[0]
    ).toMatchObject({ target: "blocks-on-heading", blockId: "c1" });
  });

  it("B3a–c — hand-written ids are found like generated ones", async () => {
    const c = await opened(corpus);
    expect(
      (await c.readable("blocks-handwritten.md")).outline.blockIds.map(
        (b) => b.id
      )
    ).toEqual(["h12", "c3", "my-own-id"]);
    expect(
      (await c.readable("blocks-generated-links.md")).outline.links.map(
        (l) => l.blockId
      )
    ).toEqual([
      "6ea9c9",
      "aa75c2",
      "e4e371",
      "86acd3",
      "h12",
      "c3",
      "my-own-id",
    ]);
  });
});

describe("README rows: file shape", () => {
  it("S1 — no frontmatter, no kind", async () => {
    const c = await opened(corpus);
    const r = await c.readable("shape-no-frontmatter.md");
    expect(r.outline.frontmatter).toBeNull();
    expect(r.kind).toBeNull();
  });

  it("S2 — frontmatter after a blank line is body, so the file has no kind", async () => {
    const c = await opened(corpus);
    const r = await c.readable("shape-frontmatter-not-at-top.md");
    expect(r.outline.frontmatter).toBeNull();
    expect(r.kind).toBeNull();
    expect(r.outline.headings.map((h) => [h.level, h.text])).toEqual([
      [2, "kind: note"],
    ]);
  });

  it("S3 — the file is LF after Obsidian's edit", async () => {
    const c = await opened(corpus);
    expect((await c.readable("shape-crlf.md")).file.eol).toBe("lf");
  });

  it("S4a, S4b — the committed file has lost its BOM and reads as a note", async () => {
    const c = await opened(corpus);
    const r = await c.readable("shape-bom.md");
    expect(r.file.bom).toBe(false);
    expect(r.kind).toBe("note");
  });

  it("S5 — no trailing newline is remembered, not repaired", async () => {
    const c = await opened(corpus);
    expect((await c.readable("shape-no-trailing-newline.md")).file).toEqual({
      bom: false,
      eol: "lf",
      trailingNewline: false,
    });
  });
});
