import type { Node } from "mdast";
import type {
  Extension as FromMarkdownExtension,
  Handle,
} from "mdast-util-from-markdown";
import { markdownLineEnding } from "micromark-util-character";
import { codes } from "micromark-util-symbol";
import type {
  Code,
  Construct,
  Extension,
  State,
  TokenizeContext,
  Tokenizer,
} from "micromark-util-types";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    inlineField: "inlineField";
    inlineFieldKey: "inlineFieldKey";
    inlineFieldMarker: "inlineFieldMarker";
  }
}

/**
 * mdast node for the `key:: ` that opens an inline field at the start of a
 * line. The value is the rest of the line, tokenized as ordinary text so a
 * link or tag inside it is still seen; the outline slices it from the source.
 */
export interface InlineField extends Node {
  type: "inlineField";
  key: string;
}

declare module "mdast" {
  interface PhrasingContentMap {
    inlineField: InlineField;
  }
  interface RootContentMap {
    inlineField: InlineField;
  }
}

function isKeyCharacter(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x5f ||
    code === 0x2d
  );
}

/** micromark syntax extension: `key:: value` on a line of its own. */
export function inlineFields(): Extension {
  const construct: Construct = {
    name: "inlineField",
    tokenize: tokenizeInlineField,
  };
  const text: Record<number, Construct> = {};
  for (let code = 0; code < 0x80; code++) {
    if (isKeyCharacter(code)) text[code] = construct;
  }
  return { text };
}

/** mdast-util-from-markdown extension: an `inlineField` node carrying the key. */
export function inlineFieldsFromMarkdown(): FromMarkdownExtension {
  return {
    enter: { inlineField: enterInlineField },
    exit: { inlineField: exitInlineField, inlineFieldKey: exitKey },
  };
}

const tokenizeInlineField: Tokenizer = function (
  this: TokenizeContext,
  effects,
  ok,
  nok
) {
  // Read now, before anything is consumed: the code before this construct.
  const previous = this.previous;
  return start;

  function start(code: Code): State | undefined {
    if (!(previous === codes.eof || markdownLineEnding(previous)))
      return nok(code);
    effects.enter("inlineField");
    effects.enter("inlineFieldKey");
    return key(code);
  }

  function key(code: Code): State | undefined {
    if (code !== codes.eof && isKeyCharacter(code)) {
      effects.consume(code);
      return key;
    }
    if (code !== codes.colon) return nok(code);
    effects.exit("inlineFieldKey");
    effects.enter("inlineFieldMarker");
    effects.consume(code);
    return secondColon;
  }

  function secondColon(code: Code): State | undefined {
    if (code !== codes.colon) return nok(code);
    effects.consume(code);
    return spaces;
  }

  function spaces(code: Code): State | undefined {
    if (code === codes.space || code === codes.horizontalTab) {
      effects.consume(code);
      return spaces;
    }
    effects.exit("inlineFieldMarker");
    effects.exit("inlineField");
    return ok(code);
  }
};

const enterInlineField: Handle = function (token) {
  this.enter({ type: "inlineField", key: "" }, token);
};

const exitKey: Handle = function (token) {
  (this.stack[this.stack.length - 1] as InlineField).key =
    this.sliceSerialize(token);
};

const exitInlineField: Handle = function (token) {
  this.exit(token);
};
