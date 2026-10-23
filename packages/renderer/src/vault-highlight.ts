import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import styles from "./VaultEditor.module.css";
import { vaultTags } from "./vault-grammar";

// A class the module lacks would colour nothing, quietly; the editor test
// asserts the tag and link classes land, so it is not quiet there.
const cls = (name: string) => styles[name] ?? "";

/** Lezer tags to the CSS Module's classes; the colours live there, as tokens. */
export const vaultHighlight = HighlightStyle.define([
  { tag: t.heading1, class: cls("h1") },
  { tag: t.heading2, class: cls("h2") },
  {
    tag: [t.heading3, t.heading4, t.heading5, t.heading6],
    class: cls("heading"),
  },
  { tag: t.strong, class: cls("strong") },
  { tag: t.emphasis, class: cls("emphasis") },
  { tag: t.strikethrough, class: cls("strike") },
  { tag: t.monospace, class: cls("code") },
  { tag: t.quote, class: cls("quote") },
  { tag: [t.processingInstruction, t.contentSeparator], class: cls("mark") },
  { tag: [t.link, t.url], class: cls("link") },
  { tag: vaultTags.tag, class: cls("tag") },
  { tag: vaultTags.wikilink, class: cls("wikilink") },
  { tag: vaultTags.blockId, class: cls("blockId") },
  { tag: vaultTags.fieldKey, class: cls("fieldKey") },
  { tag: vaultTags.frontmatter, class: cls("frontmatter") },
]);
