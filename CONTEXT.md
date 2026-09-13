# CONTEXT.md — Vitrine vocabulary

The words Vitrine uses for its own concepts. Code, tests, docs, UI copy, and
commit messages use these terms exactly. Add a term here *before* using it
elsewhere; change one here *before* changing it anywhere else.

Where a term matches Obsidian's usage, that's deliberate (ADR 0002) — the
definition below is the one Vitrine commits to, and Obsidian is the tiebreaker
for anything left unspecified. Where the design package (`design/`, ADR 0004)
uses a word, that word wins over Obsidian's for user-facing copy.

The product is **Vitrine**. The screenshot PNGs in `design/screenshots/` still
say "Galaxy Brain"; that label is stale and is not the product name.

## Scope

v1 covers the Obsidian-like core: **notes, tags, links, and library
navigation** (ADR 0003). Terms for later features are listed under § Reserved
so they aren't accidentally reused for something else.

## The library

- **Library** — a folder on disk that Vitrine opens as a unit. Everything
  Vitrine knows about is a file inside it. A library is plain files; it has no
  meaning beyond being a folder the user pointed Vitrine at. Obsidian calls
  the same thing a *vault*; any existing Obsidian vault is a valid library.
  One library is open at a time in v1 (ADR 0007). Its **name** is the
  folder's name. Opening a library **scans** it — eagerly, completely, once —
  into a tree of folders, notes, and attachments; nothing is written to the
  folder. The scan rules, each matching Obsidian:
  - Every entry whose name begins with `.` is skipped, files and folders
    alike — `.obsidian/`, `.git/`, `.DS_Store`, and the sidecar.
  - Symbolic links are not followed; a symlink appears nowhere in the tree.
  - Within a folder, folders come before files, and each list is in
    case-insensitive natural order (`Note 2` before `Note 10`; `alpha` beside
    `Beta`) — Finder's order.
  - A folder with zero notes is a valid, empty library.
- **Note** — one Markdown file in the library: any non-hidden file whose
  extension is `.md`, matched case-insensitively (`.MD` is a note), as in
  Obsidian. A note's **title** is its filename without the extension; its
  **path** — relative to the library root — is its identity, since two notes
  in different folders may share a title. A note carries its **modification
  date** as the file system reports it. Notes may be nested in **folders**; a
  folder is just a filesystem directory and carries no semantics of its own.
- **Frontmatter** — an optional YAML block at the very top of a note: the
  first line is `---` and the block ends at the next `---` line. A `---`
  anywhere later is body text, as in Obsidian. Vitrine reads `tags` and
  `aliases` from it in v1 (also the singular `tag` and `alias` keys Obsidian
  honors), each as a list, a single string, or a comma-separated string;
  other keys are preserved untouched and shown as **properties** in the
  editor's property line. The block's raw text is kept as written and is
  never re-serialized (ADR 0011).
- **Body** — everything in a note after the frontmatter. Markdown, extended
  with links and tags as defined below.
- **Attachment** — any non-Markdown, non-hidden file in the library (images,
  PDFs), as in Obsidian. v1 shows them in the file tree and lets a note embed
  an image; it does not otherwise interpret them.
- **Sidecar** — Vitrine's own per-library state, kept in one hidden folder at
  the library root (ADR 0002). The first-run copy promises "delete the app
  tomorrow and the folder still reads"; the sidecar must never break that.

## Links

- **Link** — a reference from one note to another. Two syntaxes, both
  supported and both resolved the same way:
  - **Wikilink** — `[[Title]]`, resolved by title, library-wide, regardless of
    folder. `[[Title|shown text]]` displays alternate text. **Resolution**
    is case-insensitive and tries, in order: an exact path relative to the
    library root (`[[folder/Title]]`, with or without `.md`), a note's title,
    an alias, an attachment's filename. When two notes share a title, a bare
    `[[Title]]` resolves to the one with the shortest path, then the first
    alphabetically — Vitrine's tie-break; Obsidian writes path-qualified
    links in that case and does not document how it reads bare ones.
  - **Markdown link** — `[shown text](path/to/note.md)`, resolved by path
    relative to the linking note, percent-decoded. A destination with a URL
    scheme is **external**: not a link between notes, never unresolved.
  A wikilink inside a frontmatter value (`sources: ["[[Title]]"]`) is a link
  like any other — outgoing from the note and a backlink on its target — as
  in Obsidian. A link or embed whose target is an attachment resolves to
  that attachment; following it opens the file with the system.
  Links in v1 point to whole notes only; heading and block targets are
  parked. A link that carries a heading or block fragment (`[[Note#Heading]]`,
  `[[Note#^id]]`) is still a link to `Note` — the fragment is parsed and
  ignored, as Obsidian resolves the note part.
- **Backlink** — the reverse of a link: from the target's point of view, every
  note that links to it. Backlinks are derived, never stored in the note.
- **Unresolved link** — a link whose target matches no note, alias, or
  attachment in the library. Rendered distinctly; following it offers to
  create the note (that offer arrives with editing; until then following
  one does nothing).
- **Alias** — an alternate title for a note, declared in frontmatter
  `aliases`. A wikilink to an alias resolves to the note that declares it.
- **Embed** — `![[filename]]`. In v1, only images embed; embedding a note is
  parked. A display-width suffix (`![[image.png|800]]`) is parsed and ignored.

## Tags

- **Tag** — a label attached to a note, written inline in the body as `#tag`
  or listed under `tags:` in frontmatter. A note has a tag if it appears in
  either place; the set is the union, deduplicated case-insensitively. The
  rules, each matching Obsidian unless marked:
  - A tag is letters, digits, `_`, `-`, and `/`, and must contain at least
    one non-digit (`#1` is not a tag). Trailing punctuation is not part of it.
  - Inline, `#` counts only at the start of a line or after whitespace
    (`url/#frag` is not a tag). In frontmatter a leading `#` is stripped.
  - Nothing inside a fenced code block or inline code is a tag.
  - **Vitrine differs:** nothing inside an HTML tag (`<mark style="… #FFF3A3A6">`)
    is a tag. Obsidian counts those; a hex color is not a tag by anyone's
    intent, and this is the one place v1 knowingly reads a note differently.
  - A tag's **display spelling** is the first spelling seen in library order;
    its identity is case-insensitive.
- Tags are **hierarchical**: `#parent/child` is a tag whose **parent** is
  `#parent`. A note tagged `#parent/child` is also counted under `#parent`.
  The **tag tree** is the set of all tags in the library arranged by this
  hierarchy, each with a **count** of notes carrying it or any descendant.
- **Untagged** — a note with no tags in either place. This is the sidebar's
  fixed entry for it; screen 01 of the mockups labels the same row "Unfiled",
  which is a different, reserved concept (§ Reserved) and is not used.

## Navigation

- **Sidebar** — the left pane. In v1 it holds the **file tree** (folders and
  notes as they sit on disk), the **tag tree**, and fixed entries such as
  *All Notes*, *Recent*, and *Untagged*. The sidebar picks the note list's
  **scope**: exactly one row is selected at a time, whichever section it is
  in — selecting a tag deselects a folder and vice versa. Narrowing a scope
  further is what **filter chips** are for.
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
  Above the note, the **breadcrumb** is the bar showing the note's path
  relative to the library root. Beside the editor, the **rail** shows the
  note's **backlinks** — one entry per linking note, with the line of text
  around each link as **context** — and its **info**: path, modification
  date, tags, and counts of outgoing links, backlinks, and unresolved
  links. Following a link opens its target in the editor without changing
  the sidebar's scope; **back** and **forward** (⌘[ / ⌘]) walk the notes
  opened this session.
- **Window** — the single main window in which one library is open
  (ADR 0007). Everything below is a region of it.
- **First run** — what the window shows when no library is open: the
  on-disk promise and the action to open a folder as a library. It is also
  what the window shows when the last-opened library can no longer be found.
- **Tab** — a top-level section of the window: **Notes** and **Tags** are
  functional in v1; the others are stubs (ADR 0005). The **tab strip** is
  the drawn row of tabs under the **title bar** (ADR 0008).
- **Gutter** — the 8 px transparent gap between and around the window's
  panes; dragging one resizes its neighbours. Panes are **floating
  surfaces** on the window's ground, with no rule drawn between them
  (ADR 0008).
- **Index** — Vitrine's derived knowledge of the library: which notes exist,
  their tags, their links and backlinks, and search content. The index is
  built from the library and can always be rebuilt from it; it never holds
  anything the library doesn't (ADR 0002). It lives in memory and is rebuilt
  every time a library opens (ADR 0012).
- **Parsing** — reading one note's text into its frontmatter, tags, links,
  and embeds, without reference to any other note. Parsing is pure; what a
  link *resolves to* is the Index's business, not the parser's.

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
- **Unfiled** — a source a scout has returned that the user has not yet
  reviewed. Not a note state and not "untagged".
- **Quick capture** — the menu-bar entry point that files a thought into the
  library from any app.

## Open terminology questions

None open. When one appears, record it here with the candidates considered,
then resolve it with an ADR if it has consequences beyond naming.

Resolved without an ADR:

- *Untagged* vs *Unfiled* (2026-09-13). The mockups use both for the
  sidebar row counting notes with no tags (screen 01 "Unfiled 12", screen 09
  "Untagged 12"). Resolved: the row is **Untagged**; **Unfiled** is reserved
  for sources returned by a scout and not yet reviewed.
