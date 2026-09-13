# 0003: v1 ships the Obsidian-like core only

**Status:** Accepted

## Context

Vitrine's full ambition includes agentic source collection, high-level
dashboards, and research-idea tracking on top of a note-taking core. Building
those before the core exists would mean designing them against nothing, and
would delay the point at which Vitrine is usable at all.

## Decision

v1 is exactly: **notes, tags, links, and library navigation** — the terms as
defined in `CONTEXT.md`. Concretely, a user can open a vault, browse it by
folder and by tag, search it, read and edit notes, follow links and backlinks,
and create notes — with results that Obsidian would read identically.

Source collection, dashboards, and research ideas are parked in `BACKLOG.md`.
Their names are reserved in `CONTEXT.md` § Reserved. No v1 code, schema, or
data structure is added "in anticipation" of them; if v1 genuinely needs an
extension point for one, that is its own ADR.

## Consequences

- **+** A clear finish line for v1 and a usable app at the end of it.
- **+** Later features are designed against a real, tested core and a real
  vault rather than a hypothetical one.
- **−** Some v1 choices will need revisiting when the parked features arrive.
  That's accepted; it's cheaper than guessing now.
- The order in which parked features come off the backlog is not decided here.

## Update (2026-09-13)

ADR 0005 makes one deliberate exception to "no v1 code is added in
anticipation": the window's tab strip ships in full, with non-v1 tabs as
inert stubs. Nothing else is exempted.
