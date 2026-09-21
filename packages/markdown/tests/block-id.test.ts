import { describe, expect, it } from "vitest";

import { parseBlockId } from "../src/index.js";

// A block id is `^` then Latin letters, digits, and dashes, at the end of a
// line after a space (B1a, B1b, B2) or alone on a line (B1c, B1d).
describe("parseBlockId", () => {
  it.each([
    ["^6ea9c9", "6ea9c9"], // B1e: Obsidian's own, six lowercase hex
    ["^h12", "h12"],
    ["^c3", "c3"],
    ["^my-own-id", "my-own-id"], // B3c
    ["^ID-9", "ID-9"],
  ])("%s names %s", (text, id) => {
    expect(parseBlockId(text)).toBe(id);
  });

  it.each(["^", "^with space", "^under_score", "^émoji", "^a.b", "id", "^a^b"])(
    "%j is not a block id",
    (text) => {
      expect(parseBlockId(text)).toBeNull();
    }
  );
});
