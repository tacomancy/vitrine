import type { Node } from "mdast";
import type {
  Extension as FromMarkdownExtension,
  Handle,
} from "mdast-util-from-markdown";
import { markdownLineEnding, markdownSpace } from "micromark-util-character";
import { codes } from "micromark-util-symbol";
import type {
  Code,
  Construct,
  Extension,
  State,
  TokenizeContext,
  Tokenizer,
} from "micromark-util-types";

import { isBlockIdCharacter } from "../block-id.js";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    blockId: "blockId";
    blockIdMarker: "blockIdMarker";
    blockIdValue: "blockIdValue";
  }
}

/** mdast node for a `^id` marker at the end of a line. Which block it names is the outline's call. */
export interface BlockIdNode extends Node {
  type: "blockId";
  id: string;
}

declare module "mdast" {
  interface PhrasingContentMap {
    blockId: BlockIdNode;
  }
  interface RootContentMap {
    blockId: BlockIdNode;
  }
}

/** micromark syntax extension: `^id` after a space or at line start, ending its line. */
export function blockIds(): Extension {
  return {
    text: { [codes.caret]: { name: "blockId", tokenize: tokenizeBlockId } },
  };
}

/** mdast-util-from-markdown extension: a `blockId` node. */
export function blockIdsFromMarkdown(): FromMarkdownExtension {
  return {
    enter: { blockId: enterBlockId },
    exit: { blockId: exitBlockId, blockIdValue: exitValue },
  };
}

// Only whitespace may follow the id on its line; checked without consuming.
const restOfLineIsBlank: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    return start;
    function start(code: Code): State | undefined {
      if (!markdownSpace(code)) return atEnd(code);
      effects.enter("whitespace");
      return step(code);
    }
    function step(code: Code): State | undefined {
      if (markdownSpace(code)) {
        effects.consume(code);
        return step;
      }
      effects.exit("whitespace");
      return atEnd(code);
    }
    function atEnd(code: Code): State | undefined {
      return code === codes.eof || markdownLineEnding(code)
        ? ok(code)
        : nok(code);
    }
  },
};

const tokenizeBlockId: Tokenizer = function (
  this: TokenizeContext,
  effects,
  ok,
  nok
) {
  // Read now, before anything is consumed: the code before this construct.
  const previous = this.previous;
  return start;

  function start(code: Code): State | undefined {
    if (!(
      previous === codes.eof ||
      markdownLineEnding(previous) ||
      markdownSpace(previous)
    )) {
      return nok(code);
    }
    effects.enter("blockId");
    effects.enter("blockIdMarker");
    effects.consume(code);
    effects.exit("blockIdMarker");
    return valueStart;
  }

  function valueStart(code: Code): State | undefined {
    if (code === codes.eof || !isBlockIdCharacter(code)) return nok(code);
    effects.enter("blockIdValue");
    return value(code);
  }

  function value(code: Code): State | undefined {
    if (code !== codes.eof && isBlockIdCharacter(code)) {
      effects.consume(code);
      return value;
    }
    effects.exit("blockIdValue");
    return effects.check(restOfLineIsBlank, done, nok)(code);
  }

  function done(code: Code): State | undefined {
    effects.exit("blockId");
    return ok(code);
  }
};

const enterBlockId: Handle = function (token) {
  this.enter({ type: "blockId", id: "" }, token);
};

const exitValue: Handle = function (token) {
  (this.stack[this.stack.length - 1] as BlockIdNode).id =
    this.sliceSerialize(token);
};

const exitBlockId: Handle = function (token) {
  this.exit(token);
};
