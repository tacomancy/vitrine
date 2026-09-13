# Handoff: Vitrine — native macOS research notebook

## Overview

Vitrine is a native macOS note-taking and knowledge-base app for AI-safety research (alignment, interpretability, evaluation, oversight, verification). It is a markdown-first notebook with three first-class object types — **Notes**, **Sources** (papers), and **Ideas** (claims that collect evidence) — plus **Dashboards** and a **Tag browser**. A single tabbed window; compact density by default.

The distinguishing features, in priority order:

1. **Durable anchors.** The user selects any passage in a note (a definition, an equation, a claim) and mints an anchor. Anchors are stored beside the note, not inline, and survive rewording via fuzzy re-match. Everything else links to anchors, not just to notes.
2. **Sources are their own object**, not notes with tags — paper metadata (authors, DOI, year, venue), a PDF reader with highlights, BibTeX export. A highlight can be promoted directly into an anchor on a note.
3. **Ideas collect evidence.** Each idea is a working question with a status, a confidence value, and two explicitly separated ledgers: supporting and contradicting evidence, each item pointing at a note anchor or a source location.
4. **Dashboards are user-composed** — a sidebar of named dashboards, each a grid of panels drawn from a panel library, scoped by tag and date.
5. **Scouts** (agents that fetch papers and follow citation trails) are **stubbed only** — visible surfaces marked SOON, no functionality designed yet.

## About the design files

`Vitrine.dc.html` is a **design reference created in HTML** — a prototype showing intended look, structure, and copy. It is **not production code to copy**. The task is to recreate these screens in the target codebase using its established patterns. For a native macOS app that means **SwiftUI or AppKit**; if you are building this fresh, SwiftUI with `NavigationSplitView`, `Table`, and `TextEditor`/a markdown editor component is the natural fit.

The file opens directly in a browser. It is a canvas of 13 labelled screen mockups stacked vertically; each screen root carries a `data-screen-label` attribute (`01 Main window`, `02 Editor`, … `12 Ideas board`). All styling is inline; design tokens are CSS custom properties in the `:root` block at the top of the file. `support.js` is the prototype runtime only — ignore it entirely.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, and copy. Recreate pixel-perfectly, but translate to native controls: the mockups draw macOS chrome (traffic lights, title bars, tab strips) in HTML because they have to — in the real app those are system-provided. Use real `NSToolbar`/`NSWindow` tabs, real sidebars with vibrancy, real table views.

Window sizes in the mockups: main window **1280×800**, editor **1280×700**, settings **820×600**. These are design canvases, not minimum sizes — everything should resize.

---

## Design tokens

Taken from the **Vitrine design system brief** (`vitrine-design-system-brief.md`, included in this bundle — it is the authority; the values below are the subset this design uses). Dark is the default; a cream "playbill" light variant exists.

### Color — dark (default)

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#09111D` | window background, sidebars, tab strip |
| `--color-bg-surface` | `#121A25` | list panes, editor pane, dashboard panels |
| `--color-bg-raised` | `#1C232F` | title bar, active tab, selected rows, popovers |
| `--color-bg-sunken` | `#020713` | page backdrop, the PDF reader well |
| `--color-bg-overlay` | `rgba(2,7,19,0.72)` | command-palette scrim |
| `--color-fg` | `#D0D8E4` | primary text |
| `--color-fg-secondary` | `#B2BBC9` | list titles, body copy |
| `--color-fg-muted` | `#9099A7` | metadata, caps labels, counts |
| `--color-fg-disabled` | `#707885` | genuinely disabled affordances only |
| `--color-accent` | `#E5B64A` | brass — punctuation only (see rule below) |
| `--color-accent-quiet` | `#836202` | anchor rules, subtle brass edges |
| `--color-link` | `#9ABFFA` | links, wiki-links, citation tokens |
| `--color-line` | `#2C333E` | hairline dividers (decorative) |
| `--color-line-strong` | `#3F4550` | panel and window borders |
| `--color-line-control` | `#707885` | input/control borders (≥3:1, required) |
| `--color-focus` | `#E5B64A` | focus ring |
| `--color-primary` | `#2062C7` | **every action**: buttons, selection rules, active tab |
| `--color-on-primary` | `#FFFFFF` | text on primary |
| `--color-success` / `-line` | `#48DBA2` / `#105D41` | supporting evidence |
| `--color-danger` / `-line` | `#FAA0B0` / `#8F133E` | contradicting evidence |
| `--color-info` / `-bg` / `-line` | `#9ABFFA` / `#011D4B` / `#0C49A0` | tag chips, filter chips |
| `--color-series-1..3` | `#3C7FE5`, `#22986D`, `#836202` | graph: notes, sources, ideas |
| sequential ramp | `#0C49A0 → #2062C7 → #3C7FE5 → #659EF8 → #9ABFFA → #C5DBFC` | coverage bars, co-occurrence matrix |

Light ("playbill") values are in the brief; screen 07b shows them applied. Note the prototype hard-codes light hexes on that one screen because the token block is dark-only — in the real app, drive both from the semantic tokens.

### Non-negotiable color rules

- **Sapphire (`--color-primary`) is every action** — buttons, links, selected rows, active tabs.
- **Brass (`--color-accent`) is punctuation, never a button fill** — focus rings, a count worth noticing, the scout activity dot, the highlight wash. Keep it under ~5% of any screen.
- **Status always carries an icon and a label**, never color alone.
- **Chart series are assigned in fixed slot order** and never cycled.
- **Focus is always the brass ring**: `outline: 2px solid var(--color-focus); outline-offset: 2px`. Never removed.

### Typography

Load: `Josefin Sans` (200–400), `Inter` (400–700), `IBM Plex Mono` (400–500).

- **Inter** — all product UI. Default **14px**; the mockups use 11–15px for dense chrome.
- **IBM Plex Mono** — IDs, counts, timestamps, file paths, keyboard shortcuts, caps section labels (11px, `letter-spacing: 0.14em`).
- **Josefin Sans 300** — display only, ≥20px, **never inside product UI**. Used once, on the prototype's own hero line.
- Scale: 11 · 12 · 13 · **14** · 16 · 18 · 21 · 25 · 31 · 39 · 49 · 61 px. Nothing below 11px.
- Tracking: display `-0.022em`, caps labels `0.14em`.

### Geometry

Art Deco means geometry, not ornament: stepped corners, hairline rules, wide letterspaced caps, symmetry.

- Radii: `--radius-sm: 2px`, `--radius-md: 3px`, `--radius-lg: 5px`. **5px is the maximum anywhere.** Dense chrome uses 2–3px.
- Dividers are 1px `--color-line`; panel borders 1px `--color-line-strong`.
- Selected rows: `--color-bg-raised` fill + a **2px sapphire left rule**. No blue wash.
- Active tab: `--color-bg-raised` + `inset 0 -2px 0 #2062C7`.
- No drop shadows inside the UI; window-level shadow only.

### Spacing & density (compact is default)

| Element | Compact | Comfortable |
|---|---|---|
| Sidebar row height | 23–24px | 28px |
| Note list row padding | 7px 11px | 12px 15px |
| Section label padding | 11px 12px 4px | same |
| Pane gutter | 12–16px | 18–22px |
| Title bar | 38px | 38px |
| Tab strip | 31px | 31px |

---

## Window shell (all screens)

- **Title bar, 38px**, `--color-bg-raised`, 1px bottom `--color-line`. Traffic lights left; app mark (22px, 2px radius, `linear-gradient(160deg,#053274,#020713)` with a 7px brass dot) + "Vitrine" 13px/600 + library name in `--color-fg-muted`. Right side: search field (24px, 3px radius, `⌘K` hint) and per-tab actions.
- **Tab strip, 31px**, `--color-bg`: **Notes · Sources · Ideas · Dashboard · Tags**, plus `+`. Active tab as above. Each tab has a 6px marker dot — square for document-ish tabs, round for synthesis tabs.
- **Body** fills the rest. Three-pane layouts use `grid-template-columns: 196–212px / 300–404px / 1fr`.

---

## Screens

### 01 — Main window (Notes) · 1280×800

Three panes: sidebar 212px, note list 300px, editor + anchor rail.

- **Sidebar** (`--color-bg`): LIBRARY (All Notes 1,284 / Recent 37 / Unfiled 12) · TOPICS (nested tag tree, disclosure chevrons, counts) · SMART SEARCHES (Unresolved claims 23, Read but not yet linked 9, Evals without a source 14) · pinned **SCOUTS** block at the bottom with a SOON badge, per-scout activity dots and unread counts.
- **Note list**: stackable filter chips at top (sapphire info chips with `×`), then `64 NOTES · MODIFIED ↓` and list/grid toggle. Rows: title 12.5px, one-line snippet 11.5px ellipsised, tag row 11px mono, right-aligned `7↗ 3📄` counts.
- **Editor**: breadcrumb bar 34px (`interpretability / superposition / feature-splitting.md`, SOURCE/PREVIEW toggle); title 25px; property line (`status: open · started · anchors: 4`); body at 15px/1.65.
- **Anchor rail, 244px**: tabs ANCHORS / BACKLINKS / INFO; anchors listed with a 3px left bar (brass when active), type and backlink count; LINKED SOURCES with paper chips; FEEDS IDEA card showing the idea this note supports.
- Prop `paletteOpen` overlays the command palette here (see 08).

### 02 — Editor, focused · 1280×700

Wide editor, 680px measure, plus a 272px anchor rail.

- The selected passage is washed `rgba(229,182,74,0.22)` with a 1px brass outline.
- **Anchor popover** sits *below* the selection with 46px of reserved clearance — it must never cover adjacent text. 31px tall, `--color-bg-raised`, brass border, 3px radius. Buttons: **Anchor** (filled sapphire-equivalent primary), Link to…, New idea, Cite, then `⌥⌘A`.
- Rail: NEW ANCHOR editor (slug field with brass underline, type chips claim/definition/equation/quote, explainer "Anchors follow the text. Rewording the passage keeps every link that points at it."), EXISTING · 4, POINTING HERE with quoted excerpt snippets.

### 03 — Sources · 1280×800

Sidebar 196px / list 404px / reader.

- **Sidebar**: COLLECTIONS (nested reading lists) · READ STATUS (Unread 31, Reading 6, Read 148, Skimmed 29 — each with a status dot) · TOPICS (same tag tree as Notes) · SAVED SEARCHES (Cited but unread 7, No highlights yet 18, Pre-2022 44) · pinned SCOUT INBOXES.
- **List rows**: status dot, title, mono metadata line (authors · year · venue), annotation line ("12 highlights · 4 anchors cite this" / "reading — p.22 of 61"), right-aligned link count `9↗`.
- **Reader**: paper header (title 17px, authors/year/DOI, actions *Cite as @Bricken2023*, *Note from this*, *12 highlights*, page indicator), then the PDF page rendered on `#FDFAF3` stock inside a `--color-bg-sunken` well; a highlighted passage uses the brass wash with a 3px brass left rule. Footer strip shows the most recent highlight and the note anchor it produced.

### 04 — Ideas, list + detail · 1280×800

Sidebar 196px / idea list 330px / detail.

- **Sidebar**: STATUS (All 19, Open 8, Supported 5, Contradicted 3, Parked 3) · TOPICS · NEEDS ATTENTION (Needs evidence 6, Stale 4+ weeks 4, Only one source 5, Unresolved conflicts 2).
- **List rows**: question 13.5px, status dot + label + a 44px confidence bar + numeric value, right-aligned `6n · 4s · 2h`.
- **Detail**: WORKING QUESTION label, question at 21px, status pill, 80px confidence bar, counts. Then the **evidence ledger** — two columns, SUPPORTS · 3 (green left rules) and CONTRADICTS · 2 (red left rules), each item with its source line (`note · feature-splitting#steerability-test`, `source · @Templeton2024 §3.2`). Below: a dashed drop target "Drop an anchor here to file it as evidence  ⌥⌘E", then LINKED NOTES · 6 and LINKED SOURCES · 4 side by side, then RELATED IDEAS with a relationship reason ("shares 3 sources", "cited as counter-evidence").
- Toolbar toggles List / Board / Matrix.

### 05 — Dashboard · 1280×800

Sidebar 196px / panel grid.

- **Sidebar**: DASHBOARDS (Overview 6 panels, Reading triage 4, Idea health 5, **Topic deep-dive 4** selected, + New dashboard) · SCOPE (tag chip `#interpretability`, `Last 90 days`, `+ scope filter`) · PANEL LIBRARY (Relationship graph, Coverage map, Tag co-occurrence, Orphans & unlinked — each with a checkbox and an `on` marker) · hint "Drag a panel into the grid, or drop it on an edge to split."
- **Grid**: 2 columns (1.4fr / 1fr) × 3 equal rows. Graph panel spans all three rows in column 1; Coverage, Tag co-occurrence, and Orphans & unlinked stack in column 2. Every cell occupied — no implicit tracks.
- **Panels**: 5px radius, `--color-bg-surface`, header 9px 13px with title + subtitle + a 3-dot drag handle.
  - *Notes ↔ sources*: force-directed graph, node radius encodes link count, series-1 notes / series-2 sources / series-3 ideas, brass-tinted edges for the active path; footer controls *Cluster by tag* / *Only unlinked*; legend bottom-right.
  - *Coverage*: horizontal bars, 142px right-aligned mono labels, sequential sapphire by magnitude, `notes · papers` on the right, one-line takeaway under a divider.
  - *Tag co-occurrence*: 5×5 matrix, sequential sapphire alpha, diagonal `--color-line`, caption below.
  - *Orphans & unlinked*: NOTE/SRC kind tag, title, reason ("no backlinks · 12 days", "read, never cited"), footer action.

### 06 — Menu bar extra · 1280×470

macOS menu bar over another app. 26px translucent bar; the Vitrine status item opens a 352px popover anchored below it.

- **Quick capture**: QUICK CAPTURE + `⌃Space`, a 66px capture field with brass caret, tag chips, and a **context row** — "Attach to *Weak-to-Strong Generalization* · detected from the frontmost window · p.6" with a checked sapphire checkbox. Destination selector (Inbox, `⌘↩ to file`) and a filled **Capture** button.
- **TODAY · 4 CAPTURES** list beneath, each with a mono timestamp.
- The point: reading a PDF in Preview, the capture already knows the paper and page, so one keystroke files it as an anchor rather than a loose note.

### 07 — Density & appearance

07a: the note list at comfortable density (410px). 07b: the full three-pane shell in the cream playbill variant (760px). Both are comparison artifacts, not app states.

### 08 — Command palette · 1280×700

Scrim `--color-bg-overlay` over a desaturated window; 760px panel, 5px radius.

- Header: search glyph, query with an inline completion in `--color-fg-muted`, scope filters (All / Notes / Anchors / Sources / Ideas).
- Body split: results (grouped NOTES · 4, ANCHORS · 2, SOURCES · 2, ACTIONS — each row is a mono kind tag + label + right-aligned meta; selection = raised fill + sapphire left rule) and a 268px **preview** rail with the highlighted result's title, excerpt, tags, and a stat table.
- Footer: `↑↓ navigate · ↩ open · ⌥↩ open in split · ⇥ scope · ⌘⌫ clear` with a result count and query time.

### 09 — Tag browser · 1280×800

New **Tags** tab. Sidebar 212px / tag page / 268px rail.

- **Sidebar**: full TAG TREE with nesting and counts; UNTAGGED (Notes 12, Sources 31).
- **Tag page**: `#interpretability` at 21px, a user-written description ("Behavioural work lives under #evaluation instead."), child-tag chips, then a segmented row *Notes 312 / Sources 96 / Ideas 7 / Anchors 41* (active underlined sapphire) over the filtered list.
- **Rail**: CO-OCCURS WITH (percentage bars, sequential sapphire) and IDEAS UNDER THIS TAG (status dot + question + status).
- Toolbar: *Rename tag*, *Merge into…* — renames must propagate to every note.

### 10 — Settings · 820×600

macOS settings window: 46px icon toolbar (General, Library, Editor, **Anchors**, Sources, Scouts, Appearance, Shortcuts), then a form with 186px right-aligned labels.

Anchors pane is the one designed, because it changes behavior:
- **Anchor shortcut** — recordable key field (`⌥⌘A`). Help: "Creating an anchor never modifies the note text; the anchor is stored beside it."
- **Default anchor type** — select (Claim).
- **When the passage changes** — three checkboxes: follow the edit silently via fuzzy re-match (on); flag for review if similarity drops below 0.6 (on); break the link and notify (off).
- **Naming** — select (Slug from the first six words).
- **LINKS** — link syntax segmented (`[[wiki]]` / `](md)` / both); unresolved links: show as pending and offer to create (on), collect in a "Missing notes" smart search (on).
- Footer: `41 anchors · 3 flagged for review`, *Review flagged*, primary **Done**.

### 11 — First run · 1280×700

Empty sidebar with zero counts in `--color-fg-disabled`; centered 600px column.

- "Point Vitrine at a folder" (25px) + the on-disk promise: "Your notes stay plain markdown files on disk. Anchors, links and ideas are stored beside them in a sidecar index — delete the app tomorrow and the folder still reads."
- Three actions, the first sapphire-bordered: *Open a folder of markdown* (existing vault / Obsidian folder), *Start an empty library*, *Import a bibliography* (BibTeX or Zotero).
- Footer hint: `⌃Space` captures from anywhere, even before a library exists.

### 12 — Ideas board · 1280×700

The spatial alternate to 04. Dot-grid canvas (26px `radial-gradient`), four status columns (OPEN · 8, SUPPORTED · 5, CONTRADICTED · 3, PARKED · 3), cards with question, status pill, confidence bar, `n for / n against / last touched`, and a dashed `+ idea` target per column. Drag moves an idea between statuses.

---

## Interactions & behavior

- **Anchor creation**: select text → popover appears *below* the selection after ~120ms → `⌥⌘A` or click **Anchor** → slug field focuses with a generated slug → type chip selects the kind → Return commits. Never mutates note text.
- **Anchor re-match**: on save, fuzzy-match each anchor against the new text. ≥0.6 similarity re-binds silently; below that, flag for review (surfaced in Settings and as a badge on the rail).
- **Highlight → anchor**: highlighting in the PDF reader offers to create an anchor on a note; the resulting anchor records paper + page + type.
- **Evidence filing**: drag an anchor from the rail onto an idea's supports/contradicts column, or `⌥⌘E`. Confidence is user-set, never computed.
- **Command palette**: `⌘K`. `⇥` cycles scopes, `↑↓` moves selection and updates the preview rail live, `↩` opens, `⌥↩` opens in a split.
- **Quick capture**: `⌃Space` globally; reads the frontmost app to pre-fill attachment context; `⌘↩` files to Inbox.
- **Tag rename/merge** rewrites tags across notes and sources; show an undoable confirmation with an affected count.
- **Dashboards**: panels drag from the library into the grid; dropping on a panel edge splits it; the scope block filters every panel at once.
- **Density** is a global preference, not per-view.
- Respect `prefers-reduced-motion`; transitions ≤150ms, ease-out.

## State

- Library root (folder path), index of notes / sources / anchors / ideas / tags.
- Per-tab selection state, independent per tab; window restores all five tabs.
- Note: body text, frontmatter properties, tags, anchors, backlinks (derived).
- Source: metadata, read status, collections, highlights, file path.
- Idea: question, status enum, confidence float, evidence items (each pointing at an anchor or a source location, with a polarity), linked notes/sources (derived), last-touched.
- Dashboard: name, panel list with grid positions, scope filters.
- Scouts: inbox counts only — no behavior designed.

## Data model note

Everything on disk should stay legible: markdown files for notes, a sidecar index for anchors/ideas/links. The first-run copy promises exactly this; don't design a database-only store that breaks that promise.

## Assets

**Icons are included** — see `icons/`, built from The Case (the Vitrine mark):

- `icons/svg/` — seven masters: `vitrine-mark.svg` (primary, exactly as specified in the brief), `vitrine-app-icon.svg` (1024 macOS squircle with sunken-navy ground and a brass hairline), `vitrine-mark-cream.svg` (playbill), `vitrine-mark-brass-flat.svg` (no gradient), `vitrine-mark-small.svg` (17–32px cut — taller pane, V pulled clear of the stepped neck so it doesn't read as a downward arrow), `vitrine-mark-16.svg` (16px cut — unstepped frame, V as one solid grid-snapped chevron; the steps and the two-stroke V fuse into a blob in a 4×4px field), `vitrine-mark-template.svg` + `vitrine-mark-16-template.svg` (alpha-only, for the menu bar).
- `icons/Vitrine.iconset/` — all ten macOS sizes. **Rename `-2x` back to `@2x` before running `iconutil`** (see command below); `@` could not be written here.
- `icons/menubar/` — `vitrineTemplate.png` @1x/2x/3x. Set `isTemplate = true` so the system tints it.
- `icons/web/` — 16/32/48/180/192/512 for favicon and web use.

```sh
cd icons && for f in Vitrine.iconset/*-2x.png; do mv "$f" "${f/-2x/@2x}"; done
iconutil -c icns Vitrine.iconset -o Vitrine.icns
```

Three cuts, by size: the **full mark above 32px**, the **small-size cut at 17–32px**, the **unstepped 16px cut at exactly 16px**. Don't scale one cut across all sizes. Clearspace equals the plinth height. Minimum size 16px.

Everything else still needs replacing: every glyph in the mockups is a simple inline SVG (circles, rectangles, 1–2 line strokes) or a text character — **replace all of them with SF Symbols**. The PDF figures are striped placeholders.

## Files

- `Vitrine.dc.html` — all 13 screens; open in a browser. Screen roots carry `data-screen-label`.
- `screenshots/` — a 2× PNG of every screen, named to match the sections above (`01-main-window.png` … `12-ideas-board.png`). Use the HTML for exact values; the PNGs are for orientation.
- `vitrine-design-system-brief.md` — the design system. Authoritative for color, type, the mark, and the accessibility contract.
- `icons/` — the icon package (see Assets).
- `support.js` — prototype runtime only; not part of the design.
