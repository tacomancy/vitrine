# 0018: Search is its own seam and scans the cached note texts

**Status:** Accepted

## Context

Search is the last ADR 0003 verb with nothing built. `CONTEXT.md` fixes what
it is — full-text over titles and bodies, plain term matching,
case-insensitive, no query language, surfaced through the command palette —
but not where it lives or how it matches. `CODING_STANDARDS.md` § 2 wants
search as its own module. The `Index` already holds every note's text (it
slices backlink contexts from it) and updates one note at a time (ADR 0017).

## Decision

**A `Search` seam**, separate from `Index`, built from the Index's cached
texts (`Search.build(from: Index)`) and kept current with the same
one-note-at-a-time operations. A query is matched by a **linear scan over
case- and diacritic-folded copies of each note's title, aliases, and full
text** — no tokeniser, no inverted index, nothing on disk.

**Matching** (recorded in `CONTEXT.md` § Search): the query splits on
whitespace into terms; a note matches when every term occurs somewhere in
its folded title, aliases, or text, as a substring. No phrases, operators,
or field syntax; `#` is a character. **Ranking:** notes whose title or an
alias contains every term first, then the rest; each group by modification
date, newest first.

**Revisit trigger** — as a new ADR superseding this one: a measured query
over a real library taking longer than the palette's debounce (~50 ms) to
return, which at typical note sizes means on the order of 10,000 notes.
Until then an inverted index is a cache for an unmeasured cost, the same
judgment ADR 0012 makes for the index as a whole.

Rejected: search inside `Index` (a second concern in one module; the
scanner and the folded copies have nothing to do with tags or links); an
inverted index now (tokenisation forces word-boundary semantics, which is
the narrower matching rule, and it is exactly the structure most likely to
be redesigned once a real query load exists); word-prefix matching (makes
`train` miss `retraining`; substring is Obsidian's default and every later
refinement of substring is an addition, not a change users feel).

## Consequences

- **+** One folding pass per note at build time; queries are a scan; nothing
  to invalidate beyond the per-note update the Index already performs.
- **+** Substring-AND is the widest plain rule, so operators or phrases
  later only narrow results for queries that use them.
- **−** Memory holds a folded copy of every note's text beside the original
  — roughly doubling text memory. Accepted at v1 scale.
- **−** No relevance scoring beyond title-first and recency. Accepted; the
  palette shows meta and an excerpt, which is how a user disambiguates.

## Update (2026-09-15, from the Search seam, #68)

The first measurement against the revisit trigger, on the real vault
(79 notes, 460 KB of text): building the folded copies takes ~4 ms, and
every query — including one matching nothing, which scans every byte —
returns in under 3 ms in a release build and under 10 ms in debug. That
is with the scan done by libc's `memmem`; the standard library's generic
`Collection` search over `[UInt8]` read the same text at about five
megabytes a second, ~100 ms per empty query, and would have tripped the
trigger on the very first library. The decision stands: the cost of a
linear scan is the byte search, not the design, and at this rate the
~50 ms debounce holds to a library some twenty times this size.
