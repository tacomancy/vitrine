# 0013: The editor is NSTextView on TextKit 2, hosted in SwiftUI; Preview is a separate view

**Status:** Accepted

## Context

`BACKLOG.md` held "editor approach" as the question blocking editing: a plain
`NSTextView` with syntax highlighting vs. a rendered/WYSIWYG hybrid. ADR 0001
says SwiftUI, dropping to AppKit only where SwiftUI can't do the job, and
named the editor as the likely first case. `docs/research/editor-approach.md`
(PR #32) gathered the primary-source facts: what SwiftUI's `TextEditor` can
and cannot do on macOS 26, what TextKit 2 offers, what Obsidian's Live
Preview actually is, and what each costs.

## Decision

**The editor is an `NSTextView` on TextKit 2** (`usingTextLayoutManager:
true`), hosted in SwiftUI through `NSViewRepresentable` with a `@MainActor`
coordinator. It shows a note's **source Markdown** and colors the ranges
`NoteParsing` reports — tags, links, embeds, frontmatter, headings, fenced
and inline code — via TextKit 2's two sanctioned hooks: fonts through the
text-storage delegate, colors through rendering attributes. The parser's
UTF-8 offsets are converted to UTF-16 once per pass on a string snapshot.

**Preview is a separate rendered view** behind the mockup's SOURCE / PREVIEW
toggle — its own spec, its own renderer (a Markdown grammar dependency under
ADR 0011's policy), never the editor.

**The hooks stay minimal.** The coordinator applies attributes and reports
text changes; nothing is pre-wired for hidden syntax (ADR 0003).

**Fixed editor behavior.** Automatic quote and dash substitution, text
replacement, and link detection are off — they corrupt Markdown. Find bar,
incremental search, continuous spell checking, IME, and accessibility are
on and come from the view. Undo is per note (`allowsUndo`), cleared when a
different note opens. The system focus ring is disabled and the brass ring
(brief rule 7) is drawn by Vitrine in SwiftUI around the scroll view — the
one focus treatment app-wide. Fonts are the registered Inter and IBM Plex
Mono faces by PostScript name (ADR 0009).

**Rejected.** SwiftUI `TextEditor` with an `AttributedString` binding: it
can color ranges but cannot hide one, embed a view, or draw a custom focus
ring; its undo is window-scoped; there is no path from it to anything
richer — cheap because it is a dead end. A web view with CodeMirror 6: out
under ADR 0001 (web runtime) and ADR 0011 (a UI library, not a format), and
it loses the AppKit find bar, Services, and system accessibility settings at
the web-view boundary.

**Parked, not rejected.** The Obsidian-style live-preview hybrid — syntax
hidden except around the caret. TextKit 2 has no replacing decoration
(display-only substitution must keep the character count), so it means
custom layout fragments plus selection-driven relayout and hand-written
caret rules: the research estimates 3–4× the source editor. It **extends
this editor rather than replacing it** — same view, representable,
coordinator, and range conversion — so nothing decided here is lost if it
is ever wanted. Recorded in `BACKLOG.md`.

## Consequences

- **+** Undo, find, spell check, IME, and VoiceOver are the platform's, not
  Vitrine's; layout is viewport-only, so a 200 KB note costs what is on
  screen.
- **+** Highlighting reads the same parser ranges the Index reads: one
  scanner, one set of rules, one place to fix a rule.
- **−** The first AppKit bridge: first-responder handoff through the window,
  an `updateNSView` that must not write the string back on every update,
  and the focus ring by hand. All documented; all `/code-review` territory.
- **−** Source only in v1 until the Preview spec lands; the toggle appears
  with it.
- Saving and external edits are decided separately in ADR 0014. Preview's
  renderer is its own ADR when its spec is written.

## Update (2026-09-15, from the editor ticket, #41)

Building it fixed which text-storage delegate hook carries the fonts, and
found that the two hooks do not cover the same changes:

- **Fonts and links go in after the storage has processed an edit**
  (`textStorage(_:didProcessEditing:…)`), not before. An attribute set
  during `willProcessEditing` widens the storage's edited range, and
  `NSTextView` then places the caret at that range's end: typing `# ` at
  the start of a line sent the caret to the end of the line. Measured in a
  headless harness on the vault's largest note (52 KB), the pass costs
  about 2.5 ms per keystroke either way; the attributes are set only where
  the one in place differs, so a keystroke invalidates the layout of the
  lines it changed and not the whole note.
- **An undo changes the storage without telling the view's delegate**
  (`textDidChange` is not sent), so the storage delegate is the one hook
  that sees every change, and the parse is reported to the app from there.
  The layout manager has not caught up with the text at that point, so
  the rendering attributes — the colors — are set from `textDidChange`,
  where it has, or on the next turn of the run loop for a change that
  arrives without one.
- **The undo manager is the coordinator's own**, handed to the view through
  `undoManager(for:)`, so "cleared when a different note opens" is one
  `removeAllActions()` and the window's undo stack is never involved.

Nothing above changes the decision; it records the shape the hooks took.
