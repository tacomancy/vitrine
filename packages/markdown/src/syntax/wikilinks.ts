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
  Tokenizer,
} from "micromark-util-types";

import { parseWikilink, type ParsedWikilink } from "../link.js";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    wikilink: "wikilink";
    wikilinkEmbedMarker: "wikilinkEmbedMarker";
    wikilinkMarker: "wikilinkMarker";
    wikilinkContent: "wikilinkContent";
  }
}

/** mdast node for `[[target#heading|alias]]` or `![[embed]]`, parsed and unresolved. */
export interface WikilinkNode extends Node, ParsedWikilink {
  type: "wikilink";
  embed: boolean;
}

declare module "mdast" {
  interface PhrasingContentMap {
    wikilink: WikilinkNode;
  }
  interface RootContentMap {
    wikilink: WikilinkNode;
  }
}

/** micromark syntax extension: `[[…]]` and `![[…]]` on one line. */
export function wikilinks(): Extension {
  const construct: Construct = { name: "wikilink", tokenize: tokenizeWikilink };
  // Registered on `!` as well so an embed is taken whole before CommonMark's
  // image construct can claim the `![`.
  return {
    text: {
      [codes.exclamationMark]: construct,
      [codes.leftSquareBracket]: construct,
    },
  };
}

/** mdast-util-from-markdown extension: a `wikilink` node from `parseWikilink`. */
export function wikilinksFromMarkdown(): FromMarkdownExtension {
  return {
    enter: { wikilink: enterWikilink, wikilinkEmbedMarker: enterEmbedMarker },
    exit: { wikilink: exitWikilink, wikilinkContent: exitContent },
  };
}

const closing: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    return first;
    function first(code: Code): State | undefined {
      if (code !== codes.rightSquareBracket) return nok(code);
      effects.consume(code);
      return second;
    }
    function second(code: Code): State | undefined {
      if (code !== codes.rightSquareBracket) return nok(code);
      effects.consume(code);
      return ok;
    }
  },
};

const tokenizeWikilink: Tokenizer = function (effects, ok, nok) {
  return start;

  function start(code: Code): State | undefined {
    effects.enter("wikilink");
    if (code === codes.exclamationMark) {
      effects.enter("wikilinkEmbedMarker");
      effects.consume(code);
      effects.exit("wikilinkEmbedMarker");
      return openFirst;
    }
    return openFirst(code);
  }

  function openFirst(code: Code): State | undefined {
    if (code !== codes.leftSquareBracket) return nok(code);
    effects.enter("wikilinkMarker");
    effects.consume(code);
    return openSecond;
  }

  function openSecond(code: Code): State | undefined {
    if (code !== codes.leftSquareBracket) return nok(code);
    effects.consume(code);
    effects.exit("wikilinkMarker");
    return contentStart;
  }

  function contentStart(code: Code): State | undefined {
    if (
      code === codes.eof ||
      markdownLineEnding(code) ||
      code === codes.rightSquareBracket
    ) {
      return nok(code);
    }
    effects.enter("wikilinkContent");
    return content(code);
  }

  function content(code: Code): State | undefined {
    if (code === codes.eof || markdownLineEnding(code)) return nok(code);
    if (code === codes.rightSquareBracket) {
      return effects.check(closing, atClose, more)(code);
    }
    return more(code);
  }

  function more(code: Code): State | undefined {
    effects.consume(code);
    return content;
  }

  function atClose(code: Code): State | undefined {
    effects.exit("wikilinkContent");
    effects.enter("wikilinkMarker");
    effects.consume(code);
    return closeSecond;
  }

  function closeSecond(code: Code): State | undefined {
    effects.consume(code);
    effects.exit("wikilinkMarker");
    effects.exit("wikilink");
    return ok;
  }
};

const enterWikilink: Handle = function (token) {
  this.enter(
    {
      type: "wikilink",
      embed: false,
      target: "",
      heading: [],
      blockId: null,
      alias: null,
    },
    token
  );
};

const enterEmbedMarker: Handle = function () {
  (this.stack[this.stack.length - 1] as WikilinkNode).embed = true;
};

const exitContent: Handle = function (token) {
  Object.assign(
    this.stack[this.stack.length - 1] as WikilinkNode,
    parseWikilink(this.sliceSerialize(token))
  );
};

const exitWikilink: Handle = function (token) {
  this.exit(token);
};
