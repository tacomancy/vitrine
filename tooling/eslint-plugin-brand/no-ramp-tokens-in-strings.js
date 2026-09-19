import { isTokensFile, RAMP_TOKEN } from "./ramp.js";

/** JS/TS: flags a ramp step inside any string or template, e.g. an inline style. */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow --color-<ramp>-* tokens in strings (BRAND.md law 1)",
    },
    messages: {
      rampToken:
        "{{token}} is a ramp step; use a semantic token (BRAND.md law 1).",
    },
  },
  create(context) {
    if (isTokensFile(context.filename)) return {};
    const check = (node, text) => {
      for (const match of text.matchAll(RAMP_TOKEN)) {
        context.report({
          node,
          messageId: "rampToken",
          data: { token: match[0] },
        });
      }
    };
    return {
      Literal: (node) => {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement: (node) => check(node, node.value.raw),
    };
  },
};
