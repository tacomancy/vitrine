# BACKLOG.md — Vitrine

Things captured so they aren't lost, without pretending they've been thought
through. A name and a sentence or two — not a spec. When an item is ready to
be built, it graduates into `CONTEXT.md` and/or an ADR and is removed from here.

Nothing in this file is v1 (ADR 0003). Where a `design/` screen illustrates an
item, it's noted — those screens are aspiration, not spec (ADR 0004).

## Parked features

- **Sources.** External items (papers, articles, pages) as first-class objects
  with metadata, read status, collections, a PDF reader with highlights, and
  BibTeX/Zotero import. Must survive ADR 0002 (plain files + sidecar). Screen 03.
- **Anchors.** Durable references to a passage inside a note, stored in the
  sidecar, re-matched by fuzzy similarity when the text changes, and the target
  of links from ideas and sources. The design's #1 distinguishing feature — and
  the one with the most unanswered questions (storage format, re-match
  threshold, what happens on a failed match). Screens 02, 10.
- **Ideas.** A tracked working question with a status, a user-set confidence,
  and separate supporting/contradicting evidence ledgers pointing at anchors or
  source locations. List, board, and matrix views. Likely depends on Anchors
  and Sources. Screens 04, 12.
- **Dashboards.** User-composed grids of panels (relationship graph, coverage,
  tag co-occurrence, orphans) scoped by tag and date. Depends on the Index
  being rich enough to feed them. Screen 05.
- **Scouts.** Agents that collect sources — fetch papers, follow citation
  trails — into inboxes; what they return is *unfiled* until the user reviews
  it (`CONTEXT.md` § Reserved). Only the sidebar block is designed. Needs:
  where agents run, what "collection" produces on disk, how it's reviewed.
- **Quick capture.** A menu-bar extra (`⌃Space`) that files a thought from any
  app, pre-filling context from the frontmost window. Screen 06.
- **Light "playbill" appearance.** Dark only in v1 (ADR 0009); light fills in
  the second value of each token-named color asset. Screen 07b.
- **Live-preview editing.** Obsidian-style hidden syntax except around the
  caret. Parked with its cost from `docs/research/editor-approach.md`:
  TextKit 2 has no replacing decoration, so it is custom layout fragments
  plus selection-driven relayout — 3–4× the source editor — and it extends
  ADR 0013's editor rather than replacing it.
- **Rename, move, and delete notes.** Not in ADR 0003's v1 verbs (read, edit,
  create). Rename with Obsidian's `alwaysUpdateLinks` is a link-rewriting
  feature of its own; delete needs a trash policy. The one rename that ships
  with editing is naming a note at creation.
- **Tag rename / merge** across the whole library, with an undoable
  confirmation and affected count. Screen 09's toolbar. Plausibly early v2.
- **Tag descriptions.** A user-written paragraph per tag, shown on the tag
  page. Where it lives on disk is the question (sidecar? a note per tag?).
- **Smart searches.** Saved, named queries in the sidebar ("Read but not yet
  linked"). Needs a query model v1 deliberately doesn't have.
- **Heading and block links** (`[[Note#Heading]]`, `[[Note^block]]`) and
  **note embeds** (`![[Note]]`). v1 links and embeds are whole-note / image
  only.
- **Graph view.** Likely a dashboard panel rather than its own surface.
- **Keyboard-navigable note list and file tree.** Tab into the note list
  and the sidebar, ↑ / ↓ between rows, Return to open — the way the tab
  strip already takes focus. Today only the tab strip opts into the Tab
  loop; rows follow it only with macOS's Keyboard navigation setting on
  (surfaced reviewing issue #13). Plausibly a small `feat`; it touches
  the shared row button (PR #29) once and every row inherits it.
- **Templates, daily notes, plugins.** Obsidian features beyond the core.
  Unranked.
- **Sync / multi-device / iPadOS.** ADR 0001 keeps the door open and nothing
  more.
- **Obsidian companion package.** Investigate publishing an Obsidian theme
  and/or plugin alongside the finished app, so a library co-edited in both
  tools (ADR 0002) looks and behaves consistently. A theme alone can carry the
  brief's tokens, type, radii, and density but none of the shell (mode tabs,
  note list, rail); a plugin could read or write the sidecar so state Obsidian
  doesn't model survives a round trip. Open: whether it's worth maintaining a
  second codebase, whether to publish to the community directory, and font
  loading (theme CSS may not fetch remote fonts). Not before v1 ships.

## Open questions

Unresolved and blocking *something* — each should become an ADR when the thing
it blocks is next up.

- **MC/DC coverage.** Wanted in CI, unavailable: `swiftc` emits no branch
  coverage regions (ADR 0006). Mutation testing with Muter is the substitute
  (ADR 0015, Accepted: `Scripts/mutate.sh`, weekly and by hand, non-gating;
  first run 154 of 176 killed). Revisit if the toolchain grows branch
  regions, or if Muter's upstream merges the fix the pin waits on.
- **Sidecar folder name.** ADR 0002 reserves one; `.vitrine/` is the obvious
  candidate. Fix it when something first needs to go there.
