import css from "@eslint/css";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
import brand from "./index.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const err = (literal) => [{ messageId: "colorLiteral", data: { literal } }];

new RuleTester({ plugins: { css }, language: "css/css" }).run(
  "no-color-literals (css)",
  brand.rules["no-color-literals"],
  {
    valid: [
      { code: ".b1 { background: var(--color-surface); }" },
      { code: "#chart .b2 { fill: var(--color-accent); }" },
      { code: ".a { color: transparent; }" },
      {
        filename: "docs/reference/branding/tokens.css",
        code: ":root { --color-brass-300: #E5B64A; --c: rgb(1 2 3); --d: oklch(0.5 0.1 90); }",
      },
    ],
    invalid: [
      { code: ".a { color: #fff; }", errors: err("#fff") },
      { code: ".a { color: #E5B64A; }", errors: err("#E5B64A") },
      { code: ".a { color: rgb(1 2 3); }", errors: err("rgb()") },
      { code: ".a { color: hsl(40 70% 50%); }", errors: err("hsl()") },
      { code: ".a { color: oklch(0.5 0.1 90); }", errors: err("oklch()") },
      {
        code: ".a { background: linear-gradient(var(--x), #000); }",
        errors: err("#000"),
      },
    ],
  }
);

new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
}).run(
  "no-color-literals-in-strings (ts)",
  brand.rules["no-color-literals-in-strings"],
  {
    valid: [
      // A class-name binding to a semantic token is how chart colour is meant to arrive.
      { code: "const el = <rect className={styles.b1} />;" },
      { code: 'const c = "var(--color-seq-5)";' },
      { code: 'const sel = "#chart";' },
      { code: 'const entity = "&#123;";' },
      {
        filename: "docs/reference/branding/tokens.css",
        code: 'const c = "#E5B64A";',
      },
    ],
    invalid: [
      { code: 'const c = "#E5B64A";', errors: err("#E5B64A") },
      { code: "const c = `1px solid #fff`;", errors: err("#fff") },
      { code: 'const c = "rgb(1, 2, 3)";', errors: err("rgb(") },
      { code: 'const c = "rgba(1, 2, 3, 0.5)";', errors: err("rgba(") },
      { code: 'const c = "hsl(40 70% 50%)";', errors: err("hsl(") },
      { code: 'const c = "oklch(0.5 0.1 90)";', errors: err("oklch(") },
      { code: 'const el = <rect fill="#0C49A0" />;', errors: err("#0C49A0") },
    ],
  }
);
