import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Tag as HighlightTag, styleTags } from "@lezer/highlight";
import type { Tree } from "@lezer/common";
import type {
  BlockContext,
  InlineContext,
  Line,
  MarkdownConfig,
} from "@lezer/markdown";
import {
  isBlockIdCharacter,
  isInlineFieldKeyCharacter,
  isTagCharacter,
  locateFrontmatter,
  parseInlineField,
  parseMarkdownLinkTarget,
  parseTag,
  type Range,
} from "markdown";

// The editor's second parser (docs/architecture.md § Vault surface, *Two
// parsers, one grammar*). `packages/markdown` stays the truth for everything
// the core counts; this file teaches Lezer the same four inline shapes by
// calling that package's grammar functions, so what the editor colours is
// what the index counts. `vault-grammar.parity.test.ts` holds the two to each
// other on the fixture corpus.
//
// Every position here is into the editor's text: LF-joined, BOM stripped. The
// core's offsets are into file bytes and are not interchangeable (CRLF).

const HASH = 35;
const BANG = 33;
const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;
const CARET = 94;
const NEWLINE = 10;
const CARRIAGE_RETURN = 13;
const SPACE = 32;
const TAB = 9;
const DOLLAR = 36;

export const vaultTags = {
  tag: HighlightTag.define("vaultTag"),
  wikilink: HighlightTag.define("vaultWikilink"),
  blockId: HighlightTag.define("vaultBlockId"),
  fieldKey: HighlightTag.define("vaultFieldKey"),
  frontmatter: HighlightTag.define("vaultFrontmatter"),
  plain: HighlightTag.define("vaultPlain"),
};

const isLineBreak = (code: number) =>
  code === NEWLINE || code === CARRIAGE_RETURN;

/** The code before `pos` in this inline section, or -1 at its start. */
function before(cx: InlineContext, pos: number): number {
  return pos > cx.offset ? cx.char(pos - 1) : -1;
}

/** `#tag` — Obsidian's character rule and `parseTag`'s verdict, after anything that is not a tag character (T5b). */
function parseTagAt(cx: InlineContext, next: number, pos: number): number {
  if (next !== HASH) return -1;
  const previous = before(cx, pos);
  if (previous >= 0 && isTagCharacter(previous)) return -1;
  let end = pos + 1;
  while (end < cx.end && isTagCharacter(cx.char(end))) end++;
  if ("invalid" in parseTag(cx.slice(pos + 1, end))) return -1;
  return cx.addElement(cx.elt("Tag", pos, end));
}

/** `[[…]]` and `![[…]]` on one line; the first `]]` closes it. */
function parseWikilinkAt(cx: InlineContext, next: number, pos: number): number {
  let open = pos;
  if (next === BANG) open++;
  else if (next !== OPEN_BRACKET) return -1;
  if (cx.char(open) !== OPEN_BRACKET || cx.char(open + 1) !== OPEN_BRACKET) {
    return -1;
  }
  const content = open + 2;
  if (cx.char(content) === CLOSE_BRACKET) return -1;
  for (let at = content; at < cx.end; at++) {
    const code = cx.char(at);
    if (isLineBreak(code)) return -1;
    if (code === CLOSE_BRACKET && cx.char(at + 1) === CLOSE_BRACKET) {
      return at === content
        ? -1
        : cx.addElement(cx.elt("Wikilink", pos, at + 2));
    }
  }
  return -1;
}

/**
 * `^id` after a space or at a line's start, with nothing but whitespace after
 * it to the end of the paragraph — the outline only counts an id that closes
 * its block (B-rows), so a mid-paragraph `^id` is plain text to both.
 */
function parseBlockIdAt(cx: InlineContext, next: number, pos: number): number {
  if (next !== CARET) return -1;
  const previous = before(cx, pos);
  if (
    previous >= 0 &&
    previous !== SPACE &&
    previous !== TAB &&
    !isLineBreak(previous)
  ) {
    return -1;
  }
  let end = pos + 1;
  while (end < cx.end && isBlockIdCharacter(cx.char(end))) end++;
  if (end === pos + 1) return -1;
  if (/\S/.test(cx.slice(end, cx.end))) return -1;
  return cx.addElement(cx.elt("BlockId", pos, end));
}

/**
 * The `key:: ` that opens a line. Whether the line is a *field* depends on the
 * block around it (a heading's `key::` and a callout's are prose); an inline
 * parser cannot see that, so `inlineFieldsIn` asks the tree.
 */
function parseInlineFieldAt(
  cx: InlineContext,
  next: number,
  pos: number
): number {
  if (!isInlineFieldKeyCharacter(next)) return -1;
  const previous = before(cx, pos);
  if (previous >= 0 && !isLineBreak(previous)) return -1;
  let keyEnd = pos;
  while (keyEnd < cx.end && isInlineFieldKeyCharacter(cx.char(keyEnd))) {
    keyEnd++;
  }
  if (cx.char(keyEnd) !== 58 || cx.char(keyEnd + 1) !== 58) return -1;
  // The rest of the line decides, exactly as the outline asks it.
  const lineEnd = lineEndFrom(cx, pos);
  const field = parseInlineField(cx.slice(pos, lineEnd));
  if (field === null) return -1;
  return cx.addElement(
    cx.elt("InlineField", pos, pos + field.valueStart, [
      cx.elt("InlineFieldKey", pos, keyEnd),
    ])
  );
}

function lineEndFrom(cx: InlineContext, from: number): number {
  let at = from;
  while (at < cx.end && !isLineBreak(cx.char(at))) at++;
  return at;
}

/**
 * `$…$` and `$$…$$` are opaque, so a `#` in math is not a tag (T3i). The
 * delimiter rule is `syntax/math.ts`'s, which exports a tokenizer and no
 * function to call, so it is written out here and held by the parity test.
 */
function parseMathAt(cx: InlineContext, next: number, pos: number): number {
  if (next !== DOLLAR) return -1;
  const dollars = cx.char(pos + 1) === DOLLAR ? 2 : 1;
  const spaceOrBreak = (code: number) =>
    code === SPACE || code === TAB || isLineBreak(code);
  const first = cx.char(pos + dollars);
  if (first === -1 || (dollars === 1 && spaceOrBreak(first))) return -1;
  let previous = -1;
  for (let at = pos + dollars; at < cx.end; at++) {
    const code = cx.char(at);
    if (code === DOLLAR) {
      if (dollars === 2) {
        if (cx.char(at + 1) === DOLLAR) {
          return cx.addElement(cx.elt("Math", pos, at + 2));
        }
      } else if (!spaceOrBreak(previous)) {
        return cx.addElement(cx.elt("Math", pos, at + 1));
      }
    }
    previous = code;
  }
  return -1;
}

/**
 * Frontmatter is shown as source and never parsed as Markdown: its `---`
 * would be a thematic break or a setext underline and a `# comment` a
 * heading. The fence rule is `locateFrontmatter`'s, as the outline's.
 */
function parseFrontmatterAt(cx: BlockContext, line: Line): boolean {
  if (cx.lineStart !== 0 || !line.text.startsWith("---")) return false;
  // Lezer hands a block parser one line and no way to look further, and the
  // fence rule needs the closing line. `input` is internal to the pinned
  // `@lezer/markdown`; the frontmatter test fails loudly if an upgrade moves it.
  const input = (
    cx as unknown as {
      input: { length: number; read(a: number, b: number): string };
    }
  ).input;
  const located = locateFrontmatter(input.read(0, input.length));
  if (located === null) return false;
  cx.addElement(cx.elt("Frontmatter", located.range.start, located.range.end));
  while (cx.nextLine() && cx.lineStart <= located.range.end);
  return true;
}

export const vaultGrammar: MarkdownConfig = {
  defineNodes: [
    { name: "Frontmatter", block: true },
    "Math",
    "Tag",
    "Wikilink",
    "BlockId",
    "InlineField",
    "InlineFieldKey",
  ],
  parseBlock: [
    {
      name: "Frontmatter",
      parse: parseFrontmatterAt,
      before: "HorizontalRule",
    },
  ],
  parseInline: [
    // Before Link: `[[` would otherwise open a bracket the link parser owns,
    // and `![[` would open an image.
    { name: "Wikilink", parse: parseWikilinkAt, before: "Link" },
    { name: "Math", parse: parseMathAt },
    { name: "Tag", parse: parseTagAt },
    { name: "BlockId", parse: parseBlockIdAt },
    { name: "InlineField", parse: parseInlineFieldAt },
  ],
  props: [
    styleTags({
      Frontmatter: vaultTags.frontmatter,
      Tag: vaultTags.tag,
      Wikilink: vaultTags.wikilink,
      BlockId: vaultTags.blockId,
      "Paragraph/InlineField/InlineFieldKey": vaultTags.fieldKey,
      // A `key::` in a callout is prose to the outline, so it is not coloured.
      "Blockquote/Paragraph/InlineField/InlineFieldKey": vaultTags.plain,
    }),
  ],
};

/** The language the editor loads; the parity test parses with the same object. */
export function vaultMarkdown() {
  return markdown({
    base: markdownLanguage,
    extensions: vaultGrammar,
    addKeymap: false,
  });
}

export interface GrammarItems {
  tags: Range[];
  links: Range[];
  blockIds: Range[];
  /** Where each field's key begins, and the key. */
  inlineFields: { start: number; key: string }[];
}

/**
 * What the tree finds, as the parity test and the click handlers read it.
 * `text` is the same editor text the tree was parsed from.
 */
export function itemsIn(tree: Tree, text: string): GrammarItems {
  const items: GrammarItems = {
    tags: [],
    links: [],
    blockIds: [],
    inlineFields: [],
  };
  tree.iterate({
    enter(node) {
      const range = { start: node.from, end: node.to };
      switch (node.name) {
        case "Tag":
          items.tags.push(range);
          break;
        case "BlockId":
          items.blockIds.push(range);
          break;
        case "Wikilink":
          items.links.push(range);
          break;
        case "Link":
        case "Image": {
          // Only a link with a destination is a link to follow; one with a
          // scheme goes out of the vault and the outline does not count it.
          const url = node.node.getChild("URL");
          if (url === null) break;
          const destination = text.slice(url.from, url.to);
          if (!parseMarkdownLinkTarget(destination).external) {
            items.links.push(range);
          }
          break;
        }
        case "InlineField": {
          const paragraph = node.node.parent;
          if (paragraph?.name !== "Paragraph") break;
          if (paragraph.parent?.name === "Blockquote") break;
          items.inlineFields.push({
            start: node.from,
            key: text.slice(
              node.from,
              node.node.getChild("InlineFieldKey")!.to
            ),
          });
          break;
        }
        default:
          break;
      }
    },
  });
  return items;
}
