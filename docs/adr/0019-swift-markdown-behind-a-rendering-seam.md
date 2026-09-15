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
