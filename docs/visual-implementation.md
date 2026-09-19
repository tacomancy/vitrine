# Visual implementation — the brief in SwiftUI

How `design/vitrine-design-system-brief.md` (the visual authority, ADR 0004)
is translated into the app target. This records the translation only; a
token's value or a rule's meaning is the brief's, and changing either is a
new ADR. Written alongside the window shell (issue #11) and extended by each
screen that adds to it.

## Colors: one asset per token

Every `--color-*` token in the brief's dark block is a color set in
`App/Assets.xcassets/Colors/`, named exactly for the token with the
`--color-` prefix dropped: `bg`, `bg-surface`, `fg-muted`, `primary`,
`accent`, `series-1`, … — 46 in all, generated from the brief's text so the
names and values cannot drift by hand. `bg-overlay` carries its alpha.

Each set holds a single **Any** value: the dark value (ADR 0009). The light
"playbill" appearance later adds a Light appearance entry to each set and
lifts the override below; nothing is renamed.

View code refers to a token only through Xcode's generated asset symbols —
`Color(.bgSurface)`, `Color(.fgMuted)` — so a misspelled token is a compile
error, not a runtime fallback to black, and no literal hex appears in a view.
A hyphenated token becomes a lower-camel-case symbol (`bg-surface` →
`.bgSurface`, `series-1` → `.series1`).

## Appearance

`VitrineApp.init` sets `NSApplication.shared.appearance` to `darkAqua`:
the whole app — window, menus, open panels — is dark regardless of the
system setting (ADR 0009). Nothing else in the app reads or reacts to the
color scheme.

Reduce Transparency and Increase Contrast change nothing: the chrome is
drawn from opaque tokens, no system material or vibrancy is used anywhere,
and every foreground/surface pair is the brief's contrast-audited one.

## Fonts

Inter (Regular, Medium, SemiBold, Bold — 400–700) and IBM Plex Mono
(Regular, Medium — 400–500) ship as the static OpenType faces from the
official releases (Inter 4.1, IBM Plex Mono 2.5.0) in `App/Fonts/`, with
their OFL license texts beside them. Josefin Sans is not bundled (ADR 0009).

`BundledFonts.register()` runs first thing in `VitrineApp.init` and
registers each face by file name with `CTFontManagerRegisterFontsForURL`
for the process. A face that is missing from the bundle or fails to
register stops the launch with `fatalError` naming the file — there is no
system-font fallback, by decision. The one tolerated failure is "already
registered" / "duplicated name": a user who has installed Inter or Plex
Mono system-wide has the same face, and the family resolves anyway.

Views take type through `Font.sans(_:weight:)` and `Font.mono(_:weight:)`,
which resolve the family names `Inter` and `IBM Plex Mono` at a step of the
scale. Note Plex Mono Medium's PostScript name is `IBMPlexMono-Medm`; the
family-plus-weight route avoids ever spelling it.

## Type scale and tracking

`TypeScale` names every step of the brief's 1.22 scale:

| Step | px | Used for |
|---|---|---|
| `label` | 11 | caps section labels, mono counts, the SOON badge |
| `caption` | 12 | the library name in the title bar, metadata |
| `compact` | 13 | tabs, sidebar rows, the app name |
| `body` | 14 | the product default; the editor's note text |
| `lead` | 16 | |
| `subheading` | 18 | |
| `heading` | 21 | |
| `title` | 25 | the editor's note title, the First run headline |
| `display` | 31 | |
| `hero` | 39 | |
| `poster` | 49 | |
| `marquee` | 61 | |

Nothing is set below `label`. Where the mockups use an off-scale size
(12.5 px tabs and rows), the implementation takes the nearest step
(`compact`, 13) — the brief's scale wins over the mockup (ADR 0004).

`Tracking.capsLabel` is the brief's `0.14em`; SwiftUI tracks in points, so
`CapsLabel` multiplies it by the step's size. `CapsLabel` is the one way
to draw a caps label (mono `label`, tracked, uppercased, in the token color
the caller names — `fg-muted` for section labels, `accent` for SOON).

## Radii

`Radius.small` (2), `.medium` (3), `.large` (5). Five is the maximum
anywhere (brief, rule 4). Floating panes use `large`; the active tab's top
corners and the SOON badge use `medium`; square tab markers use `small`.

## Focus

The brass ring (brief, rule 7) is `BrassFocusRing`: `focusEffectDisabled()`
to suppress the system's accent-colored ring, then a 2 px stroke of the
`focus` token drawn 2 px outside the control's own rounded rectangle. Every
focusable custom control applies `.brassFocusRing(isFocused:cornerRadius:)`
and reports its focus from a `@FocusState`; the tab strip is the first.
A native AppKit control applies the same modifier around its bridge,
reporting focus from its own first-responder changes — the editor's text
view is the first (§ The editor) — so the ring is one treatment app-wide.
`PrimaryButton` — the brief's action button (rule 2): `primary` filled,
`on-primary` text at `caption`/medium, padded 3 × 9 px, `Radius.medium`,
`primary-hover` under the pointer — takes it too; the bars in the editor
are its first use.

## Density

Compact is the only density in v1. The shell's compact values: section
labels inset 12 px with 5 px above the first, 4 px below each, and 11 px
between sections; 8 px gutters between and around panes. Sidebar rows are
24 px (`SidebarMetrics`).

## The window shell (ADR 0008)

The window is a SwiftUI `Window` scene with `.windowStyle(.hiddenTitleBar)`
and a 1280 × 800 default size; `WindowShell` sets the minimum — every pane
at its minimum with a gutter around each (1036 wide), and 520 tall. It is a
`VStack` on `bg` that ignores the top safe area so the drawn chrome starts
at the window's top edge:

- **`TitleBar`**, 38 px, `bg-raised`. The system traffic lights stay where
  the system puts them horizontally; `TrafficLightsAlignment` centers them
  vertically in the 38 px bar (the hidden-title-bar window places them for
  its own 28 pt bar) and re-applies that after every resize and on leaving
  full screen. The mark (`Mark.imageset`, the 17–32 px cut from
  `design/icons/svg/vitrine-mark-small.svg`, at the spec's 22 px), "Vitrine"
  at `compact`/semibold in `fg-secondary`, and — once a library is open —
  "— " and its name at `caption` in `fg-muted` follow. At the trailing
  end, inset 12 px, the **search field** (`SearchField`, spec #67): the
  mockup's 24 px control, 180 px wide, on `line` with a 1 px
  `line-control` edge at `Radius.medium` — the mockup draws
  `line-strong`, but the brief's accessibility contract gives a control's
  border `line-control`, and the brief wins (ADR 0004) — holding an 11 px
  `magnifyingglass` in `fg-muted`, *Search* at `caption` in `fg-muted`,
  and `⌘K` in mono `label`. It is a plain button, not a field: it opens
  the command palette (§ The command palette), which holds the query. It
  takes the brass ring when focused. The whole bar drags the window
  (`WindowDragGesture`).
- **`TabStrip`**, 31 px, `bg`. One `TabButton` per `Tab` plus a muted `+`.
  The active tab is `bg-raised` with 3 px top radii, a 2 px `primary` rule
  along its bottom edge, and a brass marker; inactive tabs are `fg-muted`
  with a muted marker. Markers are square for Notes, Sources, and Tags and
  round for Ideas and Dashboard. Tabs take keyboard focus with Tab even
  when the system's Keyboard navigation setting is off (`.focusable` with
  the `.edit` interaction — `.activate` alone joins the key loop only with
  that setting on, like every button), move focus and selection with ← / →,
  select with Space or Return, carry the brass ring, and are exposed as a
  tab bar with the selected tab marked selected.
- **The body** is the selected tab's view. Notes is `NotesTab`, or
  `FirstRun` while no library is open; Tags is `TagsTab` (§ The Tags
  tab); Sources, Ideas, and Dashboard one `SoonSurface` each (ADR 0005).

No hairline is drawn anywhere in the shell: `bg` / `bg-surface` /
`bg-raised` contrast does that work (ADR 0008, Update).

### Gutter split view

`GutterSplitView` is an `NSSplitView` subclass whose `dividerThickness` is
the 8 px gutter and whose `drawDivider` draws nothing, so the divider is a
transparent, draggable gap. Initial widths are placed as frames in
`layout()` the first time the view has a real width — nothing sticks
before that — and never again.

`GutterSplitPanes` bridges it into SwiftUI with `NSViewRepresentable`:
a tab hands it its `PaneWidth` table and a closure that builds its panes,
each hosted in an `NSHostingView` with `sizingOptions = []` (a pane's
content must not size the split view, and so the window, upward), and it
answers `sizeThatFits` with the proposal for the same reason. The panes
are built once, when the split view is made, and follow the observable
state they were given — the window's selection objects — not the
representable's own updates. The
panes are laid out the classic way, by the split view's delegate, because
Auto Layout constraints and holding priorities on the hosted panes fought
the initial widths (the panes settled at min / max instead of ideal). The
delegate clamps each drag to the tighter of its two neighbours' limits —
the leading pane's minimum or the trailing pane's maximum on the left, the
leading pane's maximum or the trailing pane's minimum on the right — and
distributes every resize: the one pane with no ideal width — the editor,
or the tag page — takes the rest, and only when the rest would drop below
its minimum do the other panes, trailing first, give up width down to
theirs. `PaneWidth` holds the spec's numbers: sidebar 196–280 (ideal
212), note list 260–404 (ideal 300), editor at least 320, rail 220–360
(ideal 260), and the tag page at least 320 like the editor; `notesTab`
and `tagsTab` are the two tables, and the Notes one, the wider, sets the
window's minimum. The editor minimum is not in the spec; it is what makes
the window's minimum size mean something.

`FloatingSurface` is the note list, editor, rail, and tag page's look: `bg-surface`
at `Radius.large`, filling its pane. The sidebar sits directly on `bg`.
The split view is padded by one gutter on every side.

### List rows

Every selectable row in the shell — sidebar rows and note list rows today
— shares one treatment (ADR 0008, Update): `SelectedRowPill` draws the
row's content behind the `bg-raised` pill at `Radius.medium` with the 2 px
`primary` rule along its left edge, both clear when the row is not
selected so content never shifts, and `RowButton` wraps that in a plain
button inset 4 px from the pane's edges that takes the brass ring when
focused and is marked selected for accessibility. A row's own file adds
only what differs: its content and its colors.

### The sidebar

`Sidebar` is LIBRARY, FILES, and TOPICS in one scroll view, with the SCOUTS
stub pinned below it, on `bg`. Every row is a `SidebarRow`: 24 px,
`compact` text, an 11 px SF Symbol glyph (`books.vertical` for All Notes,
`clock` for Recent, `tray` for Untagged — the mockup's open-box glyph —
`folder`, `doc.text`, `paperclip`, and `number` for a tag's `#`), and a
mono `label` count on the right. **Recent** (spec #67) sits between All
Notes and Untagged, counting `NotesSelection.recent` — every note opened
this session, last opened first, each once (CONTEXT.md, Recent): every
route that opens a note moves it to the front, Back and Forward included;
Close drops it; a library switch empties it. Selecting the row scopes the
note list to that list in that order, under a `N NOTES · OPENED ↓` header
instead of `MODIFIED ↓`; a new note under it goes in the root. Selected, a row is the selected-row pill with its glyph in `accent`
(`SidebarRow.Emphasis`) — brass for the active nav item (rule 3); its text
is `fg`, an unselected row's `fg-secondary`, glyph `fg-muted`. Row content
starts 6 px inside the pill so it lines up with the labels at 12 px. With
no library, All Notes is `fg-disabled` throughout and inert, and Untagged,
FILES, and TOPICS are absent.

The sidebar is one scope (`SidebarSelection`): All Notes, Recent,
Untagged, a folder, a note, or a tag — selecting any row deselects every
other, in every section. The scroll content ends with one section spacing so the
last row sits clear of SCOUTS.

`FileTree` flattens the library's tree to the rows on screen — a folder's
entries follow it only while it is expanded — in a lazy stack. Each depth
is inset 14 px more. Folder rows carry an 8 px `chevron.right` in
`fg-muted`, turned 90° when expanded; every row keeps the chevron's slot so
glyphs align within a depth. Clicking a folder selects it and toggles it,
as Obsidian does; clicking a note selects it, scopes the note list to its
folder, and opens it; attachments are not buttons. Rows take the brass
ring when focused but do not force themselves into the Tab loop.

`TagTree` is the same treatment for the `Index`'s tag tree: one row per
node, in the order the seam gives (case-insensitive natural, at every
level), its name in display spelling and its descendant-inclusive count,
each depth inset 14 px more. A node with children carries the chevron and
one click both selects it and toggles it, as a folder does; a leaf only
selects. It is one tree for both tabs (spec #72): it takes the path to
draw selected and a closure to call with the path clicked, so TOPICS
selects the Notes scope and TAG TREE (§ The Tags tab) the tag page's
subject. Expanded folders and tags are the sidebar's own state, by path,
and both reset when a different library opens (its root changes) — not
when the same one is replaced by a save or another tool's change.

### The note list

`NoteList` is a floating surface holding the `N NOTES · MODIFIED ↓` header
and one `NoteRow` per note in the sidebar's scope — All Notes, Untagged, a
folder, or a tag with its descendants, the last two answered by the
`Index` — newest first (notes modified at the same instant keep library
display order), or Recent in recency order under `OPENED ↓`; the order is
`SidebarSelection.notes(in:index:recent:)`'s, so the pane sorts nothing.
The header is a `CapsLabel`
in `fg-muted` — the one caps treatment, tracked like LIBRARY and FILES
even though the mockup leaves this line untracked — padded 7 px above and
below and inset to where the rows' titles start.

A row is a `Button`: the title at `compact` (the mockup's 12.5 px taken to
the nearest step) and the modification date in mono `label`, `fg-muted`,
on a shared baseline, then 3 px below, the **tag row** — the note's tags
from `Index.tags(of:)`, each with its `#`, space-separated, in mono
`label` and `link` (the mockup's tag-row blue is the link token), one line
truncated with an ellipsis; content padded 7 × 11 px (compact density,
`NoteListMetrics`). A note with no tags keeps the empty line, so every row
is one height. The tag row is text, not a control: nothing in it
navigates in this spec. The date reads as the mockup's column
(`Note.modifiedLabel`, which the command palette's rows share): the time
for a note modified today, `Aug 28` for one modified this year, the full
date for anything older. Selected, the row is the selected-row pill and
its title steps up from `fg-secondary`, regular, to `fg`, semibold; the
date is the row's accessibility value. Opening a row while the tree
highlights a different note moves that highlight to the note's folder:
the scope is unchanged, and the tree never points at one note while the
list and editor show another. A tag or Untagged scope stays as it is when
a row opens.

### The editor

`Editor` is a floating surface that is empty until a note is open. With
one, it stacks the 34 px breadcrumb — the note's path relative to the
library root in mono `label`, `fg-muted`, inset 16 px, its separators
spaced as ` / `, truncated in the middle when the pane is narrow — over
the **title field** at `title` (25 px), semibold, `fg`, padded 20 × 36 px
(§ The title field), over — when one is up — a bar (§ The two bars),
over the note's text in `NoteTextView`, which scrolls under the title
(ADR 0013: the text view's own scroll view is what makes layout
viewport-only). The
text is inset to the same 36 px and runs in a measure of at most 720 px
aligned to the leading edge, capped by `EditorTextView` (the container
follows the view's width only up to the measure). No SOURCE/PREVIEW
toggle or property line. A note that cannot be read shows `LibraryError`'s
sentence in `danger` in place of its text.

**What the text view is.** An `NSTextView` on TextKit 2
(`usingTextLayoutManager: true`) in an `NSScrollView`, bridged by
`NoteTextView` (`NSViewRepresentable`) with a `Coordinator` that is the
view's delegate and its storage's. Fixed settings, each a decision of
ADR 0013: plain text (`isRichText` off, no graphics, no font panel, no
ruler); automatic quote and dash substitution, text replacement, link
detection, spelling correction, data detection, text completion, and
smart insert/delete **off**; the find bar, incremental search, and
continuous spell checking **on** — ⌘F reaches the bar through the Edit
menu's Find submenu, which `TextEditingCommands` adds to the app, since a
`Window` scene has none of its own; `allowsUndo` on with the coordinator's
own `UndoManager`, emptied when a different note opens; the system focus
ring off on both the text view and its scroll view. Neither draws a
background: the floating surface shows through. The text color and
insertion point are `fg`; the selection is the brief's wash (rule 8),
`primary` at 42 % (`EditorColor.selection`); a link's only text
attribute is the pointing-hand cursor, since its color comes with the rest.

**Fonts** are the registered faces by PostScript name
(`BundledFonts.PostScriptName`, `NSFont.bundled`; `EditorFont`): Inter
Regular at `body` (14) for the text — the spec's 15 px is off the scale —
with 6 px line spacing for the mockup's 1.65 line height; Inter SemiBold
for a heading line, level 1 at `title` (25), 2 at `heading` (21), 3 at
`subheading` (18), 4 at `lead` (16), 5 and 6 at `body`; IBM Plex Mono
Regular at `compact` (13) for frontmatter, fenced code, and inline code,
one step under the body so a mono run sits in a line of Inter.

**Range → attribute.** On every change to the characters the coordinator
parses the whole text (`ParsedNote.parse`, on one native-storage
snapshot), resolves each link and embed through `Index.resolve` (a link
typed a moment ago is colored for what it points at before any save), and
converts every range from the parser's UTF-8 offsets to UTF-16 once
(`StyledRange.all` — a **styled range** is a token or structure with the
font and colors it takes). Fonts and links are storage attributes, set
in `textStorage(_:didProcessEditing:)` only where the one in place
differs (`StyledRange.fontSpans`), as is the unresolved link's dashed
underline — TextKit 2 draws underlines from the storage alone; the `fg`
color and the paragraph style are uniform, loaded with the text and
inherited by typing; colors and backgrounds are rendering attributes on
the layout manager — the editor's two keys removed over the document and
set afresh, the view's own (spelling, marked text) untouched — in
`textDidChange`, or on the next run-loop turn for a change the view does
not announce, such as an undo (ADR 0013, Update).

| Range | Font | Color |
|---|---|---|
| frontmatter (`rawRange`) | mono | `fg-muted` |
| heading (line) | semibold at its level's size | — (`fg`) |
| fenced code block, inline code span | mono | `fg-secondary` on `bg-sunken` |
| body tag | — | `link` |
| link or embed to a note, attachment, or the outside | — | `link`; the `.link` attribute is `vitrine-link://N`, `N` its index in `BodyLink.all` — a URL because AppKit expects one there, a scheme nothing opens |
| unresolved link or embed | — | `fg-muted`; a single dashed `.underlineStyle` in the storage, and the same `.link` — following it creates the note |

Later rows win inside earlier ones: a link in frontmatter is `link`, code
in a heading is mono. Clicking a link reaches
`textView(_:clickedOnLink:at:)`, which follows the `BodyLink`'s
destination as #27 did — a note opens in place and pushes history, an
attachment or external link opens through `NSWorkspace` — and an
unresolved link creates its note: titled by the target's last path
component without any `.md`, in the folder a new note goes in
(§ Creating), and opened, so the link resolves as the tree and Index
follow; a title the folder refuses creates nothing. Tags are colored and
inert.

**Focus.** The brass ring is `BrassFocusRing` around the scroll view, at
`Radius.medium`, driven by `EditorTextView` reporting when it becomes and
resigns first responder; the scroll view is inset 4 px inside the surface
so the ring (2 px out, 2 px wide) stays on it. The text view is the
standard text area to accessibility, labelled "Note text".

**The buffer** (`NoteBuffer`, one per window beside `NotesSelection`) is
the text as the editor holds it, with its parse, and whether it is dirty
(CONTEXT.md § Editor). The window shell opens it on every change of the
open note's path; opening saves what was there. Each edit's parse comes
up from the coordinator; a save fires `NoteBuffer.autosaveDelay` (1 s)
after the last one, at once on a note switch, when the text view gives
up focus, when the window resigns key or the app resigns active, on
quit, and on ⌘S (File › Save, a no-op when clean; Open Library… saves
before it replaces the library). A save
is `CurrentLibrary.save`: `Library.write` in place, then
`Index.updating` and `Search.updating` with the buffer's own parse, the
library, Index, and Search on screen replaced together (ADR 0014,
ADR 0017, ADR 0018); the note list's date, the rail's tags, links, and
backlinks, and what the command palette finds follow. Creating and
renaming likewise reach `Search.adding` and `renaming` beside the
Index's. The buffer remembers the
library it read from and writes to no other. There is no dirty
indicator; the one thing the editor says about the buffer is a save that
could not write — `LibraryError`'s sentence at `caption` in `danger`
under the title, until a save does, and the text stays ahead of the disk
until then (or goes with the buffer when the note changes; the spec
designs nothing further for a file that cannot be written).
The view writes text into the storage only when the app's parse is not
the one it showed or reported — a note switch, or a reload — in one
editing block: a different note starts at the top with a fresh undo
stack; the same note keeps the caret and scroll where the new text
allows, and its undo stack — the same note under a new path, renamed by
the title field, counts as the same.

**Selection follows a save.** A `Note` carries its modification date and
a `Folder` its notes, and every pane compares by value, so after a write
`NotesSelection.refresh(from:)` finds the open note, the history, and the
sidebar's folder or note again by path (`Library.note(at:)`,
`folder(at:)`); the window shell tells a save (same root) from a library
switch (different root), which clears the selection as before.

### The title field

`TitleField` is the note's title as a plain `TextField` (no border, the
system focus ring off) at `title`/semibold in `fg`, with the brass ring
around it at `Radius.medium` — the field is padded 4 px each side for
the ring and pulled back 4 px so the text sits at the page's 36 px. Its
placeholder is *Untitled*. Return, focus loss, or another note opening
under the field commits — for the note the title was typed for: the text
trimmed of surrounding whitespace, unchanged is nothing, otherwise
`CurrentLibrary.renameNote` — `Library.renameNote` in the note's folder,
then `Index.renaming` — and the buffer and selection take the renamed
note before the library's change reaches the panes, so the tree,
breadcrumb, list, and rail follow without the note reopening. A refusal
(`invalidName`, `nameTaken`) keeps the file's name, leaves the typed
text in the field, and shows `LibraryError`'s sentence at `caption` in
`danger` 6 px under it; Escape reverts the field and clears the sentence.
Links elsewhere are not rewritten, and nothing on screen suggests they
are (`CONTEXT.md` § Note). Selection in the field is the system's, not
the brief's sapphire wash (rule 8): SwiftUI's `TextField` exposes no
selection color — the one place the two differ.

**Creating** (spec #38 § Creating). File › New Note, ⌘N (the command
group that replaces the system's New), runs
`WindowCommands.newUntitledNote` — `WindowCommands` being the commands
the menu bar and the command palette both run on the key window, so the
two routes cannot drift — which creates
`CurrentLibrary.createUntitledNote` in `SidebarSelection.folderForNewNotes`
— the selected folder, a selected note's folder, or the root for All
Notes, Untagged, and a tag — `Library.createNote` with
`uniqueUntitledName` then `Index.adding` with an empty parse, so the
tree, *All Notes N*, and the note list show it at once; then
`NotesSelection.requestTitleFocus` and `open`, and `Editor` takes the
request when the buffer shows the new note and focuses the field, whose
text AppKit selects whole on focus, so typing names it. A note created
from an unresolved link (§ The editor) opens with the caret in the body
instead. The menu item is disabled with no library open. A creation the
library refuses — the folder unwritable, or a link's title already taken
there — is `CurrentLibrary.createFailure`, shown by the window shell as
an alert like a failed open: *Vitrine couldn't create the note*, with
`LibraryError`'s sentence.

### The two bars

`ConflictBar` sits between the title and the text, 11 px under the
title and inset to the page's 36 px, while `NoteBuffer.conflict` is set
— a conflict as `CONTEXT.md` § Editor defines it (ADR 0014): a status with its icon and label (rule 5) — an 11 px
`exclamationmark.triangle` and the label at `caption`/medium, both in
`warning` — on `warning-bg` at `Radius.medium`, padded 6 × 12 px (8 px at
the trailing end), and its two actions as `PrimaryButton`s at the
trailing end. It is one accessibility element, labelled with its status.

- **Changed on disk** · **Overwrite** · **Reload** — another tool wrote
  the file while the buffer was dirty. Overwrite is `NoteBuffer.overwrite`:
  the bar clears and the buffer saves at once. Reload is
  `NoteBuffer.reload`: the bar and the dirty flag clear and the disk's
  text replaces the buffer's, the text view keeping caret and scroll
  where the new text allows.
- **Removed from disk** · **Save as new** · **Close** — the file is gone
  from under the buffer, dirty or clean. Save as new is
  `NoteBuffer.saveAsNew`: `CurrentLibrary.createNote` at the note's own
  title in its folder (`Note.folderPath`), then a save of the buffer's
  text; the bar clears, and the tree row, list row, and Index entry come
  back — or, the folder gone too, the bar stays with `saveFailure`'s
  sentence under the title. Close is `NotesSelection.close`: the open
  note leaves the selection and its history, and the buffer empties as it
  follows. A removed note that comes back on its own — a sync client's
  restore, Finder's undo — is a note again: a clean buffer takes its
  text and the bar comes down; a dirty one gets *Changed on disk*.

The buffer decides which bar from the library alone, each time the
window shell hands it the replaced library (before the selection is
refreshed): its note gone from the tree is *removed*; its note carrying
a modification date other than the one it holds is *changed* — a
clean buffer takes the disk's text silently instead, and its own save
leaves the two dates equal, so a save raises nothing. While a bar is
up, every save — the autosave, the boundary saves, ⌘S — does nothing;
the bar is the answer (ADR 0014). A note switch while a bar is up drops
the buffer with the bar, as any switch drops an unsaved buffer that
cannot write. A note renamed by another tool while open is, to the
buffer, removed at its path: it shows the *Removed from disk* bar, and
Save as new recreates it at the old path.

**The watcher** (ADR 0014) is `CurrentLibrary`'s: `replace(with:)`
starts a task over `LibraryWatcher.watch` for every successful open and
cancels the one before it, and every `LibraryChange` becomes
`Library.applying`, then `Index.applying(_:in:)` (ADR 0017, Update),
then `Search.applying(_:in:)` over that Index (ADR 0018, Update), the
three replaced together — so the file tree, note list, TOPICS counts,
backlinks, rail, and search follow whatever Obsidian, Finder, or a sync
client does, and a change the old watch had in hand as a library
switched is dropped. `NotesSelection.refresh(from:)` then finds every
note and folder again by path, keeping the open note even when it is
gone (that is the buffer's call, above). Nothing under a dot-entry
reaches any of this: `.obsidian/` churn costs nothing on screen.

Back and Forward are the Go menu, ⌘[ and ⌘], reaching the key window's
`NotesSelection` through a focused scene value (`FocusedNotesSelection`)
and disabled at either end of the history. Every way of opening a note —
a tree row, a list row, a link, a backlink — pushes and discards whatever
was ahead, as browsers do; the note already open is not entered twice, so
Back always leads somewhere else.

### The rail

`Rail` is the fourth floating surface, at the split view's trailing edge,
empty until a note is open. With one, it is two caps sections in a scroll
view, inset 16 px like the editor's breadcrumb so the two surfaces read
as one line, the first label padded 11 px so it sits in the breadcrumb's
34 px band (`RailMetrics`): **BACKLINKS** — one `BacklinkEntry` per
`Index.backlinks(to:)`, in the seam's title order: the linking note's
title at `compact` (the spec's 12.5 px taken to the nearest step) in `fg`,
then each context line at `caption` (the spec's 11.5 px, likewise) in
`fg-secondary`, one line, ellipsised. An entry is a `RowButton`, never
drawn selected, that opens its note — scope unchanged, history pushed.
With none, one line of `caption` in `fg-muted`: *No notes link here.*
**INFO** — the note's path in mono `label`, `fg-secondary`, truncated in
the middle; its modification date at `caption` in `fg-secondary`, as
`Sep 12, 2026 at 3:04 PM`; its tags as `TagRow` — the note list's tag
row, mono `label` in `link`, one line, the one view the list, this rail,
and the palette's preview rail share — absent when it has none; and
`N links · N backlinks ·
N unresolved` in mono `label`, `fg-muted`, counted from `links(from:)`
and `backlinks(to:)`. No ANCHORS, and note-list rows are unchanged
(spec #25).

### The Tags tab

`TagsTab` is two floating panes in the gutter split view — the sidebar at
the Notes tab's width, then the tag page taking the rest — sharing
`TagsSelection`: the window's Tags state, held by the shell beside
`NotesSelection` so it survives a tab switch, and cleared with the Notes
one when a different library opens. It holds the sidebar row whose page
is shown (`TagsSidebarSelection`: a tag by path, or Untagged — nothing at
first) and the tree's expanded tags, which live here rather than in the
sidebar so a chip on the page can reveal the row it opens.

**`TagsSidebar`** is TAG TREE — `TagTree` over the whole tree, full
height in one scroll view — and UNTAGGED with one `SidebarRow`, *Notes
with no tag N* from `Index.untagged`, carrying the `tray` glyph the Notes
tab's Untagged row does (the mockup draws it bare; one row treatment
wins). Same labels, insets, and row density as the Notes sidebar
(`SidebarMetrics`); no LIBRARY, FILES, or SCOUTS.

**`TagPage`** (screen 09, the v1 subset on record in ADR 0004's Update)
is a floating surface with its content in a scroll view, padded 16 × 22
px (`TagPageMetrics`), everything read from the `Index` as it is now so a
save or another tool's change shows as the Index has it. For a tag:

- the tag at `heading` (21 px) in `fg`, its `#` in mono `link` as the
  tree's glyph and the tag row spell it; the name is the display spelling
  — the names of the nodes from the root down, joined by `/`
  (`[TagTreeNode].ancestry(of:)`), so `#learning/probabilistic` reads as
  the tree spells it;
- 9 px under it the stat line: `N NOTES · N CHILD TAGS` as a `CapsLabel`
  in `fg-muted` — the node's descendant-inclusive count and its
  children's count — then, 12 px on, **Open in Notes** (`OpenInNotesLink`):
  the page's one action, caps `label` in `link` (rule 2), a plain button
  with the hand pointer and the brass ring at `Radius.small`. It hands the
  subject to the shell, which sets the Notes scope (`select(tagAt:)` or
  `selectUntagged`) and switches tabs; filter chips are untouched;
- the child tags as `InfoChip`s in a `WrappingRow` 5 px apart, each
  labelled `#` and the child's *name* — its last segment, as the mockup
  labels them under their parent — and clicking one is
  `TagsSelection.reveal(tagAt:)`: the child's page, with every tag above
  it expanded so its row is on screen;
- 20 px under, **CO-OCCURS WITH** as a `CapsLabel`, then up to 10
  `CoOccurrenceRow`s (`TagPageMetrics.rowLimit`) from
  `Index.coOccurringTags(with:)`, 12 px apart, in a column no wider than
  480 px (the rail's width on screen 09, so a bar stays a bar on a wide
  page), then *and N more* at `caption` in `fg-muted` when there were
  more. Fewer than 3 notes (`minimumNotesForCoOccurrence`) and the section
  is one line instead, *Co-occurrence needs at least 3 notes.*, at
  `caption` in `fg-muted`.

Untagged's page is the word at `heading`, `N NOTES`, and *Open in Notes*
scoped to Untagged; nothing else. With nothing selected — or a selected
tag the last edit removed from the tree — the surface shows *Select a
tag* centred at `body` in `fg-muted`; with no library it is empty, as the
Notes tab's panes are. No note list, rail, description, segmented row,
or toolbar (ADR 0004, Update).

**A co-occurrence row** is the other tag, `#` and its display spelling
in mono `caption` (12) and `fg-secondary`, with `count/outOf · P %` in
mono `label` and `fg-muted` at the trailing end — `P` the share rounded
to the nearest whole percent, so `6/14` reads `43 %` — and 4 px under
them the **bar**: a 4 px track in `line` at `Radius.small`, filled from
the leading edge to `count / outOf` of its width. The row is one
accessibility element reading its text; the bar is hidden from it.

**The bar ramp** is the brief's sequential sapphire ramp (§ Chart
colour), the first chart in Vitrine: `SequentialRamp.color(atSlot:)`
gives row 1 `seq-1`, the darkest on dark, down to row 6 `seq-6`, the
lightest; rows 7 to 10 stay at `seq-6`. Slots are by position in the
list, fixed and never cycled (rule 6), so a list only ever gets lighter
down its length — magnitude is the bar's width, the ramp only says which
row is which. Colors come from the `seq-N` assets like every other token.

**`InfoChip`** is the brief's info chip, the treatment filter chips
(#74) share: `info-bg` filled, a 1 px `info-line` border, the text in
mono `label` and `info`, 21 px tall, 8 px of horizontal padding,
`Radius.medium`. With an action it is a plain button with the hand
pointer and the brass ring; without, it reads only. **`WrappingRow`** is
the `Layout` a row of chips sits in: leading to trailing at each chip's
own size, wrapping to a new line when the next would not fit the width
proposed, so many chips never push what is below them off screen.

### The command palette

`CommandPalette` (screen 08's v1 subset; spec #67) is the first
**overlay**: while `PaletteState.isOpen` — one state per window beside
`NotesSelection` and `NoteBuffer` — the window shell overlays its whole
body with a `bg-overlay` **scrim** and, 110 px from the top, the
760 px **panel** on `bg-surface` at `Radius.large`, no border, no
shadow. The overlay is hosted in its own `NSHostingView`
(`HostedOverlay`): SwiftUI paints its own views beneath every platform
view in the same host, so a plain `.overlay` would sit under the gutter
split view's panes, while platform views keep tree order among
themselves. That hosting view (`FirstResponderHostingView`) takes the window's
first responder as it appears, so the palette's focus starts inside it;
the scrim takes every click that misses the panel (and closes the
palette on one), so the window beneath is inert. Opened by ⌘K — Go ›
Search…, reaching the key window's state through a focused scene value
(`FocusedPaletteState`), and closing the palette when it is already
open — or by the title bar's search field.

The panel stacks the **header** — a 15 px `magnifyingglass` in `link`,
then the query as a plain `TextField` at `lead`/regular in `fg`,
placeholder *Search*, padded 14 × 16 px, the system focus ring off and
no brass ring in its place (the brief's rule 7 names this one exception:
the open palette is the focus) —
over the **body**, 440 px tall (less in a short window, never under
160), split into the results column and the 268 px **preview rail**,
over the **footer**: `↑↓ navigate · ↩ open · esc close · ⌘⌫ clear`,
each key in mono `label` `accent` — brass as punctuation (rule 3) — and
its word at sans `label` in `fg-muted`, 16 px apart, and `N notes` in
mono `label` `fg-muted` at the trailing end, padded 8 × 16 px. The query
resets to empty on every open; each keystroke restarts
`PaletteState.debounce` (50 ms), after which `Search.results(for:)` runs
on the main actor (ADR 0018) and the highlight returns to the first row.

**The results column** is a lazy stack in a scroll view, padded 8 px
above and below: the group label — `NOTES · N`, or `RECENT · N` while
the query is empty — as a `CapsLabel` in `fg-muted` padded 4 / 6 px at
the 16 px inset, one `PaletteResultRow` per row, then `ACTIONS` and its
rows. A row is the selected-row pill (§ List rows) inset 4 px, its
content padded 7 px vertically and to the 16 px inset: the mono `label`
**kind tag** — `NOTE`, or `DO` for an action — in `fg-muted`, the label
at `compact` in `fg-secondary`, one line, and the meta — a note's
`modifiedLabel` — right-aligned in mono `label` `fg-muted`. Highlighted,
the tag steps to `link` and the label to `fg`. ↑ and ↓ move the
highlight over NOTES and ACTIONS as one list (`PaletteRow`), stopping at
either end; the pointer over a row highlights it too; the highlighted
row scrolls into view. With nothing to list, one line of `caption` in
`fg-muted`: *No notes match.* or *No notes opened yet.*

**NOTES** is one row per `SearchResult`, in the seam's order — or, while
the query is empty, `NotesSelection.recent` with the open note left out,
so ↩ on the first row returns to the note before it. **ACTIONS** is
`PaletteAction`: *New note* (⌘N's `WindowCommands.newUntitledNote`),
*New note titled "<query>"* — present only with a library open, a
non-empty query, and no note whose title is the query already, compared
case-insensitively as the file system does; it creates that note in the
folder ⌘N would use (`WindowCommands.newNote(titled:)`) and opens it with
the caret in the body — *Open Library…* (`WindowCommands.openLibrary`),
*Back* and *Forward* only while `NotesSelection` allows, *Go to Notes*,
*Go to Tags* (the window's tab); with a query, only those whose label
contains it, case-insensitively. *New note* and *New note titled* are
absent on First run.

**The brass highlight wash** (`HighlightWash`) is the one way matched
terms are marked: `accent-quiet` as the background of exactly the
characters `Search` ranged — `titleRanges` in a result row's label, the
excerpt's `ranges` in the rail — drawn through `AttributedString`'s
`backgroundColor`, the text left in the row's own color; a UTF-8 range
becomes a `String.Index` pair and then attributed indices, so a
diacritic's two bytes wash one character.

**The preview rail** (`PreviewRail`) is padded 14 × 16 px and stacks,
10 px apart, the `PREVIEW` caps label; for a highlighted note, its title
at `lead` in `fg`; for a result, its `excerpt` at `compact` in
`fg-secondary`, up to four lines with 5 px line spacing (the mockup's
1.6), washed — for a Recent row, `Search.excerpt(of:)`, the first
non-empty line with nothing marked, since nothing was matched; the
note's tags as `TagRow` (the note list's and the rail's line), absent
when it has none; `N links · N backlinks` in mono `label` `fg-muted`,
counted from `Index.links(from:)` and `backlinks(to:)`; and the
modification date at `caption` in `fg-secondary`, as the editor's rail
shows it. An action highlighted leaves the rail at its label alone.

**Opening.** ↩ or a click opens the highlighted note through
`NotesSelection.open` — exactly as following a link: history pushed,
scope unchanged, the note-list selection gone when the note is out of
scope — and closes the palette; an action runs and closes it. Esc
closes; ⌘⌫ clears the query and, with it, the results. The keys reach
the field through `onKeyPress` on the query field, ahead of the field's
own handling. A save or another tool's change while the palette is open
runs the query again against the `Search` that replaced the one the
results came from.

### First run

`FirstRun` (screen 11, v1 subset) keeps the sidebar at its split-view width
and gutter so it does not move when a library opens, and centres a 600 px
column: the headline at `title` with the brief's display tracking
(`Tracking.display`, −0.022 em), the promise at `compact` in `fg-secondary`
with 5 px line spacing (the mockup's 1.65 line height, less Inter's own
line), and `OpenFolderAction` — a `bg-raised` card at `Radius.medium` with a
1 px `primary` border, a 26 px `primary`-bordered box holding the `folder`
symbol, the title at `body`, the subline at `caption` in `fg-muted`, and a
`chevron.right`. Sapphire is the action (rule 2); the card takes focus as
the tabs do and shows the brass ring.

### Stubs

`SoonBadge` is the brief's SOON treatment: caps `label` in `accent` with a
1 px `accent-quiet` border (the mockup's half-opacity brass, as a token),
`Radius.medium`. `ScoutsStub`
pins the SCOUTS label and badge at the bottom of the sidebar; `SoonSurface`
is a stub tab's whole body. These and `Tab`'s titles are the only code that
names a reserved concept (ADR 0005).

## Known machine artifact

macOS restores a window's last frame by its scene id. A development Mac
that has run earlier builds may reopen the `main` window at a remembered
size rather than 1280 × 800; a first launch on a clean account opens at the
default. The size is not stored in the app's preferences domain alone, so
`defaults delete` may not reset it.
