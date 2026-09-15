# CLAUDE.md

Instructions for any agent — Claude Code or otherwise — working on Vitrine.

Vitrine is a native macOS app for personal knowledge management, research,
note-taking, and continuous learning. It follows the precedent of Obsidian and
LogSeq, and will eventually add agentic source collection, high-level dashboards,
and research-idea tracking. **v1 is the Obsidian-like core only: notes, tags,
links, and library navigation.** Everything else is parked in `BACKLOG.md`.

## Read first, in order

1. `CONTEXT.md` — domain vocabulary. Use these exact terms in code, docs, tests,
   and commit messages; don't invent synonyms for concepts already named there.
2. `docs/adr/` — why specific decisions were made. Check the `Status` line before
   trusting a `Decision`; a superseded ADR is kept for history, not for guidance.
3. `BACKLOG.md` — what is deliberately *not* being built yet, and the open
   questions nobody has answered. Read it so you don't re-derive or quietly
   resolve something that's parked on purpose.
4. `CODING_STANDARDS.md` — required before writing or reviewing code.
5. `design/vitrine-design-system-brief.md` — required before any UI work. It
   is the visual authority (ADR 0004): tokens, type, the seven rules, the
   accessibility contract. `design/README.md` and the screenshots are layout
   reference for the v1 screens named in ADR 0004 — and aspiration for the
   rest. `docs/visual-implementation.md` is how the brief is translated
   into code — use its assets, fonts, and constants rather than re-deriving
   them.

## Current state

**The first feature is built (issue #8): open a library, browse its file
tree, select a note, and read it.** The `Library` seam (issue #10) scans a
folder into folders, notes, and attachments in display order and reads a
note's text, every scan rule a red-first test in `LibraryTests` against
two fixtures — one purpose-built, one written by Obsidian. The window
shell (issue #11) draws the title bar and tab strip over the gutter split
view, per ADR 0008, with `docs/visual-implementation.md` recording the
translation. First run and the launch/open rule (issue #12) are app glue
at the seam: `CurrentLibrary` holds the one open library, reopens the
remembered one at launch, and stores a path only when an open succeeds.
Selecting and reading (issue #13) is more glue: `NotesSelection` is the
one piece of view state the three panes share — the sidebar row, which
scopes the note list, and the note open in the read-only editor — and
everything on screen derives from it and `Library`. `Scripts/test.sh` is
the verification command CI runs, with a coverage gate that finds the
package's lines by source path — `xccov` files them under the package
target or its test target depending on the run (ADR 0006, second Update).
`Scripts/mutate.sh` is the non-gating mutation run — Muter, pinned to a
pull-request head because upstream master applies no mutants (ADR 0015,
Update) — weekly and by hand, its survivors triaged into issues #56–#63.
ADRs 0001–0017 are Accepted.

**The second feature is built (issue #18, parse notes and browse by
tag).** The `NoteParsing` seam (issue #19) is `ParsedNote.parse(text)`:
frontmatter via Yams (ADR 0011), body tags, links, and embeds from a
fence-aware scanner, every token with its UTF-8 range — 38 inline-string
tests in `NoteParsingTests`, and the package's first dependency. The tag
grammar (`CONTEXT.md` § Tags) lives once, in `TagGrammar`, and both
readers use it: a frontmatter value that fails it is dropped, as Obsidian
does (issue #36). The `Index` seam (issue #20) is
`Index.build(from: Library)`: every note read and parsed once, tags
aggregated per segment with the display spelling first seen in library
display order (`CONTEXT.md` § Tags), answering `tags(of:)`, `tagTree`,
`notes(tagged:)`, `untagged`, and `skipped` — a value, in memory only
(ADR 0012); links and embeds waited for the spec that needed them
(ADR 0003, then #26 below). Its 12 tag tests in `IndexTests` open the
Obsidian fixture through `Library` and assert counts written by hand
(PR #34, plus `Topics/Agents.md` from #20). The fixture lives in the `Fixtures` test-support target (ADR 0006,
Index-seam Update). The screen (issue #21) is glue at the seam:
`CurrentLibrary` builds the Index synchronously with every successful
open, `SidebarSelection` grew Untagged and a tag so the sidebar stays one
scope, `TagTree` draws TOPICS the way `FileTree` draws FILES, and every
`NoteRow` carries its tag row — nothing in the app target parses or
aggregates, and `docs/visual-implementation.md` records the translation.

**The third feature is built (issue #25, follow links and see
backlinks; tickets #26 and #27).** `NoteParsing` reads wikilinks out of every
frontmatter string value — each a `Link` flagged `isFromFrontmatter`,
placed by Yams' scalar marks — five additive tests, none existing
touched. `Index.build` resolves every link and embed per `CONTEXT.md`
§ Links (path → title → alias → attachment name, case-insensitively;
Markdown links relative to the note; external excluded; same-title ties
by depth then display order, ADR 0016) and answers `links(from:)`,
`backlinks(to:)` — one per linking note, sorted by title, with one
context line per linking line — and `unresolvedLinks`; 18 tests in
`IndexTests`, 15 against the Obsidian fixture as blessed and 3 on
temporary copies of it. Fix #47 (PR #50) taught the scanner Obsidian's
table-cell escape, `[[x.ipynb\|shown]]`: the target and an embed's
filename end before the backslash, `CONTEXT.md` § Links names the form,
and three more `NoteParsingTests` pin it. Against the real vault: 304
links, 31 from frontmatter, 65 to attachments, 9 unresolved — every one
a note that does not exist. The screen (issue #27) is glue at the seam,
untested by decision and verified by `/run`: `NoteBody` draws the open
note as attributed `Text` assembled from the parser's ranges — every
link token styled for what `Index.links(from:)` says it is, unresolved
ones `fg-muted` and dashed, external ones from the parser's
`isExternal` — over a `vitrine-link://` scheme the view intercepts, no
`NSTextView` (ADR 0013 stays open); `NotesSelection` grew back / forward
history (⌘[ / ⌘] in a Go menu, through a focused scene value), every
way of opening pushing; `Rail` is the fourth floating surface with
BACKLINKS and INFO from the Index; `docs/visual-implementation.md`
records all three.

**The fourth feature is under way (issue #38, edit notes, create notes,
and follow external changes): ① built.** `Library` now writes (issue
#39): `write(_:to:)` overwrites a note in place — same inode, bytes as
given, line endings included (ADR 0014); `createNote(named:in:)`,
`uniqueUntitledName(in:)`, and `renameNote(_:to:)` create and rename
within a folder with the title rule in `CONTEXT.md` § Note and no link
rewriting; `applying(_:)` folds a `LibraryChange` into the tree by
rescanning the folder around it. `LibraryWatcher.watch(_:)` is the new
seam and target: an `AsyncStream<LibraryChange>` from an FSEvents stream
on the root — file-level, coalesced within 100 ms, this process's own
writes marked and dropped, dot-entries and symlinks invisible — ending
when its consumer is cancelled. FSEvents is named only there. Every
"another tool changed a file" test drives a real second process
(`OtherTool`, in `Fixtures`), since the own-write mark is per process.
Nothing on screen consumes any of this yet.

**② is built (issue #40).** `ParsedNote` gains `structure` — headings
(level and whole-line range), fenced code blocks (both fences), inline
code spans (both backtick runs) — from the one fence-aware scanner, and
carries the `text` it was parsed from, so a parse is complete on its own
(ADR 0017). `Index` keeps the library as parsed (`ParsedLibrary`: notes
in display order, each parse by path, the attachments) and `updating`,
`adding`, `removing`, and `renaming` each fold one note into it and
recompute every table — no I/O, no other note re-parsed; a note the
tree was scanned without is placed by `LibraryDisplayOrder`, the display
rule read off two paths. Seven `IndexTests` and five `NoteParsingTests`
cover it; the no-I/O test deletes the library copy before operating.

**③ is built (issue #41): the editor edits.** `NoteBody` is gone;
`NoteTextView` bridges an `NSTextView` on TextKit 2 (ADR 0013) whose
`Coordinator` parses the whole text after every change to its characters
— an undo included, which only the storage delegate sees — sets fonts and
links in the storage where they differ (`StyledRange.fontSpans`) and colors
as rendering attributes, and reports the parse up (ADR 0013, Update, for
why the hook is `didProcessEditing`). Two seam additions, red-first:
`Index.resolve(_:from:)` answers what a link or embed the tables have not
seen points at, so a link is colored as it is typed; `Library.note(at:)`
and `folder(at:)` find the tree's current copy by path. The glue:
`NoteBuffer` is the buffer (`CONTEXT.md` § Editor) — one per window,
dirty from an edit to the save 1 s later, or at once on note switch,
window or app deactivation, quit, ⌘S, and before Open Library… —
`CurrentLibrary.save` writes in place and folds the parse into the Index
(ADR 0014, ADR 0017), and `NotesSelection.refresh(from:)` finds what it
holds again by path after the write, since panes compare `Note` and
`Folder` by value; the window shell tells a save from a library switch by
root URL. `docs/visual-implementation.md` records the fixed settings, the
range → attribute table, and the ring.

**④ is built (issue #42), and with it the fourth feature.** One seam
addition, red-first: `Index.applying(_:in:)` folds a `LibraryChange`
into the Index through the library that already reflects it — a
modified or added note read and parsed, a removed one dropped, a
renamed one keeping its parse, a folder's notes likewise, a changed
folder reconciled by modification date, attachments taken whole from
the tree (ADR 0017, Update; ten `IndexTests` on temporary copies). Two
smaller ones: `Note.folderPath`, and the watcher's translator now
remembers Vitrine's own creates and renames — still never reported —
so Finder deleting a note ⌘N made yields its change (one more
`LibraryWatcherTests` test). The glue: `CurrentLibrary` starts a
`LibraryWatcher` with every open, cancels it on switch, and applies
each change to library and Index together; `NoteBuffer` reconciles the
open note against every replaced library — clean reloads silently,
dirty keeps its text behind *Changed on disk* · Overwrite · Reload,
gone keeps it behind *Removed from disk* · Save as new · Close, and
every save waits while a bar is up (ADR 0014); ⌘N creates `Untitled`
in the sidebar's folder and opens it with the title field focused,
following an unresolved link creates its note, and `TitleField` renames
on Return or focus loss, refuses inline, and reverts on Escape.
`ConflictBar` and `PrimaryButton` are the brief's status and action
treatments; `docs/visual-implementation.md` records all of it. Verified
by a 70-check headless harness over the real glue and on screen against
the vault snapshot; the two-app scenario with Obsidian on the live vault
is the owner's to confirm.

Next: the Preview spec — the rendered view behind the mockup's
SOURCE / PREVIEW toggle, its own renderer under ADR 0011's policy (ADR
0013) — through `/grill-with-docs` and `/to-spec` first.
`/implement` per ticket on its own
branch, clearing context between tickets. Update this section whenever
the answer to "where are we?" changes — it's the first thing a fresh
agent reads.

## Engineering discipline

- **Decisions live in ADRs, not in code comments or chat.** Anything a future
  agent might reasonably question — a library, a file format, a scope cut, a
  naming choice with consequences — gets a numbered ADR in `docs/adr/` using
  `docs/adr/0000-template.md`. Small enough to write in ten minutes; that's the
  point.
- **Reversing or extending a decision means a new ADR.** Mark the old one
  `Superseded by NNNN` or add an `Update` section pointing forward. Never edit
  an ADR's `Decision` or `Consequences` to make the original reasoning look
  different than it was.
- **`CONTEXT.md` is the vocabulary, and it grows deliberately.** If implementation
  surfaces a concept that isn't named there, propose a term and add it *before*
  the name spreads through code. Names reserved for later versions (see its
  § Reserved) are off-limits for v1 concepts.
- **Stay inside the v1 boundary.** Don't build toward dashboards, source
  collection, or research-idea tracking because it seems convenient — even a
  "just in case" field or table. If v1 work genuinely needs a hook for a later
  feature, that's an ADR, not a quiet addition.
- **Test-driven, always.** Red before green, one vertical slice at a time, at
  seams agreed with the owner before the first test is written — exactly as
  `.claude/skills/tdd/SKILL.md` prescribes. No implementation code without a
  failing test that was actually run red. Parsing, indexing, link resolution,
  tag extraction, and search live in a UI-independent module so they can be
  tested this way; SwiftUI views stay thin.
- **Code quality is reviewed before a PR, not after.** `CODING_STANDARDS.md`
  is the written bar for clarity, simplicity, naming, and comments;
  `/code-review` checks the diff against it (plus its own smell baseline) and
  against the spec. A PR opens only after that review has run and every
  finding is either fixed or explicitly declined in the PR body.
- **Obsidian compatibility is a constraint, not a feature.** A library Vitrine
  has written must still open cleanly in Obsidian, and vice versa (ADR 0002).
  When in doubt about a file-format detail, match Obsidian's behavior and note
  it in `CONTEXT.md`.
- **Visual work follows the brief, not taste.** Every color is a token from
  `design/vitrine-design-system-brief.md`; every type size is on its scale;
  sapphire is every action and brass is punctuation. If a v1 screen needs
  something the brief doesn't cover, extend the brief deliberately (and say so
  in the commit), then build against it — never invent one-off styling that
  lives only in a view.
- **Stubs stay stubs.** The non-v1 tabs exist (ADR 0005) and show a SOON
  placeholder. That is the only code allowed to mention a reserved name.

## Workflow

Matt Pocock's skills are vendored in `.claude/skills/` (25 promoted skills,
upstream `mattpocock/skills@3cca18b`, pinned in `skills-lock.json`; refresh
with `npx skills update`, then re-read this section). `/ask-matt` is the router
if you're unsure which one fits. The route every change takes:

1. **Sharpen** — `/grill-with-docs`. Interview until the design tree has no
   open branches; it writes new terms to `CONTEXT.md` and decisions to
   `docs/adr/` as it goes. If a question needs a runnable answer, detour
   through `/prototype` on a `prototype/<name>` branch.
2. **Specify** — `/to-spec`. Turns the thread into a spec and publishes it as a
   GitHub issue. **No implementation starts without a spec issue.** For
   multi-session work, `/to-tickets` then splits it into tracer-bullet tickets
   with blocking links.
3. **Build** — `/implement` per ticket, on a branch. It drives `/tdd` at the
   agreed seams and closes by running `/code-review` (Standards + Spec) on
   the diff. Clear context between tickets.
4. **Ship** — open the PR only after step 3's review. Branch names and PR
   titles carry the type prefix from `CODING_STANDARDS.md` § 7
   (`feat/…`, `fix/…`, `docs/…`; `feat(index): …`). The PR body links the
   spec issue and lists any review findings declined, with why.

Bugs that resist a first look go through `/diagnosing-bugs` (feedback loop
first, then hypothesis). Issues you didn't write go through `/triage`. When
there's a spare moment, `/improve-codebase-architecture` surveys for
deepening opportunities and feeds step 1.

## Agent skills

### Issue tracker

GitHub Issues on `dr-tacomancer/vitrine`, via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five defaults — `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Definition of done

A piece of v1 work is done when:

1. It implements a spec issue, and its behavior is covered by tests written
   red-first that pass.
2. Any decision it embodies has an ADR, and any new term is in `CONTEXT.md`.
3. `/code-review` has run on the diff and its findings are resolved or
   declined in writing.
4. It works against a real library on disk — including one that Obsidian
   created — not only against fixtures.
5. If it has a screen, that screen matches the brief and the relevant mockup
   as far as the v1 feature set goes.
6. The `Current state` section above still tells the truth.
