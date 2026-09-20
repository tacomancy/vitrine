import css from "@eslint/css";
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import brand from "./tooling/eslint-plugin-brand/index.js";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "**/out/",
      "build/",
      "docs/reference/",
      "local-libraries/",
    ],
  },

  // Plain JS: the lint tooling, this config, and the scripts.
  {
    files: ["**/*.{js,mjs}"],
    ...js.configs.recommended,
    languageOptions: { globals: globals.node },
  },

  // TypeScript, type-aware, in every package.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.tsx"],
  })),
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["packages/renderer/**/*.tsx"],
    ...reactHooks.configs.flat.recommended,
  },

  // BRAND.md law 1, in CSS and in any string a component might hand to the DOM.
  {
    files: ["**/*.css"],
    ...css.configs.recommended,
    plugins: { css, brand },
    language: "css/css",
    rules: {
      ...css.configs.recommended.rules,
      // Tokens are defined in tokens.css, not the file being linted.
      "css/no-invalid-properties": ["error", { allowUnknownVariables: true }],
      // The renderer runs in one pinned Chromium (Electron) and, later, a
      // current Safari; "widely available" baseline is the wrong bar.
      "css/use-baseline": "off",
      "brand/no-ramp-tokens": "error",
    },
  },
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    plugins: { brand },
    rules: { "brand/no-ramp-tokens-in-strings": "error" },
  },
  {
    // The rule's own fixtures name ramp steps on purpose.
    files: ["tooling/eslint-plugin-brand/*.test.js"],
    rules: { "brand/no-ramp-tokens-in-strings": "off" },
  },

  prettier
);
