# 0010: After a capture, the keyboard follows the landing when the Inbox is on screen

**Status:** Accepted

Spec #102 asks two things of `↵` on the capture line that pull apart the moment they meet: story 28, *close the line and return focus to where I was, so capture does not pull me out of what I was doing*; story 37, *capturing while the Inbox is on screen, the new Question becomes the selected row, so I see it landed*. Ticket #107 joins them and had to choose where the keyboard goes when both apply. Decided: **when the surface on screen is the one the Question landed in, focus goes to the list, on the new row; otherwise it returns to where it was.** In this slice the Inbox is the only surface, so a successful capture always focuses the list; `esc` always restores focus. The Reader slice inherits the rule rather than re-deriving it: a capture made while reading returns to the page, because the Question landed somewhere else.

## Considered options

- **Always return focus to where it was** (story 28 read literally). Rejected for the Inbox: the selection has just moved to the new row, and a keyboard parked on the sidebar link means `j` does nothing until the user clicks — the row "landed" but the user cannot act on it.
- **Always focus the Inbox list.** Rejected: from the Reader it would pull the user out of the page, which is the interruption story 28 forbids.
- **A global store carrying "the last capture".** Rejected: ADR 0005 keeps the renderer store-free until a second surface needs one. The landing is one value held by the window component and handed down; when a second surface exists, that is the moment to revisit.

## Consequences

- **+** `j`/`k` act on the new Question immediately after `↵`; the loop the brief describes (wonder, capture, see it there) closes without a click.
- **+** The selection is keyed by `path`, not `id`: a row always has a path, while a file another tool wrote may have no `id` (ADR 0009). The capture returns both, and the router test holds them to the same file.
- **+** The rule is one sentence and lives in one place: `packages/renderer/src/App.tsx` hands the landed Question to the surface, and the surface decides whether it is on screen.
- **−** Story 28's "where I was" is, on the Inbox, overridden — a user who opened the capture line from the sort control finds focus on the list afterwards. Accepted because the sort control is two rows away and the new Question is what they came to see.
- **−** A later surface that can show a Question landing (Home's resurfaced questions, say) has to opt in to the same handoff; the default for a surface that ignores `landed` is the story-28 behaviour.
