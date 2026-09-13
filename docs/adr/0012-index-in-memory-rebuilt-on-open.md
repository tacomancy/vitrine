# 0012: The index lives in memory and is rebuilt on every open

**Status:** Accepted

## Context

`BACKLOG.md` held "index storage" as the question blocking the Index:
in-memory, rebuilt when a library opens, or SQLite in the sidecar for a
faster reopen. ADR 0002 already fixes that the index holds nothing the
library doesn't and can always be rebuilt losslessly; the sidecar folder is
reserved but unnamed. The first Index (tags: per-note tags, the tag tree
with counts, untagged) is due now.

## Decision

**In memory, built once when a library opens, from a full scan and parse.
Nothing is written to disk.** The Index is a value derived from the
`Library` and the parsed notes; the sidecar stays unused and unnamed.

Revisit — as a new ADR superseding this one — when a measured reopen of a
real library is slow enough to notice: the trigger is a library of roughly
10,000 notes taking more than a second from open to first paint. Until
then, a persistent index is a cache for a cost nobody has measured.

## Consequences

- **+** No index file to invalidate, migrate, corrupt, or explain; no
  dependency; "delete the app tomorrow and the folder still reads" costs
  nothing to keep.
- **+** Every derived value (tag display spelling, counts, later backlinks)
  is recomputed from the files, so policy changes are code changes, never
  migrations.
- **−** Reopen cost grows with the library. Accepted at v1 scale; the
  trigger above says when it stops being.
- **−** Nothing survives between launches except the last-opened path
  (spec #8). Recent-files and open-history features will need app-level
  state of their own, not the index.
- The sidecar folder name remains open in `BACKLOG.md`; whatever first
  needs it names it.
