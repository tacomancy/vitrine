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
Native AppKit controls (text fields, later) apply the same modifier so the
ring is one treatment app-wide.

## Density

Compact is the only density in v1. The shell's compact values: section
labels inset 12 px with 5 px above the first, 4 px below each, and 11 px
between sections; 8 px gutters between and around panes. Sidebar rows are
24 px (`SidebarMetrics`).

## The window shell (ADR 0008)

The window is a SwiftUI `Window` scene with `.windowStyle(.hiddenTitleBar)`
and a 1280 × 800 default size; `WindowShell` sets the minimum — every pane
at its minimum with a gutter around each (808 wide), and 520 tall. It is a
`VStack` on `bg` that ignores the top safe area so the drawn chrome starts
at the window's top edge:

- **`TitleBar`**, 38 px, `bg-raised`. The system traffic lights stay where
  the system puts them horizontally; `TrafficLightsAlignment` centers them
  vertically in the 38 px bar (the hidden-title-bar window places them for
  its own 28 pt bar) and re-applies that after every resize and on leaving
  full screen. The mark (`Mark.imageset`, the 17–32 px cut from
  `design/icons/svg/vitrine-mark-small.svg`, at the spec's 22 px), "Vitrine"
  at `compact`/semibold in `fg-secondary`, and — once a library is open —
  "— " and its name at `caption` in `fg-muted` follow. The whole bar drags
  the window (`WindowDragGesture`).
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
  `FirstRun` while no library is open; Tags an empty floating surface;
  Sources, Ideas, and Dashboard one `SoonSurface` each (ADR 0005).

No hairline is drawn anywhere in the shell: `bg` / `bg-surface` /
`bg-raised` contrast does that work (ADR 0008, Update).

### Gutter split view

`GutterSplitView` is an `NSSplitView` subclass whose `dividerThickness` is
the 8 px gutter and whose `drawDivider` draws nothing, so the divider is a
transparent, draggable gap. Initial widths are placed as frames in
`layout()` the first time the view has a real width — nothing sticks
before that — and never again.

`GutterSplitPanes` bridges it into SwiftUI with `NSViewRepresentable`,
hosting the three panes in `NSHostingView`s with `sizingOptions = []` (a
pane's content must not size the split view, and so the window, upward)
and answering `sizeThatFits` with the proposal for the same reason. The
panes are laid out the classic way, by the split view's delegate, because
Auto Layout constraints and holding priorities on the hosted panes fought
the initial widths (the panes settled at min / max instead of ideal). The
delegate clamps each drag — left to the leading pane's minimum, right to
its maximum or the trailing pane's minimum — and distributes every resize:
the editor takes the rest, and only when the rest would drop below its
minimum do the note list, then the sidebar, give up width down to theirs.
`PaneWidth` holds the spec's numbers: sidebar 196–280 (ideal 212), note
list 260–404 (ideal 300), editor at least 320. The editor minimum is not in
the spec; it is what makes the window's minimum size mean something.

`FloatingSurface` is the note list and editor's look: `bg-surface` at
`Radius.large`, filling its pane. The sidebar sits directly on `bg`. The
split view is padded by one gutter on every side.

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

`Sidebar` is LIBRARY, FILES, and the SCOUTS stub, on `bg`. Every row is a
`SidebarRow`: 24 px, `compact` text, an 11 px SF Symbol glyph (`books.vertical`
for All Notes, `folder`, `doc.text`, `paperclip`), and a mono `label` count
on the right. Selected, a row is the selected-row pill with its glyph in
`accent` (`SidebarRow.Emphasis`) — brass for the active nav item (rule 3);
its text is `fg`, an unselected row's `fg-secondary`, glyph `fg-muted`.
Row content starts 6 px inside the pill so it lines up with the labels at
12 px. With no library, All Notes is `fg-disabled` throughout and inert.

`FileTree` flattens the library's tree to the rows on screen — a folder's
entries follow it only while it is expanded — in a lazy stack inside a
scroll view. Each depth is inset 14 px more. Folder rows carry an 8 px
`chevron.right` in `fg-muted`, turned 90° when expanded; every row keeps
the chevron's slot so glyphs align within a depth. Clicking a folder
selects it and toggles it, as Obsidian does; clicking a note selects it,
scopes the note list to its folder, and opens it; attachments are not
buttons. Rows take the brass ring when focused but do
not force themselves into the Tab loop.

### The note list

`NoteList` is a floating surface holding the `N NOTES · MODIFIED ↓` header
and one `NoteRow` per note in the sidebar's scope, newest first (notes
modified at the same instant keep tree order). The header is a `CapsLabel`
in `fg-muted` — the one caps treatment, tracked like LIBRARY and FILES
even though the mockup leaves this line untracked — padded 7 px above and
below and inset to where the rows' titles start.

A row is a `Button`: the title at `compact` (the mockup's 12.5 px taken to
the nearest step) and the modification date in mono `label`, `fg-muted`,
on a shared baseline; content padded 7 × 11 px (compact density,
`NoteListMetrics`). The date reads as the mockup's column: the time for a
note modified today, `Aug 28` for one modified this year, the full date
for anything older. Selected, the row is the selected-row pill and its
title steps up from `fg-secondary`, regular, to `fg`, semibold; the date
is the row's accessibility value. Opening a row while the tree highlights a different note moves that
highlight to the note's folder: the scope is unchanged, and the tree never
points at one note while the list and editor show another.

### The editor

`Editor` is a floating surface that is empty until a note is open. With
one, it stacks the 34 px breadcrumb — the note's path relative to the
library root in mono `label`, `fg-muted`, inset 16 px, its separators
spaced as ` / `, truncated in the middle when the pane is narrow — over a
scrolling page padded 20 × 36 px: the title at `title` (25 px), semibold, `fg`, then
11 px below it the note's text exactly as it is on disk, frontmatter
delimiters included, as a `Text(verbatim:)` at `body` (14 px — the spec's
15 px is off the scale, and story 28 asks for the brief's body size) with
6 px line spacing for the mockup's 1.65 line height, in `fg`, selectable
and copyable, in a measure of at most 720 px aligned to the leading edge.
A note that cannot be read shows `LibraryError`'s sentence in `danger` at
the same size in place of the text. The read happens each time the pane
draws, so selecting a note again after it has changed on disk shows what
is there now. No SOURCE/PREVIEW toggle, property line, or rail.

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
