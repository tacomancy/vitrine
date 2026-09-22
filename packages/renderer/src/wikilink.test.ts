import { describe, expect, it } from "vitest";
import { linkLabel } from "./wikilink";

// One reading of `[[…]]` for every surface (ADR 0008 decision 7: the grammar
// is the package's, not a second copy here).
describe("linkLabel", () => {
  it("is the alias when there is one", () => {
    expect(linkLabel("[[Rasch & Born 2013|the 2013 review]]")).toBe(
      "the 2013 review"
    );
  });

  it("is the target with the fragment that names a block, or a heading", () => {
    expect(linkLabel("[[cordi2021#^h12]]")).toBe("cordi2021#^h12");
    expect(linkLabel("[[Sleep and consolidation#Method]]")).toBe(
      "Sleep and consolidation#Method"
    );
    expect(linkLabel("[[Rasch & Born 2013]]")).toBe("Rasch & Born 2013");
  });

  it("takes the inner text with or without its brackets", () => {
    expect(linkLabel("cordi2021#^h12")).toBe("cordi2021#^h12");
  });
});
