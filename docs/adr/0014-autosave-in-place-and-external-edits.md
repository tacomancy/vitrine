# 0014: Autosave in place; external edits reload a clean note and warn on a dirty one

**Status:** Accepted

## Context

Editing (ADR 0013) means Vitrine writes files for the first time, into a
folder Obsidian may have open at the same moment (ADR 0002). Two questions
from `BACKLOG.md` come due together: how Vitrine notices files changed by
another tool while a library is open, and what happens to an open editor
when its file changes underneath it. `docs/research/editor-approach.md`
§ 6 established the primitives: FSEvents with file-level events is the only
watcher that sees an uncoordinated writer such as Obsidian, and it can mark
and ignore Vitrine's own writes; `NSFilePresenter` fires only for
coordinated writers; NSDocument's documented model is detect-at-save and
warn, not silent reload.

## Decision

**Autosave.** A note is written ~1 s after the last keystroke, and
immediately on note switch, focus loss, library switch, and quit. There is
no dirty indicator; ⌘S saves at once and is otherwise a no-op. The whole
buffer is written back as text — frontmatter included, exactly as typed
(ADR 0011's never-re-serialize rule is met by construction).

**In place.** The file is overwritten in place, not written to a temporary
file and renamed. Obsidian writes in place; matching it means the inode is
stable and every other watcher and sync client sees a plain modification.
Accepted risk: a crash mid-write can leave a truncated file — the same risk
Obsidian carries, and the reason autosave is frequent.

**The library is watched** by an FSEvents stream on the library root with
file-level events, ignoring events Vitrine itself caused. The watcher is a
seam in the core package, testable against a temporary directory. On an
event: an added, removed, or renamed entry rescans the affected folder; a
modified note is re-read, re-parsed, and the Index updated incrementally.

**The open note, on an external change:**

- **Clean buffer** (no unsaved edits): reload silently, restoring the caret
  and scroll position where the new text allows. This is Obsidian's
  behavior and what a user switching between the two apps expects.
- **Dirty buffer** (unsaved edits pending): keep the user's text. The
  breadcrumb bar shows *changed on disk*. The pending autosave is held.
  At the next save — explicit or implicit — Vitrine asks: **overwrite** the
  file with the buffer, or **discard** the buffer and reload. No merge.

**Rejected.** Always notifying, even for a clean buffer (noise for the
common Obsidian-and-Vitrine case). Attempting a text merge (an algorithm
nobody asked for, with failure modes worse than the question). Atomic
write-and-rename (safer, but every other tool sees delete-and-create).

## Consequences

- **+** Two apps on one folder behave as Obsidian users already expect;
  nothing is lost silently in either direction.
- **+** The watcher makes "scan on open only" (spec #8) a thing of the past
  without touching `Library.open`.
- **−** In-place writes are visible to sync clients as modifications, which
  is the intent; flipping to atomic later is one function but externally
  visible, so it would be a new ADR.
- **−** A held autosave on a dirty, externally changed note means the on-disk
  file lags until the user answers. Accepted; the alternative is silent
  loss on one side.
- The FSEvents stream's own-write marking is the mechanism that keeps
  Vitrine from reloading its own saves; a test proves it.
