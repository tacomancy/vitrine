# 0007: One library, one main window, in v1

**Status:** Accepted

## Context

`CONTEXT.md` assumed one library open at a time and `BACKLOG.md` asked for
that to be confirmed or rejected before any window/scene architecture is
fixed. The scaffold's `App` declaration (ADR 0006) fixes it, so the question
is due now.

## Decision

v1 opens **one library at a time**, shown in **one main window**. The app
declares a single `Window` scene; the five tabs (ADR 0005) live inside it.
Opening a different library replaces the current one in that window.

Rejected for v1: multiple windows onto one library (Obsidian allows this;
cheap to add later by moving to `WindowGroup`), and multiple libraries open
at once (needs a per-library state model v1 has not designed).

## Consequences

- **+** One `Library`, one `Index`, one selection state — no cross-window
  synchronization anywhere in v1.
- **−** No "open note in new window." Accepted; it is the cheap extension
  path if it's ever wanted.
- **−** Switching libraries is a replace, not a second window. Accepted.
- Any later ADR that introduces a second window or a second library
  supersedes this one and must say what happens to the `Index` and the
  sidecar of the library being left.
