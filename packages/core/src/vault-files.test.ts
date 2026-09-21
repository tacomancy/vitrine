import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readOutline, type OutlineResponse } from "./vault-files.js";
import { vaultWith } from "./test-core.js";

// The module seam: one file's outline plus what only the core knows — its
// Kind, the shape problems its Kind implies, and the file-level choices the
// writer (#121) restores. Everything asserted here is what a caller sees.

function readable(response: OutlineResponse) {
  if (!response.readable) throw new Error(`unreadable: ${response.reason}`);
  return response;
}

const hypothesis = (body: string) =>
  `---\nkind: hypothesis\nid: abcdefghij\n---\n${body}`;

describe("readOutline: kind and file-level choices", () => {
  it("reads kind from frontmatter, verbatim, and null when there is none", async () => {
    const vault = await vaultWith({
      "a.md": "---\nkind: question\n---\n",
      "b.md": "---\nkind: something-new\n---\n",
      "c.md": "# No frontmatter\n",
      "d.md": "---\ntags: [x]\n---\n",
    });
    expect(readable(await readOutline(vault, "a.md")).kind).toBe("question");
    expect(readable(await readOutline(vault, "b.md")).kind).toBe(
      "something-new"
    );
    expect(readable(await readOutline(vault, "c.md")).kind).toBeNull();
    expect(readable(await readOutline(vault, "d.md")).kind).toBeNull();
  });

  it("reports the vault-relative path whether given a relative or an absolute one", async () => {
    const vault = await vaultWith({ "deep/er/Note.md": "text\n" });
    const rel = readable(await readOutline(vault, "deep/er/Note.md"));
    const abs = readable(
      await readOutline(vault, join(vault, "deep/er/Note.md"))
    );
    expect(rel.path).toBe("deep/er/Note.md");
    expect(abs.path).toBe("deep/er/Note.md");
  });

  it("strips a BOM before outlining, so offsets are into the BOM-less text, and remembers it", async () => {
    const vault = await vaultWith({
      "bom.md": "﻿---\nkind: note\n---\n# Heading\n",
      "plain.md": "---\nkind: note\n---\n# Heading\n",
    });
    const bom = readable(await readOutline(vault, "bom.md"));
    const plain = readable(await readOutline(vault, "plain.md"));
    expect(bom.file).toEqual({ bom: true, eol: "lf", trailingNewline: true });
    expect(plain.file).toEqual({
      bom: false,
      eol: "lf",
      trailingNewline: true,
    });
    expect(bom.outline).toEqual(plain.outline);
    expect(bom.outline.headings[0]?.range).toEqual({ start: 19, end: 28 });
  });

  it("remembers CRLF and a missing trailing newline", async () => {
    const vault = await vaultWith({
      "crlf.md": "---\r\nkind: note\r\n---\r\n# Heading\r\n",
      "cut.md": "# Heading",
    });
    expect(readable(await readOutline(vault, "crlf.md")).file).toEqual({
      bom: false,
      eol: "crlf",
      trailingNewline: true,
    });
    expect(readable(await readOutline(vault, "cut.md")).file).toEqual({
      bom: false,
      eol: "lf",
      trailingNewline: false,
    });
  });

  it("returns the frontmatter's plain value, never a yaml Document", async () => {
    const vault = await vaultWith({
      "q.md": "---\nkind: question\ntags:\n  - a\n  - b\n---\n",
    });
    const { outline } = readable(await readOutline(vault, "q.md"));
    expect(outline.frontmatter).toEqual({
      range: { start: 0, end: 40 },
      content: { start: 4, end: 37 },
      value: { kind: "question", tags: ["a", "b"] },
    });
  });
});

describe("readOutline: unreadable", () => {
  it("is unreadable with the reason when frontmatter does not parse", async () => {
    const vault = await vaultWith({
      "broken.md": "---\nkind: [unclosed\n---\n# Still here\n",
    });
    const response = await readOutline(vault, "broken.md");
    expect(response).toMatchObject({ readable: false, path: "broken.md" });
    if (response.readable) throw new Error("expected unreadable");
    expect(response.reason).toMatch(/flow sequence/i);
  });

  it("is unreadable when frontmatter is not a map of keys", async () => {
    const vault = await vaultWith({ "list.md": "---\n- a\n- b\n---\n" });
    const response = await readOutline(vault, "list.md");
    expect(response).toMatchObject({
      readable: false,
      reason: expect.stringMatching(/map/i) as string,
    });
  });

  it("is unreadable when kind: is not a string — a wrong value, not a missing key", async () => {
    const vault = await vaultWith({
      "k.md": "---\nkind:\n  - a\n---\n",
      "empty.md": "---\n---\n",
    });
    expect(await readOutline(vault, "k.md")).toMatchObject({
      readable: false,
      reason: expect.stringMatching(/kind is not a string/) as string,
    });
    const empty = readable(await readOutline(vault, "empty.md"));
    expect(empty.kind).toBeNull();
    expect(empty.outline.frontmatter).toMatchObject({ value: {} });
  });

  it("is unreadable with the system's reason when the file cannot be read", async () => {
    const vault = await vaultWith({});
    const response = await readOutline(vault, "missing.md");
    expect(response).toMatchObject({
      readable: false,
      path: "missing.md",
      reason: expect.stringMatching(/ENOENT/) as string,
    });
  });
});

describe("readOutline: shape problems", () => {
  it("a Hypothesis without ## Criteria is a shape problem, and the rest of the outline stands", async () => {
    const vault = await vaultWith({
      "h.md": hypothesis(
        "## Claim\n\nThe claim. #topic\n\n## Design notes\n\nText.\n"
      ),
    });
    const r = readable(await readOutline(vault, "h.md"));
    expect(r.shape).toEqual([
      { path: "h.md", kind: "hypothesis", problem: "criteriaMissing" },
    ]);
    expect(r.outline.headings.map((h) => h.text)).toEqual([
      "Claim",
      "Design notes",
    ]);
    expect(r.outline.tags.map((t) => t.text)).toEqual(["topic"]);
    expect(r.criteria).toEqual([]);
  });

  it("a ### under ## Criteria without ^c<n> is a shape problem naming the heading", async () => {
    const vault = await vaultWith({
      "h.md": hypothesis(
        "## Criteria\n\n### Has an id ^c1\n\nrelationship:: confirming\noutcome:: met\n\n### Has none\n\nrelationship:: confirming\n\n## Design notes\n\n### Not a criterion\n"
      ),
    });
    const r = readable(await readOutline(vault, "h.md"));
    expect(r.shape).toEqual([
      {
        path: "h.md",
        kind: "hypothesis",
        problem: "criterionWithoutId",
        block: "Has none",
      },
    ]);
    expect(r.criteria).toEqual([
      {
        id: "c1",
        text: "Has an id",
        relationship: "confirming",
        outcome: "met",
      },
    ]);
  });

  it("an outcome or relationship outside its vocabulary is a shape problem on that block", async () => {
    const vault = await vaultWith({
      "h.md": hypothesis(
        "## Criteria\n\n### One ^c1\n\nrelationship:: supporting\noutcome:: met\n\n### Two ^c2\n\nrelationship:: falsifying\noutcome:: maybe\n\n### Three ^c3\n\noutcome:: not met\n"
      ),
    });
    const r = readable(await readOutline(vault, "h.md"));
    expect(r.shape).toEqual([
      {
        path: "h.md",
        kind: "hypothesis",
        problem: "fieldOutsideVocabulary",
        block: "c1",
      },
      {
        path: "h.md",
        kind: "hypothesis",
        problem: "fieldOutsideVocabulary",
        block: "c2",
      },
    ]);
    // A field with a bad value is read as absent; the criterion still lists.
    expect(r.criteria).toEqual([
      { id: "c1", text: "One", relationship: null, outcome: "met" },
      { id: "c2", text: "Two", relationship: "falsifying", outcome: null },
      { id: "c3", text: "Three", relationship: null, outcome: "not met" },
    ]);
  });

  it("a key:: value under a ### outside ## Criteria is prose, not a criterion field", async () => {
    const vault = await vaultWith({
      "h.md": hypothesis(
        "## Criteria\n\n### One ^c1\n\noutcome:: met\n\n## Design notes\n\n### Aside ^c9\n\noutcome:: nonsense\nrelationship:: nonsense\n"
      ),
    });
    const r = readable(await readOutline(vault, "h.md"));
    expect(r.shape).toEqual([]);
    expect(r.criteria.map((c) => c.id)).toEqual(["c1"]);
  });

  it("an owned section present twice is a shape problem on the Kinds that own it", async () => {
    const vault = await vaultWith({
      "s.md":
        "---\nkind: source\n---\n## Annotations\n\n- one\n\n## Notes\n\n## Annotations\n\n- two\n",
      "rq.md":
        "---\nkind: research-question\n---\n## Position history\n\n## Position history\n",
      "n.md": "---\nkind: note\n---\n## Annotations\n\n## Annotations\n",
      "plain.md": "## Position history\n\n## Position history\n",
    });
    expect(readable(await readOutline(vault, "s.md")).shape).toEqual([
      {
        path: "s.md",
        kind: "source",
        problem: "ownedSectionDuplicated",
        block: "Annotations",
      },
    ]);
    expect(readable(await readOutline(vault, "rq.md")).shape).toEqual([
      {
        path: "rq.md",
        kind: "research-question",
        problem: "ownedSectionDuplicated",
        block: "Position history",
      },
    ]);
    expect(readable(await readOutline(vault, "n.md")).shape).toEqual([]);
    expect(readable(await readOutline(vault, "plain.md")).shape).toEqual([]);
  });

  it("a missing owned section is not a shape problem (ADR 0008 decision 10)", async () => {
    const vault = await vaultWith({
      "s.md": "---\nkind: source\n---\nJust my notes.\n",
      "h.md": hypothesis("## Criteria\n\n### One ^c1\n\noutcome:: met\n"),
    });
    expect(readable(await readOutline(vault, "s.md")).shape).toEqual([]);
    expect(readable(await readOutline(vault, "h.md")).shape).toEqual([]);
  });

  it("a file with no kind, or an unknown one, has no shape to fall short of", async () => {
    const vault = await vaultWith({
      "u.md": "---\nkind: recipe\n---\n## Criteria\n\n### No id\n",
      "n.md": "## Criteria\n\n### No id\n",
    });
    expect(readable(await readOutline(vault, "u.md")).shape).toEqual([]);
    expect(readable(await readOutline(vault, "n.md")).shape).toEqual([]);
  });
});
