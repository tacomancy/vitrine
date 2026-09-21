import { describe, expect, it } from "vitest";

import { parseInlineField } from "../src/index.js";

// `key:: value` on a line of its own, the Dataview shape ADR 0006 decision 2
// borrowed for a criterion's `relationship::` and `outcome::`.
describe("parseInlineField", () => {
  it.each([
    ["outcome:: met", { key: "outcome", value: "met", valueStart: 10 }],
    [
      "relationship::confirming",
      { key: "relationship", value: "confirming", valueStart: 14 },
    ],
    [
      "outcome::   not met  ",
      { key: "outcome", value: "not met", valueStart: 12 },
    ],
    ["outcome::", { key: "outcome", value: "", valueStart: 9 }],
    ["my-key_2:: x", { key: "my-key_2", value: "x", valueStart: 11 }],
  ])("%j", (line, expected) => {
    expect(parseInlineField(line)).toEqual(expected);
  });

  it("splits at the first `::`", () => {
    expect(parseInlineField("a::b:: c")).toEqual({
      key: "a",
      value: "b:: c",
      valueStart: 3,
    });
  });

  it.each([
    ":: value", // no key
    "outcome: met", // one colon is YAML, not a field
    "see outcome:: met", // a key has no spaces: the field must start the line
    " outcome:: met",
    "outcome :: met",
  ])("%j is not a field", (line) => {
    expect(parseInlineField(line)).toBeNull();
  });
});
