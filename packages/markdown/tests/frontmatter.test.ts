import { describe, expect, it } from "vitest";

import { locateFrontmatter, opensFrontmatter } from "../src/index.js";

// The fence rule: `---` at offset 0 (after an optional BOM), closed by a line
// that is `---`; a blank line before the opening fence means no frontmatter
// (S2); a BOM before it still counts (S4a).
describe("locateFrontmatter", () => {
  it("locates the block and the YAML inside it", () => {
    const source = "---\nkind: note\n---\nBody.\n";
    expect(locateFrontmatter(source)).toEqual({
      range: { start: 0, end: 18 },
      content: { start: 4, end: 15 },
    });
    expect(source.slice(4, 15)).toBe("kind: note\n");
    expect(source.slice(0, 18)).toBe("---\nkind: note\n---");
  });

  it("still counts with a BOM in front (S4a); the ranges skip the BOM", () => {
    const source = "﻿---\nkind: note\n---\nBody.\n";
    expect(locateFrontmatter(source)).toEqual({
      range: { start: 1, end: 19 },
      content: { start: 5, end: 16 },
    });
  });

  it("is body, not frontmatter, after a blank line (S2)", () => {
    expect(locateFrontmatter("\n---\nkind: note\n---\nBody.")).toBeNull();
  });

  it("is body when the fence is indented or has company on its line", () => {
    expect(locateFrontmatter(" ---\nkind: note\n---\n")).toBeNull();
    expect(locateFrontmatter("--- x\nkind: note\n---\n")).toBeNull();
    expect(locateFrontmatter("----\nkind: note\n---\n")).toBeNull();
  });

  it("needs a closing fence", () => {
    expect(locateFrontmatter("---\nkind: note\n")).toBeNull();
    expect(locateFrontmatter("---\nkind: note\n----\n")).toBeNull();
    expect(locateFrontmatter("---\nkind: note\n --- \n")).toBeNull();
  });

  it("allows trailing whitespace on a fence line and CRLF endings", () => {
    const source = "---  \r\nkind: note\r\n---\t\r\nBody.\r\n";
    const located = locateFrontmatter(source);
    expect(located).toEqual({
      range: { start: 0, end: 23 },
      content: { start: 7, end: 19 },
    });
    expect(source.slice(7, 19)).toBe("kind: note\r\n");
  });

  it("may be empty, and may close at end of file without a newline", () => {
    expect(locateFrontmatter("---\n---")).toEqual({
      range: { start: 0, end: 7 },
      content: { start: 4, end: 4 },
    });
  });

  it("does not take a later --- for the closing fence when it is not alone on its line", () => {
    expect(locateFrontmatter("---\na: ---\n---\n")).toEqual({
      range: { start: 0, end: 14 },
      content: { start: 4, end: 11 },
    });
  });
});

// A reader that takes a file in chunks needs to know, before the closing
// fence has arrived, whether there is a block to wait for at all.
describe("opensFrontmatter", () => {
  it("is the opening half of the same rule", () => {
    expect(opensFrontmatter("---\nkind: note\n")).toBe(true);
    expect(opensFrontmatter("﻿---\r\nkind: note\r\n")).toBe(true);
    expect(opensFrontmatter("---  \nkind: note\n")).toBe(true);
    expect(opensFrontmatter("\n---\nkind: note\n")).toBe(false);
    expect(opensFrontmatter(" ---\nkind: note\n")).toBe(false);
    expect(opensFrontmatter("--- x\nkind: note\n")).toBe(false);
    expect(opensFrontmatter("# Heading\n")).toBe(false);
  });
});
