import { COLOR_LITERAL, isTokensFile } from "./ramp.js";

/** CSS: a colour literal in a value, anywhere but tokens.css. */
export const cssRule = {
  meta: {
    type: "problem",
    languages: ["css/css"],
    docs: {
      description:
        "Disallow colour literals outside tokens.css (BRAND.md law 1)",
    },
    messages: {
      colorLiteral:
        "{{literal}} is a colour literal; bind a semantic token instead (BRAND.md law 1).",
    },
  },
  create(context) {
    if (isTokensFile(context.filename)) return {};
    const report = (node, literal) =>
      context.report({
        loc: node.loc,
        messageId: "colorLiteral",
        data: { literal },
      });
    return {
      Hash: (node) => report(node, `#${node.value}`),
      Function: (node) => {
        if (/^(?:rgba?|hsla?|oklch)$/i.test(node.name))
          report(node, `${node.name}()`);
      },
    };
  },
};

/** JS/TS: a colour literal in any string or template, e.g. an SVG `fill`. */
export const stringsRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow colour literals in strings outside tokens.css (BRAND.md law 1)",
    },
    messages: cssRule.meta.messages,
  },
  create(context) {
    if (isTokensFile(context.filename)) return {};
    const check = (node, text) => {
      for (const match of text.matchAll(COLOR_LITERAL)) {
        context.report({
          node,
          messageId: "colorLiteral",
          data: { literal: match[0] },
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
