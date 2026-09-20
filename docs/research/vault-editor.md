# Research: an editor for the Vault surface

Wayfinder ticket #133 (part of map #131, beat 11). Question: which Markdown editor library the Vault surface should use, CodeMirror 6 first, judged on React integration, decorating Obsidian syntax from `packages/markdown` rather than the editor's own parser, live-preview feasibility, large-file performance, license, maintenance — and whether it exposes document text and a change signal cleanly enough to be the one `replaceFile` caller (ADR 0008).

Method: package typings and source read from the published npm tarballs (versions named below, installed 2026-09-20), the libraries' own docs, and two timing runs in Node. Nothing here is from a third-party write-up. Where a fact was measured rather than read, the section says so.

`docs/research/` is new with this file; there was no prior home for research notes. ADRs stay the record of *decisions* — this file is the evidence a Vault-slice grill can point at.

## Recommendation

**CodeMirror 6, wrapped by hand in one small React component; syntax structure from a Lezer Markdown parser extended with `packages/markdown`'s grammar functions, not from a per-keystroke micromark reparse.** Details and the reasoning are in § CodeMirror 6 and § Feeding the editor from `packages/markdown`. The alternatives (ProseMirror/Tiptap, Milkdown, Monaco) each fail a constraint the brief or ADR 0008 fixes — see § Alternatives.

Reversibility: the choice of editor is the hard-to-reverse part (the editor's extension model shapes every Vault feature after it). The hand-rolled React wrapper and the parser-feeding strategy are both cheap to swap and are recommended as starting points, not commitments.

## Constraints the candidate must meet

From the repo, not from the libraries:

- **The editor's save is `replaceFile(content, basedOn)` and nothing else** — ADR 0008 decision 2; `docs/architecture.md` § Markdown: the write "skips the re-apply … and refuses on a hash mismatch, which the editor surfaces as 'changed on disk'". So the editor must hand back the *exact text the user typed*, byte for byte apart from what the user changed. A WYSIWYG editor that parses Markdown into a document model and serialises it back on save reformats the parts the user did not touch — the very thing ADR 0008 exists to prevent ("`remark-stringify` demonstrably reformats").
- **EOL, BOM and trailing newline are preserved on write** — § Markdown, file-level rules. The editor has to round-trip CRLF files.
- **Offsets are UTF-16 code units into the source string** — § Markdown, Locator. The outline's ranges have to line up with editor positions if the outline is to drive decorations.
- **One grammar** — ADR 0008 decision 7: the renderer "wraps the same functions for that editor's parser". The editor may have its own parser for *structure*; the tag/wikilink/block-id/inline-field grammar must be `packages/markdown`'s functions.
- **Feel like Obsidian** — `design-prompts.md` ## Prompt 7: "the part that should feel like Obsidian, because familiarity is the feature". Obsidian's editor is CodeMirror 6 ("Obsidian uses CodeMirror 6 (CM6) to power the Markdown editor" — [docs.obsidian.md, Editor extensions](https://docs.obsidian.md/Plugins/Editor/Editor+extensions)). Its Live Preview is a CM6 decoration layer, so the same feel is reachable with the same primitives.
- **Styling is CSS Modules with semantic tokens only** (`docs/architecture.md` § Styling, the brand lint rule). The editor must be themeable with plain CSS class hooks rather than shipping a theme we cannot override.
- **React 19** (`packages/renderer/package.json`: `react ^19.3.0`).

## CodeMirror 6

Versions read: `@codemirror/state 6.7.5`, `@codemirror/view 6.43.12`, `@codemirror/language 6.12.4`, `@codemirror/lang-markdown 6.5.2`, `@lezer/common 1.5.2`, `@lezer/markdown 1.7.2`. All MIT (each package's `package.json` `license` field).

### Document text and change signal

- **Text.** `EditorState.doc: Text`; `Text.toString()` — "Return the document as a string, using newline characters to separate lines"; `Text.sliceString(from, to?, lineSep?)`; `EditorState.sliceDoc(from?, to?)` uses the state's configured line break ([`@codemirror/state` typings](https://codemirror.net/docs/ref/#state.Text); confirmed in `dist/index.js`: `sliceDoc(...) { return this.doc.sliceString(from, to, this.lineBreak) }`).
- **Change signal.** `EditorView.updateListener` — "A facet that can be used to register a function to be called every time the view updates" — receives a `ViewUpdate` with `docChanged: boolean` and `changes: ChangeSet` ([`@codemirror/view` typings](https://codemirror.net/docs/ref/#view.EditorView^updateListener)). That is the clean signal the ticket asks for: one facet, one boolean, and the `ChangeSet` if the save path ever wants the delta.
- **EOL round trip.** `EditorState.lineSeparator`: "By default, any of `"\n"`, `"\r\n"` and `"\r"` is treated as a separator when splitting lines, and lines are joined with `"\n"`. When you configure a value here, only that precise separator will be used, allowing you to round-trip documents through the editor without normalizing line separators" ([typings](https://codemirror.net/docs/ref/#state.EditorState^lineSeparator)). Measured: with the facet set to `"\r\n"`, `state.sliceDoc()` returned `"ab\r\ncd\r\nef"` for that input. So the editor can honour the file-level EOL rule if the core tells it the file's EOL (the read already knows it). BOM and trailing newline are the caller's to strip and re-add around the editor; CM6 does nothing special with either.
- **Offsets — one trap, measured.** CM6 positions count every line break as **1** regardless of the configured separator: the same CRLF document above had `doc.length === 8`, identical to the LF version. So for a CRLF file, `packages/markdown` offsets computed on the raw file string will *not* equal editor positions. The fix is to parse `state.doc.toString()` (LF-joined) rather than the file bytes when the outline is meant to drive the editor; for LF files (all app-created files, § Markdown) the two are already identical. This must be a test in the Vault slice.

### Decorations — the mechanism for Obsidian syntax and live preview

- Four kinds: `Decoration.mark` (style a range), `Decoration.widget` (insert a DOM element), `Decoration.replace` ("replaces the given range with a widget, or simply hides it"), `Decoration.line` ([`@codemirror/view` typings](https://codemirror.net/docs/ref/#view.Decoration)). Hiding markup and drawing a widget in its place is exactly what Live Preview is.
- Supplied through the `EditorView.decorations` facet, "directly, or via a function that takes an editor view. Only decoration sets provided directly are allowed to influence the editor's vertical layout structure. The ones provided as functions are called *after* the new viewport has been computed, and thus **must not** introduce block widgets or replacing decorations that cover line breaks" ([typings](https://codemirror.net/docs/ref/#view.EditorView^decorations)). Consequence: tag/wikilink colouring and hiding inline markup can be viewport-only (a `ViewPlugin` over `view.visibleRanges`); anything that collapses lines (a rendered frontmatter block, an embedded image widget) goes in a `StateField` holding a `DecorationSet`, mapped through `tr.changes` on every transaction ([decoration example](https://codemirror.net/examples/decoration/): "the `update` method starts by mapping its ranges through the transaction's changes").
- `EditorView.atomicRanges` makes a hidden range behave "like atomic units for cursor motion and deletion purposes" (same typings) — the piece that keeps a hidden `[[` from being half-deleted.

### Large files

- Front page: "Remains responsive even on huge documents and long lines" ([codemirror.net](https://codemirror.net/)). Mechanism: only the viewport is rendered; `visibleRanges` is "the subset of the viewport that is actually drawn" and the guide says to restrict decoration work to it ([system guide](https://codemirror.net/docs/guide/)). `Text` is "a tree-shaped representation" with "structure-sharing immutable updates" ([reference](https://codemirror.net/docs/ref/#state.Text)).
- Parsing is incremental: `@lezer/common`'s `Parser.createParse(input, fragments, ranges)` takes `TreeFragment`s from the previous tree, and `@lezer/markdown`'s `MarkdownParser` implements that same signature (its `dist/index.d.ts`). Measured in Node, `@lezer/markdown` alone, synthetic Obsidian-flavoured prose: full parse 2.4 ms at 10 KB, 15 ms at 200 KB, 67 ms at 1 MB; incremental reparse after a one-character insertion 0.25 ms, 0.75 ms, 4 ms respectively.

### React integration

CodeMirror publishes no React binding and no React example; the view owns its own DOM, so integration is a `ref` + `useEffect` that creates an `EditorView` and destroys it on unmount, plus one `updateListener`. Two ways to get that:

- **`@uiw/react-codemirror` 4.25.11** (MIT, peer `react >=17`). Read in `esm/useCodeMirror.js`: it registers an `updateListener` and calls `doc.toString()` on every update to hand `onChange` a string — an O(n) string build per keystroke — and its controlled `value` prop replaces the whole document when the prop and the doc disagree. It also depends on `@codemirror/theme-one-dark` and its own `basic-setup` bundle. None of that is wrong for a form field; for a 200 KB note with a semantic-token theme it is baggage.
- **A hand-rolled component, ~40 lines.** Create the view once, push the file's text in via `view.dispatch({ changes: { from: 0, to: doc.length, insert } })` only when the *file* changes on disk, keep a `dirty` flag from `docChanged`, and call `state.sliceDoc()` at save time. This is what the code standard ("no abstraction until a second real use case") points to, and it keeps React out of the per-keystroke path — CM6 must not be re-rendered by React on each change.

Recommendation: hand-roll. Reconsider `@uiw/react-codemirror` only if a second CM6 instance with different needs appears.

### Styling

Themes are `EditorView.theme({...})` objects or plain CSS targeting `.cm-editor`, `.cm-content`, `.cm-line` etc.; `@codemirror/language`'s `HighlightStyle` maps Lezer tags to classes ([reference § language](https://codemirror.net/docs/ref/#language.HighlightStyle)). Either path accepts `var(--…)` values, so the semantic-token rule holds: the theme object lives in one TS file with `var(--color-…)` strings (already lint-covered for inline styles per § Styling), or a CSS Module scoped to the editor root.

### Maintenance and license

MIT throughout. `@codemirror/view` has 257 published releases; the three most recent were 2026-08-31, 2026-09-03, 2026-09-15 (`npm view @codemirror/view time`). `@lezer/markdown` 1.7.2 on 2026-07-15. Single maintainer (Marijn Haverbeke) with a sponsor programme that lists Obsidian among the gold sponsors; the front page states "a social (but no legal) expectation that you help fund its maintenance" for commercial use ([codemirror.net](https://codemirror.net/)). Single-maintainer risk is real and shared with every alternative below except Monaco.

## Feeding the editor from `packages/markdown`

The ticket asks for decorations "from an outline produced by `packages/markdown` rather than the editor own parser". Two ways to honour ADR 0008's one-grammar rule; they differ in cost, not in which grammar is used.

**A. Outline-driven.** On every `docChanged`, run `packages/markdown`'s locator over `state.doc.toString()`, turn the outline's tag/link/block-id/field ranges into a `DecorationSet` in a `StateField`. Measured (`mdast-util-from-markdown 2.x` + GFM, same synthetic text, Node): 12 ms at 10 KB, 45 ms at 50 KB, 200 ms at 200 KB, 1.6 s at 1 MB per full parse. micromark is not incremental — every keystroke pays the whole document. A typical note is well under 50 KB and this is workable there; a long Source note or a pasted transcript is not, and the frame budget is 16 ms. Debouncing helps latency but makes highlights lag typing, which Obsidian users will notice immediately.

**B. Grammar-driven.** Use `@codemirror/lang-markdown`'s parser (`@lezer/markdown`, already CommonMark + GFM, already incremental) and extend it: `MarkdownConfig` accepts `defineNodes`, `parseInline` and `parseBlock`; an `InlineParser` is `{ name, parse(cx, next, pos), before?, after? }` where `parse` "should return -1 if it doesn't handle the character, or add some element … and return the end position" (`@lezer/markdown` typings). Four small inline parsers — tag, wikilink, block id, inline field — whose *recognition and canonicalisation* is a call into `packages/markdown`'s exported grammar functions. The parser then decides context (not inside a code span or link destination) for us, which is the one job ADR 0008 decision 4 bought a CommonMark parser for. Highlighting rides on the syntax tree via `HighlightStyle`; live-preview hiding reads the same tree in a `ViewPlugin` over `visibleRanges`. Cost per keystroke is the incremental numbers above.

Recommendation: **B for the editor's own colouring and live preview; A stays the source of truth for everything the *core* does** (the index, backlinks, Loose Ends). This is precisely ADR 0008 decision 7's wording — the renderer "wraps the same functions for that editor's parser" — rather than a departure from it. Two parsers, one grammar: the fixture corpus (#112) should gain a check that the Lezer extension and the micromark extension recognise the same tags and links in the same places, so the editor never colours something the index does not count.

A third route — implementing `@lezer/common`'s abstract `Parser` on top of micromark so CM6 consumes the outline as a `Tree` — is possible in principle (`Tree.build` exists) but gains nothing over B: it inherits A's non-incremental cost and adds an adapter.

## Alternatives

### ProseMirror / Tiptap

- ProseMirror is a schema-based rich-text toolkit; `prosemirror-markdown` "implements a ProseMirror schema that corresponds to the document schema used by CommonMark, and a parser and serializer to convert between ProseMirror documents in that schema and CommonMark/Markdown text", parsing with markdown-it ([prosemirror-markdown README](https://github.com/ProseMirror/prosemirror-markdown), MIT).
- Tiptap "is built on top of ProseMirror"; its open source "is published on GitHub under the MIT license" with "paid Tiptap extensions" beside it ([tiptap.dev overview](https://tiptap.dev/docs/editor/getting-started/overview)). `@tiptap/markdown` 3.31.3 (MIT) exists: "parse Markdown strings into Tiptap's JSON format and serialize editor content back to Markdown", and it documents its own lossiness — "only one child node per cell is allowed as the Markdown syntax can't represent multiple child nodes" ([tiptap.dev/docs/editor/markdown](https://tiptap.dev/docs/editor/markdown)).
- Verdict: **fails the `replaceFile` constraint by construction.** The document the user edits is a ProseMirror node tree; the file on disk is whatever the serialiser prints. Anything the schema cannot represent (Obsidian's own syntax, comments, a user's chosen bullet character, setext headings, arbitrary whitespace) is normalised or dropped on the first save. That is the reserialisation ADR 0008 rejected, moved into the editor. It also does not feel like Obsidian — it is a Notion-style editor, and Prompt 7's design work "is restraint, not invention".

### Milkdown

"A plugin-driven WYSIWYG markdown Editor, inspired by Typora", "built on top of prosemirror and remark", MIT ([Milkdown README](https://github.com/Milkdown/milkdown)); `@milkdown/kit` 7.22.1, last published 2026-08-12. Same shape as Tiptap: Markdown is parsed by remark into a ProseMirror document and serialised back by remark-stringify — the exact library ADR 0008 names as never imported. Same verdict.

### Monaco

`monaco-editor 0.56.0`, MIT, last published 2026-07-20. Read `monaco.d.ts` `IModelDecorationOptions`: `className`, `inlineClassName`, `before`/`after` injected text, glyph/margin/minimap options — **no option that hides or replaces a range**, so live preview (collapsing `**`, `[[`, frontmatter) cannot be built on its decoration model. `wordWrap` "Defaults to 'off'". The shipped `min/vs` directory is 24 MB on disk (measured), most of it languages and workers irrelevant to prose. Built for code; a prose editor fights its defaults (line numbers, minimap, monospace assumptions) rather than using them. Not a fit.

### Lexical, Slate, others

Not investigated in depth: all are document-model editors with Markdown as an import/export transform and would meet the same `replaceFile` objection as Tiptap and Milkdown. Listed so a later reader knows they were considered rather than missed.

## Risks and open items for the Vault slice

1. **CRLF offsets** (measured above). Parse the editor's LF-joined text for editor decorations; save with `lineSeparator` set to the file's EOL. Test it.
2. **Two parsers, one grammar.** The Lezer inline parsers must delegate to `packages/markdown`'s grammar functions and be covered by the fixture corpus, or the editor and the index will drift — the outcome ADR 0008 decision 7 forbids.
3. **Live preview scope.** Hiding inline markup is viewport-only and cheap. Rendering frontmatter as a Properties block, embeds, or tables as widgets needs `StateField` decorations and is where complexity lives; the slice should start with inline hiding and add block widgets one at a time.
4. **Theme by tokens.** Decide in the slice whether the `HighlightStyle` lives as a TS theme object with `var(--…)` values (inline-style lint applies) or as a CSS Module; either keeps semantic tokens.
5. **Graph view** stays undecided (#131 "Not yet specified"); nothing here constrains it.
