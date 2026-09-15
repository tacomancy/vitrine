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
  into a tree of folders, notes, and attachments; opening writes nothing to
  the folder. While open, the library is **watched**: a change made by any other tool is noticed and reflected
  (ADR 0014). The scan rules, each matching Obsidian:
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
  A note is **created** empty, titled `Untitled` — or `Untitled 1`,
  `Untitled 2`, … when that is taken — and may be **renamed** within its
  folder. A title is refused when it is empty, begins with `.` (the scan
  would hide it), contains `/`, or is already another note's title in the
  same folder, compared case-insensitively as the file system does. Renaming rewrites no link elsewhere: rename as a
  feature is parked (`BACKLOG.md`); this one exists for the new note's
  title.
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
    folder. `[[Title|shown text]]` displays alternate text; inside a table
    cell Obsidian writes that pipe as `\|`, and the backslash is table
    escaping, not part of the title. **Resolution**
    is case-insensitive and tries, in order: an exact path relative to the
    library root (`[[folder/Title]]`, with or without `.md`), a note's title,
    an alias, an attachment's filename. When two notes share a title, a bare
    `[[Title]]` resolves to the one with the shortest path — the fewest
    folders above it — then the first in library display order (ADR 0016);
    Vitrine's tie-break, since Obsidian writes path-qualified links in that
    case and does not document how it reads bare ones.
  - **Markdown link** — `[shown text](path/to/note.md)`, resolved by path
    relative to the linking note, percent-decoded. A destination with a URL
    scheme is **external**: not a link between notes, never unresolved.
  A wikilink inside a frontmatter value (`sources: ["[[Title]]"]`) is a link
  like any other — outgoing from the note and a backlink on its target — as
  in Obsidian. A link or embed whose target is an attachment resolves to
  that attachment; following it opens the file with the system. An embed
  resolves as a wikilink to its file would, or — when that finds nothing —
  as a Markdown link's path relative to the note; an embed of a URL is
  external. A note that links to itself has an outgoing link and no
  backlink.
  Links in v1 point to whole notes only; heading and block targets are
  parked. A link that carries a heading or block fragment (`[[Note#Heading]]`,
  `[[Note#^id]]`) is still a link to `Note` — the fragment is parsed and
  ignored, as Obsidian resolves the note part.
- **Backlink** — the reverse of a link: from the target's point of view, every
  note that links to it. Backlinks are derived, never stored in the note.
- **Unresolved link** — a link whose target matches no note, alias, or
  attachment in the library. Rendered distinctly; following it creates
  the note — titled by the target's last path component, in the folder
  a new note goes in — and opens it.
- **Alias** — an alternate title for a note, declared in frontmatter
  `aliases`. A wikilink to an alias resolves to the note that declares it.
- **Embed** — `![[filename]]`, or the Markdown image form `![alt](filename)`.
  In v1, only images embed; embedding a note is parked. A display-width
  suffix (`![[image.png|800]]`) is parsed; Preview honors it as the image's
  width, as Obsidian does.

## Tags

- **Tag** — a label attached to a note, written inline in the body as `#tag`
  or listed under `tags:` in frontmatter. A note has a tag if it appears in
  either place; the set is the union, deduplicated case-insensitively. The
  rules, each matching Obsidian unless marked:
  - The **tag grammar**: a tag is letters, digits, `_`, `-`, and `/`, and
    must contain at least one non-digit (`#1` is not a tag). The grammar is
    the same in both places; a frontmatter value that fails it is not a tag
    and is dropped.
  - Inline, `#` counts only at the start of a line or after whitespace
    (`url/#frag` is not a tag), and trailing punctuation is not part of the
    tag (`#tag.` is `#tag`). In frontmatter a leading `#` is stripped.
  - Nothing inside a fenced code block or inline code is a tag.
  - **Vitrine differs:** nothing inside an HTML tag (`<mark style="… #FFF3A3A6">`)
    is a tag. Obsidian counts those; a hex color is not a tag by anyone's
    intent, and this is the one place v1 knowingly reads a note differently.
  - A tag names a topic, not a note, so its identity is case-insensitive.
    Each segment of a hierarchical tag is itself a topic, and a topic has
    one name: a segment's **display spelling** is the first spelling of it
    seen in library order across every tag that contains it, and a tag is
    displayed as its segments' spellings joined — `#Reading/paper` and
    `#reading/Notes`, in that order, display as `#Reading/paper` and
    `#Reading/Notes`, under one `Reading` in the tag tree. *Vitrine's own
    rule; Obsidian's is undocumented.*
- Tags are **hierarchical**: `#parent/child` is a tag whose **parent** is
  `#parent`. A note tagged `#parent/child` is also counted under `#parent`.
  The **tag tree** is the set of all tags in the library arranged by this
  hierarchy, each with a **count** of notes carrying it or any descendant;
  siblings sit in the same case-insensitive natural order as the file tree
  (two names that order the same, `01` and `1`, fall back to their paths).
  Each **node** of the tree is one tag: its **name** is its last segment's
  display spelling, its **path** the whole tag lowercased — its identity —
  and its **children** the tags one level down. A tag no note carries bare
  (`#interp` when only `#interp/saes` is written) is still a node. An empty
  segment is no segment: `#a//b` is `#a/b`, and a tag with none (`/`) is
  not a tag. *Vitrine's own rule; Obsidian's is unverified.*
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
  selection and every active **filter chip** — a tag the user has added to
  narrow the scope; a note must carry each chip's tag (or a descendant).
  Chips stack, survive a change of scope, and are cleared when the library
  changes. Clicking a tag anywhere on the Notes tab adds a chip.
- **Tag page** — the Tags tab's main pane for one tag: the tag, how many
  notes carry it (a link that opens the Notes tab scoped to it), its
  child-tag chips, and what it **co-occurs with** — the other tags carried
  by its notes, each as a share of those notes: a note counts once per
  other tag even if it carries both a parent and a child, and the tag's own
  ancestors and descendants are left out, since they co-occur by
  construction. In v1 the page holds no note
  list of its own; the Notes tab is where notes are listed and opened. A
  tag's description is parked (`BACKLOG.md`).
- **Search** — full-text lookup across note titles, aliases, and full text
  (frontmatter included). A query splits on whitespace into **terms**; a note
  **matches** when every term occurs as a substring, case- and
  diacritic-insensitively, anywhere in its title, aliases, or text. No
  phrases, operators, or field syntax — `#todo` is the text `#todo`.
  **Results** list notes whose title or alias contains every term first,
  then the rest, each group newest-modified first (ADR 0018). Surfaced
  through the command palette.
- **Command palette** — the overlay opened by `⌘K` or the title bar's search
  field. It shows search results as **NOTES** and the app's commands as
  **ACTIONS**, both filtered by the query; beside them a **preview rail**
  shows the highlighted note's title, the first matching line as its
  **excerpt**, its tags, and its link counts. With an empty query it lists
  **recent** notes. ↩ opens the highlighted note as following a link does;
  matched terms carry the brass highlight wash.
- **Recent** — the notes opened this session, most recently opened first:
  the same list the editor's back/forward history walks. Not persisted.
- **Editor** — the pane where one note is edited as **source** Markdown,
  frontmatter included, with the parser's ranges colored (ADR 0013). Source
  is always what's on disk: a note **autosaves** shortly after each pause in
  typing and whenever it leaves view, written back in place exactly as typed
  (ADR 0014). The **buffer** is the open note's text as the editor holds
  it: **clean** while it is what's on disk, **dirty** from an edit until the
  save that follows. **Preview** is a separate, read-only rendering of the
  same source — CommonMark with tables, task lists, and strikethrough;
  wikilinks, embeds, and tags rendered as what they resolve to; frontmatter
  hidden; raw HTML reduced to its text. SOURCE and PREVIEW are one setting
  for the editor pane, switched with ⌘E (ADR 0019). When
  another tool changes the open note, a clean editor reloads it; an editor
  with unsaved edits keeps them, shows *changed on disk*, and asks at the
  next save whether to overwrite or discard. When another tool removes
  the open note, the editor keeps its text, shows *removed from disk*,
  and offers to save it as a new note at the same path or to close it.
  Either is a **conflict**: the disk and the buffer disagree about the
  note, the editor's **bar** asks which wins, and no save runs until it
  is answered.
  Above the note, the **breadcrumb** is the bar showing the note's path
  relative to the library root. Beside the editor, the **rail** shows the
  note's **backlinks** — one entry per linking note, sorted by title, with
  the line of text around each link as **context**: one context per line,
  so a line that links twice reads once (ADR 0016), and a frontmatter
  link's context is its property line — and its **info**: path, modification
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
  every time a library opens (ADR 0012), and while the library is open it
  is kept **current** one note at a time — a note updated, added, removed,
  or renamed is folded in from its parse alone, no other note re-read or
  re-parsed (ADR 0017). What it folds into is the **parsed library**:
  every note in display order, each read note's parse, and the
  attachments — the one thing every table is derived from. Building it never fails: a note
  whose text cannot be read is **skipped** — recorded as such, and neither
  tagged nor untagged. Notes come out of the index in **library display
  order**: a folder's own notes, then each subfolder's in turn, every list
  in the file tree's case-insensitive natural order — the order the note
  list shows for a selected folder.
- **Parsing** — reading one note's text into its frontmatter, tags, links,
  embeds, and **structure** — the headings, fenced code blocks, and inline
  code spans the editor colors — without reference to any other note. Parsing is pure; what a
  link *resolves to* is the Index's business, not the parser's. Its result
  is a **parsed note**: the text it was read from, the frontmatter (if
  any), the **body tags** in order of appearance, the links, the embeds,
  the body's range, and the structure. Every token carries its **range**
  as UTF-8 offsets into that text, so the editor can point at it without
  a second parser, and a parsed note is complete on its own (ADR 0017). A
  **heading** is an ATX line — one to six `#` and a space — with its level
  and the whole line's range (a `#` alone on a line is text: CommonMark's
  empty heading has nothing to color); a fenced code block's range runs from its
  opening fence to the end of its closing fence's line (or of the text,
  unclosed); an inline code span's covers both backtick runs. Emphasis,
  lists, block quotes, and tables are not structure in v1.

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
