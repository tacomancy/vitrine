# 0019: Preview renders through swift-markdown, behind a Rendering seam

**Status:** Accepted

## Context

ADR 0013 made Preview a separate rendered view over the source. Rendering
CommonMark with GFM tables, task lists, and strikethrough needs a grammar
implementation; ADR 0011's dependency policy admits one exactly for
"externally specified formats we must match." `docs/research/editor-approach.md`
§ 4 established the candidates and their facts: Apple's swift-markdown
(cmark-gfm underneath) gives a block tree with UTF-8-byte source positions,
passes `[[wikilinks]]`, `![[embeds]]`, and `#tags` through as literal text,
is not `Sendable`, and enables smart punctuation by default; Foundation's
`AttributedString(markdown:)` cannot yield blocks in SwiftUI `Text`; a web
view is out under ADR 0001.

## Decision

**swift-markdown**, pinned to an exact tag, with `.disableSmartOpts`, used
**only inside a `Rendering` seam** whose single function turns a note's
text and its `ParsedNote` into a **Vitrine-owned, `Sendable` block model** —
heading, paragraph, list and task list, code block, quote, table, thematic
break, image, and inline runs (text, emphasis, strong, code, strikethrough,
link, wikilink, tag). Every block carries its **source range** (UTF-8
offsets into the original text) so scroll sync and click-to-source can be
added later without touching the seam. The dependency never crosses the
seam; the app renders blocks as SwiftUI views.

**Wikilinks, embeds, and tags are handled by a pre-pass on the source text
over Vitrine's own parsed ranges** — which already skip code — rewriting
`[[Title|text]]` to a standard link with a `vitrine:` destination,
`![[image.png|800]]` to an image with a width, and `#tag` to a tag run,
before cmark sees the text. This avoids the two hazards of rewriting the
tree afterwards (`[[a *b* c]]` splitting across nodes; a stray `[a]: url`
turning `[[a]]` into a reference link). Frontmatter is cut before rendering.
Raw HTML is reduced to its text content.

Rejected: cmark-gfm directly with a C wikilink extension (more control for a
C target and an extension we maintain); Foundation intents (no blocks);
MarkdownUI and similar (UI libraries, excluded by ADR 0011).

## Consequences

- **+** Full CommonMark + GFM fidelity with none of it in our tests; source
  ranges in Vitrine's unit.
- **+** The renderer is replaceable in one module: the block model is the
  contract.
- **−** A second dependency and a Swift 5-mode package in the build;
  `@preconcurrency` or conversion at the seam — the seam converts.
- **−** HTML in notes renders as plain text; `<mark>` highlights are lost in
  Preview. Accepted; a web view is the only faithful alternative.
- The block model is kept minimal on purpose: adding kinds is additive;
  changing a kind's shape ripples into views.

## Update (2026-09-15, from the Rendering seam)

Four things the seam settled that the decision above left open:

- **The parser's ranges do not skip everything cmark reads as code.**
  `NoteParsing` knows inline code and fences at the start of a line; a
  `~~~` fence indented inside a list item or quote, indented code, and an
  HTML block are code to cmark but text to the scanner, and a `[[link]]`
  or `#tag` inside one was rewritten and then shown as its `vitrine:`
  form. The pre-pass now parses the body as written first, takes every
  code and HTML block's range from that tree, and rewrites no token inside
  one. Two cmark parses per render; the real vault still renders whole in
  under 100 ms.
- **A paragraph splits around its images.** The model has no inline
  image — an embed stands on its own line in every note seen — so an
  image inside a paragraph becomes an image block, and the runs of text
  around it paragraphs of their own, one that is only whitespace dropped.
- **A list is a task list only when every item has a checkbox.** cmark
  strips the `[ ]` from an item's text, so in a list that mixes checkbox
  items with plain ones the checkboxes are not drawn. Obsidian draws them;
  the mixed list has not appeared in a real note, and the honest model for
  it — a checkbox per list item — is additive if it does.
- **The `vitrine:` destination is the seam's own, not a reserved word in
  notes.** A note that writes `[x](vitrine:note?target=y)` itself renders
  it as a wikilink. Harmless, and not worth an escape.
