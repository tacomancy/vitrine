# Research: what to build the Editor on

*Where this lives:* `docs/research/` is new. `docs/` held `adr/` (decisions),
`agents/` (tool conventions), and `visual-implementation.md` (the brief's
SwiftUI translation); none of those is a home for findings that precede a
decision, so research notes get a folder of their own beside them. This file
is an input to the editing grill (`/grill-with-docs`), not a decision — the
ADR that resolves `BACKLOG.md` § "Editor approach" and § "External-edit
handling" should cite it. Researched 2026-09-13 against the macOS 26.5 SDK.
Every claim carries its source; secondary sources are marked **[secondary]**
with a confidence rating.

## Summary

SwiftUI's `TextEditor` gained an `AttributedString` binding in the macOS 26
SDK and can carry per-range fonts and token colors, but it cannot hide a
range, embed a view, or draw a custom focus ring, and its undo and find are
window-level conveniences. `NSTextView` on TextKit 2 is the canonical path: undo,
find bar, spell checking, IME, and accessibility come free, layout is
viewport-only, and three sanctioned hooks — `NSTextStorageDelegate` for real
attributes, rendering attributes for colors without relayout, paragraph
substitution or custom layout fragments for display-only changes — all
addressable from the parser's UTF-8 ranges after one UTF-16 conversion. Obsidian's Live Preview is a CodeMirror 6 decoration pipeline
(`Decoration.replace` on syntax markers, recomputed on every selection
change); TextKit 2 has no replacing decoration — paragraph substitution must
keep the character count — so a faithful hybrid means custom layout fragments
and selection-driven relayout, several times the cost of the mockup's Source /
Preview toggle. For Preview, Apple's swift-markdown (Apache 2.0 with runtime
exception, cmark-gfm underneath) yields a block tree with UTF-8-byte source
ranges and passes `[[wikilinks]]`, `![[embeds]]`, and `#tags` through as
literal text, so a pre-pass over Vitrine's own parsed ranges is the natural
seam; it builds in Swift 5 mode and its tree is not `Sendable`. For external edits, FSEvents with file-level events is
the only primitive that scales to a whole library without the other writer's
cooperation (`NSFilePresenter` fires only for coordinated writers, which
Obsidian is not); NSDocument's documented model is mtime-at-save plus a
warning, not a silent reload. Both hidden-syntax hybrids (Bear/Lettera, NotePlan) and
source-plus-preview splits (iA Writer, nvUltra, MacDown) have first-party
precedent; no closed vendor states its text engine.

## The question and its constraints

**What should Vitrine's note Editor be built on?** Screens 01 and 02 show a
SOURCE / PREVIEW toggle in the breadcrumb bar; `CONTEXT.md` says *"Source
Markdown is always what's on disk; any rendering (Preview) is a view over
it."* The choice is between a highlighted source editor with a separate
rendered Preview, an Obsidian-style hybrid that hides syntax except around the
cursor, or something between — and which Apple text stack carries it.

Constraints already fixed:

- **ADR 0001** — SwiftUI, AppKit only where SwiftUI can't do the job; the
  editor is the named first case. Core logic stays UI-free.
- **ADR 0002** — the file on disk is the only truth; Obsidian co-edits the
  same folder, so external edits must be noticed.
- **ADR 0004 / the brief** — every color a token; Inter for body, IBM Plex
  Mono for code; radii ≤ 5 px; focus is the 2 px brass ring (rule 7),
  already built as `BrassFocusRing` in `docs/visual-implementation.md`.
- **ADR 0006** — macOS 26 minimum, Swift 6 with complete concurrency
  checking, warnings as errors, `MainActor` default isolation in the app.
- **ADR 0011** — a third-party package only for an externally specified
  format matched exactly (a Markdown grammar qualifies; a UI library does
  not), pinned, its own ADR.
- **ADR 0012** — the Index is in memory; the parser (issue #19) yields tags,
  links, and embeds with **UTF-8 offset ranges**; frontmatter keeps its raw
  range and is never re-serialized.

## 1. SwiftUI `TextEditor` on macOS 26

**Can do.** `TextEditor(text: Binding<AttributedString>, selection:
Binding<AttributedTextSelection>?)` is new in macOS 26
([init](https://developer.apple.com/documentation/swiftui/texteditor/init(text:selection:))).
The honored scope is `AttributeScopes.SwiftUIAttributes`: `font`,
`foregroundColor`, `backgroundColor`, `kern`, `tracking`, `baselineOffset`,
`underlineStyle`, `strikethroughStyle`, `lineHeight`, `alignment`,
`adaptiveImageGlyph`
([scope](https://developer.apple.com/documentation/foundation/attributescopes/swiftuiattributes);
[WWDC25 280](https://developer.apple.com/videos/play/wwdc2025/280/)). Ranges
without a font or color inherit from the environment, so a token-colored Inter
body with Plex Mono code spans is expressible with `Font.custom`.
`AttributedTextFormattingDefinition` and `AttributedTextValueConstraint`
derive display attributes from a custom semantic attribute per run
([definition](https://developer.apple.com/documentation/swiftui/attributedtextformattingdefinition),
[constraint](https://developer.apple.com/documentation/swiftui/attributedtextvalueconstraint)),
but a constraint sees one run, not its neighbours — it cannot tokenize.
Re-highlighting means rewriting attributes on the bound string inside
`transform(updating: &selection)`, since "any mutation to an AttributedString
invalidates all of its indices"
([WWDC25 280](https://developer.apple.com/videos/play/wwdc2025/280/);
[transform](https://developer.apple.com/documentation/foundation/attributedstring/transform(updating:body:)-1b6eb)).
`AttributedString.utf8` is new in 26 and shares indices with the other views
([UTF8View](https://developer.apple.com/documentation/foundation/attributedstring/utf8view)),
so parser offsets map with `utf8.index(_:offsetBy:)`.

**Free behaviour.** `findNavigator`, `findDisabled`, `replaceDisabled` reach
macOS in 26, with the caveat that with several editors "the one that shows
the find and replace interface is nondeterministic"
([findNavigator](https://developer.apple.com/documentation/swiftui/view/findnavigator(ispresented:))).
No `TextEditor` page mentions undo; the only handle is
`EnvironmentValues.undoManager`
([docs](https://developer.apple.com/documentation/swiftui/environmentvalues/undomanager));
**[secondary, medium]** a forum thread without Apple reply reports it is
window-scoped ([713185](https://developer.apple.com/forums/thread/713185)).
`focusEffectDisabled` suppresses the system ring; nothing recolors it
([docs](https://developer.apple.com/documentation/swiftui/view/focuseffectdisabled(_:))).

**Can't do.** Nothing in the scope hides text, folds a range, or embeds a
view; line height and alignment are the only paragraph attributes. Apple makes
no large-document statement; the one hint is that the editor "may choose to
not apply constraints … to parts … not visible on screen"
([modifier](https://developer.apple.com/documentation/swiftui/view/attributedtextformattingdefinition(_:))).
That it wraps `NSTextView` on macOS is **[secondary, high]** — view-hierarchy
inspection, no document. Verdict: viable for colored source text; not for
hidden syntax, a brass ring, or a per-note undo contract.

## 2. `NSTextView` + TextKit 2 on macOS 26

**Architecture and the one-way trap.** `NSTextContentStorage` divides an
`NSTextStorage` into `NSTextParagraph`s; `NSTextLayoutManager` produces
`NSTextLayoutFragment`s without glyphs
([WWDC21 10061](https://developer.apple.com/videos/play/wwdc2021/10061/)).
Since macOS 13 "all text controls use TextKit 2 by default"
([WWDC22 10090](https://developer.apple.com/videos/play/wwdc2022/10090/)).
The class docs: "if you explicitly call the `layoutManager` property on a text
view or text container, the framework reverts to a compatibility mode that
uses NSLayoutManager", also on content such as `NSTextTable`
([NSTextView](https://developer.apple.com/documentation/appkit/nstextview)) —
"a one-way operation" ([WWDC22](https://developer.apple.com/videos/play/wwdc2022/10090/)).
Create with `NSTextView(usingTextLayoutManager: true)`
([init](https://developer.apple.com/documentation/appkit/nstextview/init(usingtextlayoutmanager:)))
and observe `willSwitchToNSLayoutManagerNotification` in Debug
([docs](https://developer.apple.com/documentation/appkit/nstextview/willswitchtonslayoutmanagernotification)).

**Ranges.** `NSAttributedString` ranges are UTF-16: the `utf16` view's
"elements match those accessed through indexed NSString APIs"
([String](https://developer.apple.com/documentation/swift/string)). UTF-8
offsets become `String.Index` via `utf8.index(_:offsetBy:)`, then
`NSRange(_:in:)`; the reverse `Range<String.Index>(_:in:)` is failable
([docs](https://developer.apple.com/documentation/swift/range/init(_:in:)-5qfor)).
Native strings are UTF-8; lazily bridged `NSString`s "require a separate
allocation/deallocation and transcoding"
([swift.org](https://www.swift.org/blog/utf8-string/)) — take
`textStorage.string` once per pass and convert on that snapshot.

**Three hooks.**
1. *Real attributes.* `textStorage(_:didProcessEditing:range:changeInLength:)`
   is "sent inside processEditing() right before notifying layout managers.
   Delegates can change the attributes" but not characters; `editedRange` is
   pre-edit
   ([docs](https://developer.apple.com/documentation/appkit/nstextstoragedelegate/textstorage(_:didprocessediting:range:changeinlength:))).
   Fonts (headings, Plex Mono) go here. **[secondary, medium]** an Apple
   engineer's forum reply reports per-token edits here are slow on large
   files ([52609](https://developer.apple.com/forums/thread/52609)).
2. *Rendering attributes.* `setRenderingAttributes(_:for:)`,
   `addRenderingAttribute(_:value:for:)`, `renderingAttributesValidator`
   ([docs](https://developer.apple.com/documentation/appkit/nstextlayoutmanager/renderingattributesvalidator)).
   The header: they "override the document text attributes stored in
   NSTextParagraphs" and "are invalidated upon re-layout of the text layout
   fragment" — suited to colors re-supplied from the validator. That they
   never affect layout is not stated by Apple (**[secondary, high]**).
3. *Display-only substitution.* `textContentStorage(_:textParagraphWith:)`
   returns a substitute paragraph whose string "must have a length of
   range.length"
   ([docs](https://developer.apple.com/documentation/appkit/nstextcontentstoragedelegate/textcontentstorage(_:textparagraphwith:)));
   `textLayoutManager(_:textLayoutFragmentFor:in:)` returns a fragment that
   overrides `draw(at:in:)` — WWDC21's comment bubbles
   ([docs](https://developer.apple.com/documentation/appkit/nstextlayoutmanagerdelegate/textlayoutmanager(_:textlayoutfragmentfor:in:))).

**Widgets and hiding.** `NSTextAttachmentViewProvider` places a real `NSView`
at an attachment, "only possible with TextKit 2"
([docs](https://developer.apple.com/documentation/appkit/nstextattachmentviewprovider);
[WWDC22](https://developer.apple.com/videos/play/wwdc2022/10090/)).
There is no range-folding API: a marker can be cleared or drawn over but keeps
its width. `invalidateLayout(for:)` / `ensureLayout(for:)` "can be expensive,
especially for large documents"
([WWDC21](https://developer.apple.com/videos/play/wwdc2021/10061/)). WWDC26
session 370 adds collapsing hooks on `NSTextView` — macOS 27, above ADR
0006's floor ([WWDC26 370](https://developer.apple.com/videos/play/wwdc2026/370/)).

**Performance.** "Layout in TextKit 2 is always noncontiguous … only for the
portions of text that are visible on the screen, plus an additional
over-scroll region" ([WWDC21](https://developer.apple.com/videos/play/wwdc2021/10061/)) —
the 200 KB case is a layout of the viewport, not the document.

**Free with the view.** `allowsUndo`; `usesFindBar`,
`isIncrementalSearchingEnabled`
([docs](https://developer.apple.com/documentation/appkit/nstextview/usesfindbar));
`isContinuousSpellCheckingEnabled`; `NSTextInputClient` for IME;
accessibility. Must be turned off for Markdown:
`isAutomaticQuoteSubstitutionEnabled`, `isAutomaticDashSubstitutionEnabled`,
`isAutomaticTextReplacementEnabled`
([NSTextView](https://developer.apple.com/documentation/appkit/nstextview)).

**Hosting in SwiftUI.** `NSViewRepresentable` is `@MainActor` and SwiftUI
"fully controls the layout of the AppKit view"
([docs](https://developer.apple.com/documentation/swiftui/nsviewrepresentable)).
First responder: "call the containing window's makeFirstResponder(_:) …
never invoke a text view's becomeFirstResponder()"
([NSTextView](https://developer.apple.com/documentation/appkit/nstextview)).
Focus ring: `focusRingType = .none` is for a view that "draw[s] its own", and
"you are responsible for drawing the focus ring in your view's draw(_:)"
([docs](https://developer.apple.com/documentation/appkit/nsview/focusringtype))
— the brass ring is Vitrine's to draw, in SwiftUI around the scroll view or
in the AppKit view. The `updateNSView` loop (writing `string` back on every
update resets selection and undo) is **[secondary, high]**.

**Swift 6.** Checked against the 26.5 SDK with `-strict-concurrency=complete`:
`NSTextView` is `@MainActor`; `NSTextStorage`, `NSTextLayoutManager`,
`NSTextContentStorage`, `NSTextRange` are neither isolated nor `Sendable`; the
TextKit delegate protocols carry no actor annotation; `NSTextViewDelegate`
methods are main-actor. A `@MainActor` coordinator that parses a `String`
copy off-main and applies attributes on main is the clean shape.

**Fonts.** `NSFont(name:size:)` takes a PostScript name; the faces Vitrine
registers with `CTFontManagerRegisterFontsForURL` resolve by the same names
([docs](https://developer.apple.com/documentation/appkit/nsfont/init(name:size:))).

## 3. What Obsidian's Live Preview is

Obsidian's help: "Live Preview shows formatted text inline while hiding most
Markdown syntax. When your cursor enters formatted content, the underlying
syntax becomes visible for editing"; Source mode "displays all Markdown syntax
exactly as written"; Reading view "shows your note without Markdown syntax"
([help](https://obsidian.md/help/edit-and-read)). It shipped in Insider
0.13.0 (2021-11-10), "highly experimental", without tables
([changelog](https://obsidian.md/changelog/2021-11-10-desktop-v0.13.0/));
table widgets came in 0.14.1, an in-place table editor in 1.5, and hiding is
suppressed while the editor is unfocused
([0.13.20](https://obsidian.md/changelog/2022-01-17-desktop-v0.13.20/)).
"Obsidian uses CodeMirror 6 (CM6) to power the Markdown editor"; Live Preview
is changed by editor extensions, Reading view by post processors over HTML
([extensions](https://docs.obsidian.md/Plugins/Editor/Editor+extensions),
[post processing](https://docs.obsidian.md/Plugins/Editor/Markdown+post+processing))
— Obsidian's Reading view is a separate render, as the mockup's Preview is.

**Mechanics.** CM6 renders only the viewport
([guide](https://codemirror.net/docs/guide/)). Decorations are `mark`,
`widget`, `replace` ("hide part of the document or replace it with a given
DOM node"), and `line`, in an immutable range set mapped across edits
([guide](https://codemirror.net/docs/guide/)). Replacing decorations that
affect vertical layout must come from a `StateField`
([Decorations](https://docs.obsidian.md/Plugins/Editor/Decorations),
[example](https://codemirror.net/examples/decoration/)); `atomicRanges` makes
a hidden marker one caret step. The syntax tree is Lezer's incremental parse
([Lezer](https://lezer.codemirror.net/docs/guide/)); `@lezer/markdown` is
"CommonMark with support for extension" via `parseInline`, where wikilinks
would go ([README](https://github.com/lezer-parser/markdown/blob/main/README.md)).
Obsidian's extension is closed; the recipe is inferred: walk the tree, emit
`replace` for marker nodes and `mark` for content, skip nodes touching the
selection, recompute on every transaction.

**Swift equivalent, and the cheaper alternative.** TextKit 2 has no replacing
decoration. A faithful hybrid needs markers drawn away by a custom
`NSTextLayoutFragment` (clear color keeps width), selection-driven
`invalidateLayout(for:)` on paragraphs entering and leaving the cursor,
view-provider attachments for images, and caret rules that skip hidden
markers — all hand-built under a substitution hook that cannot change length.
The mockup's toggle costs one `NSTextView` with the three hooks and a
read-only Preview view; the hybrid adds the fragment subclass, the selection
machinery, and the caret rules. NotePlan's theme keys `isHiddenWithoutCursor`
and `isRevealOnCursorRange` show the hybrid is achievable natively
([NotePlan](https://help.noteplan.co/article/45-extend-noteplans-markdown)),
engine undisclosed.

## 4. Parsing for Preview

**swift-markdown.** Apache 2.0 with Runtime Library Exception
([LICENSE](https://github.com/swiftlang/swift-markdown/blob/main/LICENSE.txt));
tag 0.8.0 (2026-05-07) pins `swift-cmark from: "0.8.0"`, `main` tracks
`branch: "gfm"`; `swift-tools-version:6.2` but `swiftLanguageModes: [.v5]`
([Package.swift](https://github.com/swiftlang/swift-markdown/blob/main/Package.swift));
used by DocC ([swift-docc](https://github.com/swiftlang/swift-docc/blob/main/Package.swift)).
Smart punctuation and source positions are **on** by default — pass
`.disableSmartOpts` to keep `"` and `--` literal
(`Sources/Markdown/Parser/ParseOptions.swift`, `CommonMarkConverter.swift`
418–432). Extensions attached: `table`, `strikethrough`, `tasklist`; no
autolink. `Markup.range` is `Range<SourceLocation>`, and `column` is "the
number of bytes in UTF-8 encoding from the start of the line"
(`Sources/Markdown/Infrastructure/SourceLocation.swift`) — Vitrine's unit.
Verified in a probe build: `[[Note One]]`, `![[img.png]]`, and `#tag` arrive
as literal text in one `Text` node; `#tag` is a paragraph because ATX headings
need a space after `#` ([spec §4.2](https://spec.commonmark.org/0.31.2/#atx-headings)).
Hazards for a post-parse rewrite: `[[a *b* c]]` splits across nodes, and a
note containing `[a]: url` turns `[[a]]` into a shortcut reference link
([spec §6.3](https://spec.commonmark.org/0.31.2/#links)). cmark syntax
extensions are not exposed; the seams are `MarkupVisitor`, `MarkupWalker`,
`MarkupRewriter` ([docs](https://github.com/swiftlang/swift-markdown/blob/main/Sources/Markdown/Markdown.docc/Visitors-Walkers-and-Rewriters.md)).
The natural seam is a pre-pass over Vitrine's own parsed ranges (which already
skip code) rewriting `[[…]]` to `[title](vitrine://…)`. **Swift 6:** `Document`
is not `Sendable` (`ManagedBuffer`-backed); crossing an actor fails under
strict concurrency and the compiler suggests `@preconcurrency import
Markdown` ([#170](https://github.com/swiftlang/swift-markdown/issues/170)) —
convert to a `Sendable` model on the parsing side. **Performance:** cmark
renders *War and Peace* "in 127 milliseconds on a ten year old laptop"
([cmark](https://github.com/commonmark/cmark#readme)).

**Alternatives.** cmark-gfm directly: a real inline-extension hook in C
(`cmark_syntax_extension_set_match_inline_func`,
[header](https://github.com/github/cmark-gfm/blob/master/src/cmark-gfm-extension_api.h))
— a wikilink extension Vitrine would own. Ink: "does not fully support all
Markdown specs, such as CommonMark", HTML only
([README](https://github.com/JohnSundell/Ink)) — fails the exact-format bar.
Down: cmark 0.29, not gfm, stale
([README](https://github.com/johnxnguyen/Down)). MarkdownUI: a SwiftUI UI
library ([README](https://github.com/gonzalezreal/swift-markdown-ui)) —
excluded by ADR 0011.

**Foundation.** `AttributedString(markdown:)` with `.full` attaches
`presentationIntent` for headers, code blocks, lists, quotes, tables
([Kind](https://developer.apple.com/documentation/foundation/presentationintent/kind)),
but `Text` "doesn't support line breaks, soft breaks, or any style of
paragraph- or block-based formatting like lists, block quotes, code blocks, or
tables" ([Text](https://developer.apple.com/documentation/swiftui/text/init(_:tablename:bundle:comment:))).
Rendering blocks from intents is the same work as walking swift-markdown's
tree, without its ranges.

## 5. Precedent from native Mac editors

| App | Engine (first-party) | Model | Source |
|---|---|---|---|
| Bear 2 / Lettera | "native"; engine not stated | Hybrid: "Markdown syntax hides when you are not editing" | [blog.bear.app](https://blog.bear.app/2026/06/introducing-lettera-a-native-markdown-editor-for-mac-now-in-beta/) |
| iA Writer | engine not stated; Preview is WebKit (`WebKitDeveloperExtras`) | Source + separate Preview | [ia.net](https://ia.net/writer/support/preview/modify-preview) |
| Ulysses | not stated | Markup visible: "not possible to hide all the markup" | [help.ulysses.app](https://help.ulysses.app/en_US/editor/markup) |
| NotePlan | not stated | Hybrid via `isHiddenWithoutCursor`, `isRevealOnCursorRange` | [help.noteplan.co](https://help.noteplan.co/article/45-extend-noteplans-markdown) |
| Craft | Mac Catalyst, custom `UIView`s | Block WYSIWYG | [craft.do](https://www.craft.do/blog/create-first-class-visionos-experience) |
| nvUltra / Marked 2 | Marked preview is WebKit; editor not stated | Source + preview | [brettterpstra.com](https://brettterpstra.com/2020/06/13/marked-2-as-an-even-better-teleprompter/), [nvultra.com](https://nvultra.com/help/welcome) |
| Apple Notes, TextEdit | `NSTextView`; TextEdit on TextKit 2 since Ventura | Rich text | [WWDC26 370](https://developer.apple.com/videos/play/wwdc2026/370/), [WWDC22 10090](https://developer.apple.com/videos/play/wwdc2022/10090/) |
| STTextView | TextKit 2, custom `NSTextLayoutManager` subclass | Source | [GitHub](https://github.com/krzyzanowskim/STTextView) |
| CodeEditTextView | custom `NSView` + Core Text, not TextKit | Source | [GitHub](https://github.com/CodeEditApp/CodeEditTextView) |
| MacDown | `MPEditorView: NSTextView` + `WebView` preview | Source + preview | [GitHub](https://github.com/MacDownApp/macdown) |
| Typora | Electron/Chromium | Hybrid | [typora.io](https://typora.io/), [support](https://support.typora.io/Trouble-Shooting/) |

No WWDC session names Xcode as a TextKit 2 adopter. Both models have
first-party precedent; no closed vendor discloses its engine.

## 6. External-edit primitives

**FSEvents.** Directory-level by default — "it tells you only that something
in the directory has changed" — coalesced by `latency`; "you will always
receive at least one notification after the last change"
([guide](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/TechnologyOverview/TechnologyOverview.html)).
`kFSEventStreamCreateFlagFileEvents` gives per-file paths with
`ItemCreated/Removed/Renamed/Modified` flags, "with care as it will generate
significantly more events"
([flag](https://developer.apple.com/documentation/coreservices/kfseventstreamcreateflagfileevents));
`NoDefer` delivers the first event at once
([flag](https://developer.apple.com/documentation/coreservices/kfseventstreamcreateflagnodefer)).
On `MustScanSubDirs` or a dropped-event flag "you must do a full scan"
([guide](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/UsingtheFSEventsFramework/UsingtheFSEventsFramework.html)).
It never names the writing process, but `IgnoreSelf` / `MarkSelf` distinguish
Vitrine's own writes
([flags](https://developer.apple.com/documentation/coreservices/fseventstreamcreateflags)).
Schedule with `FSEventStreamSetDispatchQueue`; the callback is a C function
pointer reached through an `Unmanaged` context, so the owner must be
`Sendable` and hop to an actor. Foundation ships no Swift wrapper in the 26.5
SDK.

**DispatchSource / kqueue.** `makeFileSystemObjectSource` needs an open
descriptor per item and tracks the inode
([docs](https://developer.apple.com/documentation/dispatch/dispatchsource/makefilesystemobjectsource(filedescriptor:eventmask:queue:)));
"if you are monitoring a large hierarchy of content, you should use file
system events instead"
([guide](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/KernelQueues/KernelQueues.html)).
An atomic save — "write data to an auxiliary file first and then replace the
original" ([atomic](https://developer.apple.com/documentation/foundation/nsdata/writingoptions/atomic))
— leaves a vnode source on a dead inode.

**NSFilePresenter.** "Your presenter objects are not notified about changes
made directly using low-level read and write calls to the file. Only changes
that go through a file coordinator result in notifications"
([docs](https://developer.apple.com/documentation/foundation/nsfilepresenter)).
Obsidian writes through Node's `fs`, uncoordinated; presenters are blind to it.

**NSDocument as reference.** `fileModificationDate` is "used to warn the user
when the on-disk representation of an open document has been modified by
something other than the current app"
([docs](https://developer.apple.com/documentation/appkit/nsdocument/filemodificationdate));
reload is user-driven via `revert(toContentsOf:ofType:)`
([docs](https://developer.apple.com/documentation/appkit/nsdocument/revert(tocontentsof:oftype:))).
No primary source says it silently reloads a clean document. The transferable
contract: an mtime/size baseline per open note; on modify or rename, reload if
the buffer is clean, else mark "changed on disk" and ask at save; on remove,
keep-or-close; on `MustScanSubDirs`, rescan against the Index. Obsidian's own
behaviour is undocumented — **[secondary, medium]** forum threads describe an
automatic-merge notice
([forum](https://forum.obsidian.md/t/has-been-modified-externally-merging-changes-automatically/111594)).

## Comparison

Effort is this researcher's estimate relative to the source editor (= 1×);
every other cell is sourced above.

| | SwiftUI `TextEditor` (AttributedString) | `NSTextView` + TextKit 2 source editor + separate Preview | TextKit 2 live-preview hybrid | Web view (CM6) |
|---|---|---|---|---|
| Highlighting from parser UTF-8 ranges | Yes; `utf8` view shares indices; app rewrites attributes per edit inside `transform(updating:)` | Yes; one UTF-8 → UTF-16 conversion per pass; fonts via `didProcessEditing`, colors via rendering attributes | Same, plus per-paragraph substitution | Yes, across a JS bridge |
| Hidden-syntax live preview | No — no hide, fold, or attachment attribute | Not needed; Preview is a separate rendered view | Partial: markers drawn over but keep width; selection-driven relayout hand-built | Native (`Decoration.replace`) |
| Undo / find / spell / IME / accessibility for free | Find in 26 (nondeterministic with several editors); undo window-scoped; spell via modifiers | All, including the find bar and `allowsUndo` | All; caret rules around hidden markers are custom | Browser-provided; no AppKit find bar or Services |
| Brief compliance (Inter, Plex Mono, tokens, brass ring, radii) | Fonts and colors yes; ring drawn around it in SwiftUI | Fonts and colors yes; `focusRingType = .none`, ring drawn by Vitrine | Same | CSS can match; system accessibility settings stop at the web view |
| SwiftUI hosting pain | None | `NSViewRepresentable` + coordinator; first-responder bridging; `updateNSView` loop | Same, plus selection observation | `WKWebView` in a representable; async bridge |
| External-edit reconciliation | Binding replacement resets selection unless tracked | Replace storage in a `beginEditing` block; preserve selection and undo | Same | Re-inject document |
| Dependencies under ADR 0011 | Preview: swift-markdown (grammar, qualifies) | Preview: swift-markdown | swift-markdown for the tree that drives hiding | CodeMirror + JS bundle — a UI library, excluded |
| Estimated effort | 0.5× for source; Preview extra | 1× (baseline) | 3–4× | Out under ADR 0001 (web runtime) |

## Open questions the grill should ask

1. Is the SOURCE / PREVIEW toggle the v1 product or a step toward a hybrid?
   That decides whether the source editor's hooks are built to grow into
   paragraph substitution or kept minimal.
2. Which ranges does the source editor colour: only what the parser emits
   (tags, links, embeds, frontmatter) or a full Markdown grammar? The latter
   means swift-markdown on every edit, or a second scanner in `NoteParsing`.
3. Is frontmatter editable inline, or shown as the property line with the raw
   range locked? ADR 0011's never-re-serialize promise is easy if the range is
   read-only in the editor.
4. Where is the brass ring drawn — around the scroll view in SwiftUI (one
   treatment app-wide) or by the AppKit view?
5. Does Preview render from swift-markdown's tree (a dependency ADR and a
   `Sendable` conversion) or from Foundation's presentation intents (no
   dependency, no ranges)? Wikilinks by pre-pass on Vitrine's ranges, or by
   `MarkupRewriter`?
6. External edits: reload a clean buffer silently, or always notify? A dirty
   buffer — NSDocument's ask-at-save, or a merge as Obsidian appears to
   attempt? Does the watcher live in `VitrineCore` (testable against a temp
   directory) or the app?
7. Save policy: debounced on keystroke, on focus loss, or ⌘S? Atomic or
   in-place? Atomic writes change the inode and interact with other watchers.
8. Is a 200 KB note the performance bar, measured as a test (XCTest `measure`
   is allowed when a spec asks, ADR 0006)?
9. Which `NSTextView` automatic behaviours are off (quotes, dashes, text
   replacement, link detection) — fixed, or a setting?
