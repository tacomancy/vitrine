# CONTEXT.md — Vitrine vocabulary

The words Vitrine uses for its own concepts. Code, tests, docs, UI copy, and
commit messages use these terms exactly. Add a term here *before* using it
elsewhere; change one here *before* changing it anywhere else.

Where a term matches Obsidian's usage, that's deliberate (ADR 0002) — the
definition below is the one Vitrine commits to, and Obsidian is the tiebreaker
for anything left unspecified. Where the design package (`design/`, ADR 0004)
uses a word, that word wins over Obsidian's for user-facing copy.

The product is **Vitrine**. The mockups in `design/` say "Galaxy Brain"; that
label is stale and is not the product name.

## Scope

v1 covers the Obsidian-like core: **notes, tags, links, and library
navigation** (ADR 0003). Terms for later features are listed under § Reserved
so they aren't accidentally reused for something else.

## The library

- **Library** — a folder on disk that Vitrine opens as a unit. Everything
  Vitrine knows about is a file inside it. A library is plain files; it has no
  meaning beyond being a folder the user pointed Vitrine at. Obsidian calls
  the same thing a *vault*; any existing Obsidian vault is a valid library.
  One library is open at a time in v1 (ADR 0007).
- **Note** — one Markdown (`.md`) file in the library. A note's **title** is
  its filename without the extension. Notes may be nested in **folders**; a
  folder is just a filesystem directory and carries no semantics of its own.
- **Frontmatter** — an optional YAML block at the top of a note, delimited by
  `---` lines. Vitrine reads `tags` and `aliases` from it in v1; other keys are
  preserved untouched and shown as **properties** in the editor's property line.
- **Body** — everything in a note after the frontmatter. Markdown, extended
  with links and tags as defined below.
- **Attachment** — any non-Markdown file in the library (images, PDFs). v1
  shows them in the file tree and lets a note embed an image; it does not
  otherwise interpret them.
- **Sidecar** — Vitrine's own per-library state, kept in one hidden folder at
  the library root (ADR 0002). The first-run copy promises "delete the app
  tomorrow and the folder still reads"; the sidecar must never break that.

## Links

- **Link** — a reference from one note to another. Two syntaxes, both
  supported and both resolved the same way:
  - **Wikilink** — `[[Title]]`, resolved by title, library-wide, regardless of
    folder. `[[Title|shown text]]` displays alternate text.
  - **Markdown link** — `[shown text](path/to/note.md)`, resolved by path
    relative to the linking note.
  Links in v1 point to whole notes only; heading and block targets are parked.
- **Backlink** — the reverse of a link: from the target's point of view, every
  note that links to it. Backlinks are derived, never stored in the note.
- **Unresolved link** — a link whose target matches no note in the library.
  Rendered distinctly; following it offers to create the note.
- **Alias** — an alternate title for a note, declared in frontmatter
  `aliases`. A wikilink to an alias resolves to the note that declares it.
- **Embed** — `![[filename]]`. In v1, only images embed; embedding a note is
  parked.

## Tags

- **Tag** — a label attached to a note, written inline in the body as `#tag`
  or listed under `tags:` in frontmatter. A note has a tag if it appears in
  either place; the set is the union, deduplicated case-insensitively.
- Tags are **hierarchical**: `#parent/child` is a tag whose **parent** is
  `#parent`. A note tagged `#parent/child` is also counted under `#parent`.
  The **tag tree** is the set of all tags in the library arranged by this
  hierarchy, each with a **count** of notes carrying it or any descendant.
- **Untagged** — a note with no tags in either place.

## Navigation

- **Sidebar** — the left pane. In v1 it holds the **file tree** (folders and
  notes as they sit on disk), the **tag tree**, and fixed entries such as
  *All Notes*, *Recent*, and *Untagged*.
- **Note list** — the middle pane: the notes matching the current sidebar
  selection and any active **filter chips** (tags added or removed by the
  user), sorted by a chosen key.
- **Tag page** — the Tags tab's main pane for one tag: its description (if
  any), child-tag chips, and the notes under it.
- **Search** — full-text lookup across note titles and bodies. v1 is plain
  term matching, case-insensitive; no query language. Surfaced through the
  **command palette** (`⌘K`), which also lists actions.
- **Editor** — the pane where one note's body is edited. Source Markdown is
  always what's on disk; any rendering (**Preview**) is a view over it.
  Beside it, the **rail** shows the note's backlinks and info.
- **Window** — the single main window in which one library is open
  (ADR 0007). Everything below is a region of it.
- **Tab** — a top-level section of the window: **Notes** and **Tags** are
  functional in v1; the others are stubs (ADR 0005).
- **Index** — Vitrine's derived knowledge of the library: which notes exist,
  their tags, their links and backlinks, and search content. The index is
  built from the library and can always be rebuilt from it; it never holds
  anything the library doesn't (ADR 0002).

## Reserved

Names for concepts that ship after v1. Not designed, not to be used for
anything in v1, and not to be defined here until they graduate from
`BACKLOG.md`. The `design/` mockups illustrate each; those screens are
aspiration, not spec.

- **Source** — an external item (paper, article, page, file) brought into the
  library, with its own metadata, read status, and highlights.
- **Anchor** — a durable reference to a passage *within* a note, stored in the
  sidecar and re-matched when the text changes.
- **Idea** — a tracked working question with a status, a confidence, and
  ledgers of supporting and contradicting evidence.
- **Dashboard** — a user-composed grid of panels aggregating over the library.
- **Scout** — an agent that collects sources on the user's behalf.
- **Quick capture** — the menu-bar entry point that files a thought into the
  library from any app.

## Open terminology questions

None yet. When one appears, record it here with the candidates considered,
then resolve it with an ADR if it has consequences beyond naming.
