import { isTokensFile, RAMP_TOKEN } from "./ramp.js";

/** CSS: flags a ramp step wherever it appears — in `var()` or as a declared property. */
export default {
  meta: {
    type: "problem",
    languages: ["css/css"],
    docs: {
      description:
        "Disallow --color-<ramp>-* tokens outside tokens.css (BRAND.md law 1)",
    },
    messages: {
      rampToken:
        "{{token}} is a ramp step; use a semantic token (BRAND.md law 1).",
    },
  },
  create(context) {
    if (isTokensFile(context.filename)) return {};
    const check = (node, name) => {
      if (name.match(RAMP_TOKEN)) {
        context.report({
          loc: node.loc,
          messageId: "rampToken",
          data: { token: name },
        });
      }
    };
    return {
      Identifier: (node) => check(node, node.name),
      Declaration: (node) => check(node, node.property),
    };
  },
};
