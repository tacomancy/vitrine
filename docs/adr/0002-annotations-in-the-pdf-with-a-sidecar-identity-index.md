# 0002: Annotations live in the PDF; a sidecar index supplies identity

**Status:** Accepted

Annotations are stored in the PDF as standard annotation objects, never in a database beside it (`design-brief.md` § Annotation storage). That is what lets Preview on iPadOS annotate the same file, keeps annotations readable by any PDF tool, and keeps the vault plain files. Because PDF annotation objects have no reliable ID across editors, the app keeps its own sidecar index mapping a stable internal ID to page, rectangle, and quoted text, and re-matches on every ingest: quoted text first, geometry second. Anything that cannot be re-matched surfaces as an Unmatched annotation for a decision; it is never dropped.

## Consequences

- **+** Any PDF tool can read and write annotations; the Preview-plus-ingest reading path (ADR 0003) is possible.
- **−** Re-matching is load-bearing and can drift. It is one of the two pieces named in `CLAUDE.md` § Parallel work that are never worked in parallel with anything touching them.
- The sidecar's on-disk format and location are undecided and go in `docs/architecture.md` when chosen.

## Update (2026-09-19)

ADR 0006 placed the sidecar at `.vitrine/annotations/<source-id>.json`; ADR 0007 settled its fields and the re-matching tiers, and chose the engines. "Rectangle" above is quads in practice.
