import {
  markdownLineEnding,
  markdownLineEndingOrSpace,
} from "micromark-util-character";
import { codes } from "micromark-util-symbol";
import type { Code, Extension, State, Tokenizer } from "micromark-util-types";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    math: "math";
  }
}

/**
 * micromark syntax extension that makes `$…$` and `$$…$$` opaque: a `#` in
 * inline math is not a tag (T3i). No mdast node is produced — the outline
 * has no use for math, only for not reading it. Obsidian's delimiters: an
 * opening `$` is not followed by whitespace and a closing one not preceded
 * by it, so `$5 and $6` stays prose.
 */
export function math(): Extension {
  return {
    text: { [codes.dollarSign]: { name: "math", tokenize: tokenizeMath } },
  };
}

const tokenizeMath: Tokenizer = function (effects, ok, nok) {
  let dollars = 0;
  let previous: Code = codes.eof;
  return start;

  function start(code: Code): State | undefined {
    effects.enter("math");
    return opening(code);
  }

  function opening(code: Code): State | undefined {
    if (code === codes.dollarSign && dollars < 2) {
      effects.consume(code);
      dollars++;
      return opening;
    }
    if (
      code === codes.eof ||
      (dollars === 1 && markdownLineEndingOrSpace(code))
    )
      return nok(code);
    return inside(code);
  }

  function inside(code: Code): State | undefined {
    if (code === codes.eof) return nok(code);
    if (code === codes.dollarSign) {
      if (dollars === 2) {
        effects.consume(code);
        return closingSecond;
      }
      if (!markdownLineEndingOrSpace(previous)) {
        effects.consume(code);
        effects.exit("math");
        return ok;
      }
    }
    previous = code;
    if (markdownLineEnding(code)) {
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      return inside;
    }
    effects.consume(code);
    return inside;
  }

  function closingSecond(code: Code): State | undefined {
    if (code === codes.dollarSign) {
      effects.consume(code);
      effects.exit("math");
      return ok;
    }
    previous = codes.dollarSign;
    return inside(code);
  }
};
