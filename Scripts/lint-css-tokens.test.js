import { describe, expect, it } from "vitest";

import {
  ALLOWED,
  ALLOWED_MARKUP,
  lintCss,
  lintMarkup,
  lintMarkupTree,
  lintTree,
} from "./lint-css-tokens.mjs";

// Built, not written, so the repo's own colour-literal rule has nothing to flag.
const HEX = "#" + "1a2b3c";
const FN = "r" + "gb";

describe("lint-css-tokens", () => {
  it("passes CSS that reaches every property through tokens", () => {
    const css = `.a {
      padding: var(--space-2) var(--space-4);
      gap: var(--space-1);
      font-size: var(--text-sm);
      border-radius: var(--radius-md);
      color: var(--color-fg);
      border: 1px solid var(--color-line);
      width: 130px;
      grid-template-columns: 16px minmax(0, 1fr);
      outline-offset: 2px;
    }`;
    expect(lintCss(css)).toEqual([]);
  });

  it("fails a raw px in spacing, font-size and radius", () => {
    const css = `.a { padding: 7px; }\n.b { font-size: 11px; }\n.c { border-radius: 4px; }\n.d { gap: var(--space-1) 3px; }`;
    expect(lintCss(css).map((p) => p.line)).toEqual([1, 2, 3, 4]);
  });

  it("fails a hex value in a colour property", () => {
    expect(lintCss(`.a { background: ${HEX}; }`)).toHaveLength(1);
    expect(lintCss(`.a { border: 1px solid ${HEX}; }`)).toHaveLength(1);
  });

  it("fails colour functions, var() fallbacks, wrapped values and font shorthand", () => {
    expect(lintCss(`.a { color: ${FN}(1, 2, 3); }`)).toHaveLength(1);
    expect(lintCss(`.a { background: ${FN}a(0 0% 0% / .5); }`)).toHaveLength(1);
    expect(lintCss(`.a { color: var(--c, ${HEX}); }`)).toHaveLength(1);
    expect(lintCss(`.a { padding: var(--s, 3px); }`)).toHaveLength(1);
    expect(
      lintCss(`.a {\n  padding:\n    var(--space-1)\n    4px;\n}`)
    ).toHaveLength(1);
    expect(lintCss(`.a { font: 12px/1.4 sans-serif; }`)).toHaveLength(1);
    expect(lintCss(`.a { PADDING: 4px; }`)).toHaveLength(1);
  });

  it("passes a var() whose fallback is itself a token", () => {
    expect(lintCss(`.a { padding: var(--a, var(--space-2)); }`)).toEqual([]);
  });

  it("ignores hex and px inside comments", () => {
    expect(
      lintCss(`/* ${HEX} and padding: 3px */\n.a { color: var(--c); }`)
    ).toEqual([]);
  });

  it("names the file and line of a failure", () => {
    const [p] = lintCss(`.a {\n  padding: 3px;\n}`, "x.css");
    expect(p.message).toContain("x.css:2");
  });

  it("skips a declaration on the allow-list", () => {
    const allowed = [{ file: "x.css", prop: "gap", value: "2px", reason: "r" }];
    expect(lintCss(`.a { gap: 2px; }`, "x.css", allowed)).toEqual([]);
    expect(lintCss(`.a { gap: 3px; }`, "x.css", allowed)).toHaveLength(1);
  });

  it("holds the renderer's own CSS to it", () => {
    expect(lintTree("packages/renderer/src")).toEqual([]);
  });

  it("gives every allow-list entry a reason", () => {
    for (const a of ALLOWED) expect(a.reason.length).toBeGreaterThan(10);
  });

  it("keeps no allow-list entry the CSS no longer needs", () => {
    const found = lintTree("packages/renderer/src", []);
    for (const a of ALLOWED) {
      expect(
        found.some(
          (p) => p.file === a.file && p.prop === a.prop && p.value === a.value
        ),
        `${a.file} ${a.prop}: ${a.value}`
      ).toBe(true);
    }
  });

  describe("phase two: no bare button or fieldset (#792)", () => {
    it("fails a bare button", () => {
      const src = `export const A = () => <button type="button">Go</button>;`;
      const [p] = lintMarkup(src, "A.tsx");
      expect(p.message).toContain("A.tsx:1");
      expect(p.message).toContain("button");
    });

    it("fails a bare fieldset", () => {
      const src = `export const A = () => (\n  <fieldset>\n    <legend>x</legend>\n  </fieldset>\n);`;
      const [p] = lintMarkup(src, "A.tsx");
      expect(p.message).toContain("A.tsx:2");
      expect(p.message).toContain("fieldset");
    });

    it("passes a surface that uses the primitives", () => {
      const src = `import { Button, FormSection } from "./Form";\nexport const A = () => (\n  <FormSection title="x"><Button>Go</Button></FormSection>\n);`;
      expect(lintMarkup(src, "A.tsx")).toEqual([]);
    });

    it("ignores a button named in a comment", () => {
      expect(lintMarkup(`// a <button> here\nconst a = 1;`, "A.tsx")).toEqual(
        []
      );
    });

    it("tolerates only as many as the allow-list counts for the file", () => {
      const two = `<button/>\n<button/>`;
      const allowed = [{ file: "A.tsx", count: 2, reason: "r" }];
      expect(lintMarkup(two, "A.tsx", allowed)).toEqual([]);
      expect(lintMarkup(`${two}\n<button/>`, "A.tsx", allowed)).toHaveLength(3);
    });

    it("holds the renderer's own components to it", () => {
      expect(lintMarkupTree("packages/renderer/src")).toEqual([]);
    });

    it("gives every allow-list entry a reason", () => {
      for (const a of ALLOWED_MARKUP)
        expect(a.reason.length).toBeGreaterThan(10);
    });

    it("keeps no allow-list count the source has outgrown", () => {
      const found = lintMarkupTree("packages/renderer/src", []);
      for (const a of ALLOWED_MARKUP) {
        expect(found.filter((p) => p.file === a.file).length, a.file).toBe(
          a.count
        );
      }
    });
  });
});
