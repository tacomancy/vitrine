import { describe, expect, it } from "vitest";
import { EXTERNAL_SCHEMES } from "../../shell/src/main/navigation";
import { classifyLink, OUTBOUND, refusal } from "./link-rule";

describe("classifyLink", () => {
  it("sends https, http and mailto out, by the parsed spelling", () => {
    expect(classifyLink("https://example.org/a b")).toEqual({
      kind: "out",
      href: "https://example.org/a%20b",
    });
    expect(classifyLink("http://example.org").kind).toBe("out");
    expect(classifyLink("mailto:a@example.org").kind).toBe("out");
  });

  it("keeps the app's own routes in the window", () => {
    expect(classifyLink("#/source/sources/x.md")).toEqual({
      kind: "route",
      href: "#/source/sources/x.md",
    });
  });

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "obsidian://open?vault=v",
  ])("refuses %s and names its scheme", (href) => {
    const link = classifyLink(href);
    expect(link.kind).toBe("refused");
    if (link.kind === "refused") {
      expect(link.scheme).toBe(new URL(href).protocol);
      expect(refusal(link.scheme)).toContain(link.scheme!);
    }
  });

  it("refuses text that is not an address, saying so", () => {
    expect(classifyLink("not a link")).toEqual({
      kind: "refused",
      scheme: null,
      text: "not a link",
    });
  });

  it("goes out for exactly the schemes the shell hands to the OS", () => {
    expect([...OUTBOUND].sort()).toEqual([...EXTERNAL_SCHEMES].sort());
  });
});
