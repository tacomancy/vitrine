# 0017: The Index stays current from cached parses, and a parse carries its text

**Status:** Accepted

## Context

ADR 0012 builds the Index in memory from a full scan and parse on every
open. Editing (ADR 0013) and watching (ADR 0014) mean one note at a time
now changes while the library is open — saved, created, renamed, or
changed by another tool — and the sidebar, tag tree, and rail must follow
without a rebuild: spec #38 asks that editing cost be independent of
library size, and that no other note be re-read or re-parsed. Two things
the Index answers with are not in a parse: which note a link resolves to
(a question over the whole library) and the line of text around each
link, the backlink's context (ADR 0016), which is sliced from the note's
text. Ticket #40 fixes the surface — `updating(note:parsed:)`,
`adding(note:parsed:)`, `removing(note:)`, `renaming(from:to:)` — as
taking a parse, not text.

## Decision

**The Index keeps every note's parse and recomputes its tables from
them.** Between opens it holds the library as parsed — every note in
library display order, each read note's `ParsedNote`, and every
attachment — and each of the four operations folds one change into that
and derives every table again: tag tree and membership, link resolution,
backlinks, unresolved links. O(notes) table work, no I/O, no parse of
any note but the one handed in. Resolution running over the whole cache
is what lets a new or renamed note catch links that were unresolved, and
loosen ones that were not.

**A `ParsedNote` carries the text it was parsed from.** Every range in a
parse is a UTF-8 offset into that text; with the text alongside, a parse
is complete on its own, and the Index can slice a context line for any
link at any time — which is what makes "a parse, not text" a sufficient
input. The Index therefore holds every note's text in memory, once, shared
by copy-on-write with whoever parsed it.

**Each operation takes `Note` values, not paths.** The ticket wrote
`updating(note: path, …)` and `renaming(from:to:)`; the Index answers
with `Note`s — in `untagged`, `notes(tagged:)`, `backlinks(to:)`, and
every resolved target — and a `Note` carries the modification date the
library reports now, which only the library can supply. So the caller
hands over the note as the `Library` holds it after the change:
`updating(_:parsed:)`, `adding(_:parsed:)`, `removing(_:)`,
`renaming(_:to:)`.

**Library display order is read off paths** when the Index places a note
the tree was scanned without: a folder's own notes before its subfolders',
every list in the file tree's case-insensitive natural order — the same
rule `Library` applies while scanning, applied to two paths.

**Rejected.** Passing the text beside the parse (two arguments that must
agree). Slicing contexts at read time and keeping only those (the cache
would then hold something a parse cannot regenerate, and the Index would
still need text for any later question). Diff-patching the tables per
change — tier 3 — stays behind this same surface for when a measured
recompute is slow enough to notice; none has been.

## Consequences

- **+** One code path derives every table, on open and on every change,
  so the two can never disagree; a currency bug is a build bug.
- **+** Editing a note costs a recompute over parses already in memory —
  the same whatever the library's size on disk.
- **+** A parse can be handed around, stored, or compared without the
  string it came from riding beside it.
- **−** The Index's memory is the library's text plus its parses. At v1
  scale — a few megabytes for a real vault — that is nothing; the trigger
  in ADR 0012 (10,000 notes, a second to first paint) is the one to watch
  here too.
- **−** Recompute is O(notes) per keystroke-save, not O(1). Accepted until
  measured; tier 3 replaces the recompute, not the surface.
- An attachment added or removed while the library is open is not yet
  folded in; links to it resolve at the next open. The ticket that
  consumes the watcher on screen decides whether the Index needs
  `adding(attachment:)` or a fresh build.
