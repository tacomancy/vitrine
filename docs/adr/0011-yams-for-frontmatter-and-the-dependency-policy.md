# 0011: Yams parses frontmatter; dependencies are for formats we must match exactly

**Status:** Accepted

## Context

Note parsing has to read `tags` and `aliases` from YAML frontmatter the way
Obsidian does (ADR 0002). Obsidian parses with js-yaml, so a vault may hold
block lists, flow lists (`[a, b]`), comma-separated strings, quoted scalars
with escapes, comments, multi-line scalars, and the singular `tag:` /
`alias:` keys. Swift has no YAML in its standard library. This is also the
first time Vitrine would take a third-party dependency, and
`CODING_STANDARDS.md` § 4 says adding one is an ADR.

## Decision

**Yams** (SwiftPM, MIT; the de-facto Swift YAML library, used by SwiftLint)
parses frontmatter, pinned to an exact version in the package manifest.

Two rules on how it is used:

- The parser reads `tags` and `aliases` **as nodes and takes their string
  form** — never by decoding to typed values. Yams resolves some scalars per
  YAML 1.1 (`yes`/`no`/`on`/`off` as booleans) where js-yaml does not; string
  form sidesteps the difference for the keys v1 reads.
- Frontmatter is **never re-serialized** through Yams or any library. The
  parser keeps the frontmatter's raw text and byte range beside the parsed
  view, so that when editing arrives (later spec) Vitrine writes the user's
  text back untouched — key order, quoting, and comments intact, as
  `CONTEXT.md` promises under **Frontmatter**.

Rejected: a hand-rolled subset (block/flow lists, quoting, escapes,
comments, comma strings — a test matrix we would own, every cell a place to
silently disagree with Obsidian, and it would still have to grow into a real
parser for the editor's property line); regex on the two keys (fails at the
first quoted comma).

**Dependency policy**, stated once: Vitrine takes a third-party package
only for an **externally specified format it must match exactly** (YAML
here; a Markdown grammar would qualify) — never for convenience, UI, or
architecture. Each one is its own ADR with an exact pin. The core package
must keep building with `swift test` and no network after first resolution.

## Consequences

- **+** Every YAML edge case Obsidian accepts, Vitrine accepts, with none of
  it in our test surface.
- **+** The full frontmatter node tree is in hand for the editor's property
  line later, at no further cost.
- **−** A C target (libyaml) in the build and a version to bump. Accepted.
- **−** Swift 6 strict-concurrency cleanliness of Yams is checked at
  implementation; `Scripts/test.sh` treats warnings as errors, so the pin
  is whatever version is clean.
- Any later dependency cites this ADR's policy in its own Context.
