# 0016: Same-title links resolve by depth; a line is one backlink context

**Status:** Accepted

## Context

`CONTEXT.md` § Links says a bare `[[Title]]` shared by two notes resolves to
"the shortest path, then the first alphabetically" — Vitrine's own rule,
since Obsidian writes path-qualified links in that case and does not
document how it reads bare ones. Ticket #26 left two readings open:
*shortest* in characters or in folders, and whether a line that links to
the same note twice is one context in the rail or two. The Obsidian
fixture cannot tell the readings apart, so the choice had to be made
before the first test.

## Decision

- **Depth, then library display order.** Among notes sharing a title (or an
  alias, or attachments sharing a filename), the one with the fewest
  folders above it wins; at equal depth, the first in library display
  order — the file tree's case-insensitive natural order, folder by folder.
  A folder's name length never decides.
- **One context per line.** A backlink's contexts are the lines of the
  linking note that contain a link to the target, each line once, in
  document order. Two links on one line are one context; two lines with
  identical text are two.

## Consequences

- **+** The winner is the note the file tree shows nearest the root and
  first — what a user scanning the sidebar would guess. Renaming a folder
  cannot change which note a link reaches unless it changes the order.
- **+** The rail lists lines, so a table row or sentence that cites a note
  twice reads once; the INFO count of outgoing links still counts links.
- **−** A tie between `a/Note.md` and `b/Note.md` is broken by folder name,
  which is arbitrary but stable. Obsidian would have written
  `[[a/Note]]`; a library written by Vitrine's future editor should too.
- `CONTEXT.md` § Links and Editor record both rules in vocabulary terms.
