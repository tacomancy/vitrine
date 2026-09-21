import type { Node } from "mdast";
import type {
  Extension as FromMarkdownExtension,
  Handle,
} from "mdast-util-from-markdown";
import { codes } from "micromark-util-symbol";
import type {
  Code,
  Extension,
  State,
  TokenizeContext,
  Tokenizer,
} from "micromark-util-types";

import { isTagCharacter, parseTag } from "../tag.js";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    tag: "tag";
    tagMarker: "tagMarker";
    tagText: "tagText";
  }
}

/** mdast node for an inline `#tag`. */
export interface Tag extends Node {
  type: "tag";
  /** The tag as written, without its `#`. */
  text: string;
}

declare module "mdast" {
  interface PhrasingContentMap {
    tag: Tag;
  }
  interface RootContentMap {
    tag: Tag;
  }
}

/** micromark syntax extension: `#tag` in text, per Obsidian's grammar (`parseTag`). */
export function tags(): Extension {
  return {
    text: { [codes.numberSign]: { name: "tag", tokenize: tokenizeTag } },
  };
}

/** mdast-util-from-markdown extension: a `tag` node carrying the text as written. */
export function tagsFromMarkdown(): FromMarkdownExtension {
  return {
    enter: { tag: enterTag },
    exit: { tag: exitTag, tagText: exitTagText },
  };
}

const tokenizeTag: Tokenizer = function (
  this: TokenizeContext,
  effects,
  ok,
  nok
) {
  // Read now, before anything is consumed: the code before this construct.
  const previous = this.previous;
  let text = "";
  return start;

  function start(code: Code): State | undefined {
    // `a#b` is not a tag; `(#tag` and `<span>#tag` are (T5b).
    if (previous !== codes.eof && isTagCharacter(previous)) return nok(code);
    effects.enter("tag");
    effects.enter("tagMarker");
    effects.consume(code);
    effects.exit("tagMarker");
    return afterMarker;
  }

  function afterMarker(code: Code): State | undefined {
    if (code === codes.eof || !isTagCharacter(code)) return nok(code);
    effects.enter("tagText");
    return inside(code);
  }

  function inside(code: Code): State | undefined {
    if (code !== codes.eof && isTagCharacter(code)) {
      text += String.fromCharCode(code);
      effects.consume(code);
      return inside;
    }
    // `#1984` is not a tag (T2a): nothing consumed so far survives a nok.
    if ("invalid" in parseTag(text)) return nok(code);
    effects.exit("tagText");
    effects.exit("tag");
    return ok(code);
  }
};

const enterTag: Handle = function (token) {
  this.enter({ type: "tag", text: "" }, token);
};

const exitTagText: Handle = function (token) {
  const node = this.stack[this.stack.length - 1] as Tag;
  node.text = this.sliceSerialize(token);
};

const exitTag: Handle = function (token) {
  this.exit(token);
};
