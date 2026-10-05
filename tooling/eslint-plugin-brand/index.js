import { cssRule, stringsRule } from "./no-color-literals.js";
import noRampTokens from "./no-ramp-tokens.js";
import noRampTokensInStrings from "./no-ramp-tokens-in-strings.js";

export default {
  meta: { name: "eslint-plugin-brand" },
  rules: {
    "no-ramp-tokens": noRampTokens,
    "no-ramp-tokens-in-strings": noRampTokensInStrings,
    "no-color-literals": cssRule,
    "no-color-literals-in-strings": stringsRule,
  },
};
