import css from "@eslint/css";
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
import brand from "./index.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const cssTester = new RuleTester({
  plugins: { css },
  language: "css/css",
});

cssTester.run("no-ramp-tokens (css)", brand.rules["no-ramp-tokens"], {
  valid: [
    { code: ".a { color: var(--color-fg); background: var(--color-bg); }" },
    { code: ".a { outline: 2px solid var(--color-focus); }" },
    // The one file allowed to define and reference ramp steps.
    {
      filename: "docs/reference/branding/tokens.css",
      code: ":root { --color-brass-300: #E5B64A; --color-accent: var(--color-brass-300); }",
    },
  ],
  invalid: [
    // The deliberate red case: a ramp step used directly in a component.
    {
      filename: "packages/renderer/src/TitleBar.module.css",
      code: ".title { color: var(--color-brass-300); }",
      errors: [
        { messageId: "rampToken", data: { token: "--color-brass-300" } },
      ],
    },
    {
      code: ".x { border-color: var(--color-ink-700); }",
      errors: [{ messageId: "rampToken", data: { token: "--color-ink-700" } }],
    },
    {
      code: ".x { background: var(--color-paper-raised); }",
      errors: [
        { messageId: "rampToken", data: { token: "--color-paper-raised" } },
      ],
    },
    // Redefining a ramp step outside tokens.css is also forbidden.
    {
      code: ":root { --color-sapphire-600: #000; }",
      errors: [
        { messageId: "rampToken", data: { token: "--color-sapphire-600" } },
      ],
    },
  ],
});

const tsTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tsTester.run(
  "no-ramp-tokens-in-strings (ts)",
  brand.rules["no-ramp-tokens-in-strings"],
  {
    valid: [
      { code: 'const c = "var(--color-primary)";' },
      { code: "const c = `${x} var(--color-fg-muted)`;" },
      { code: 'const notAToken = "ink-700";' },
    ],
    invalid: [
      {
        filename: "packages/renderer/src/App.tsx",
        code: 'const el = <span style={{ color: "var(--color-brass-300)" }} />;',
        errors: [
          { messageId: "rampToken", data: { token: "--color-brass-300" } },
        ],
      },
      {
        code: "const c = `1px solid var(--color-ink-700)`;",
        errors: [
          { messageId: "rampToken", data: { token: "--color-ink-700" } },
        ],
      },
    ],
  }
);
