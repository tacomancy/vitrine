# 0054: The Scout Queue adapts to its own width, and a paper expands in place only where the panes stack

**Status:** Accepted

ADR 0053 brings the rail of Scout names back in front of the Queue's list and detail, which makes three columns on a surface that already shares the window with the app's sidebar. The panes sit side by side only at a viewport of 60rem and wider, split 2fr / 3fr (ADR 0052), and that query reads the window, not the room the Queue has left. Whether a paper should instead expand in place was asked as #851 (grilled 2026-10-26). The researcher triages on a fullscreen laptop, 1280 to 1512px with the sidebar open, so 1280px is the tightest normal case this designs for. It amends ADR 0052's layout and settles the question ADR 0053 left open.

## Decisions

1. **The detail pane stays on wide surfaces.** The brief's fast triage is one card at a time, keyboard-driven (§ Scout Queue, *Fast triage*). With a fixed list the rows hold still while J/K moves the choice and the detail changes beside them; expanded in a list, every row below the open one jumps on each key, on a first look that can bring in forty-odd papers.
2. **The panes stack, and the breakpoint follows the Queue's own width.** A container query on the Queue replaces the viewport query, so the rail, the sidebar and the window size all feed one rule. The threshold is a spec decision, set so the abstract keeps a readable line, about 60 characters, at 1280px.
3. **Where the panes stack, a paper expands in place.** Chosen and expanded are the same thing, so exactly one row is open and `useChosenInView` stays keyed on `aria-activedescendant` (ADR 0030). The cost named in decision 1 is paid only where there is no room for the alternative.
4. **The rail collapses to an icon strip.** About 48px, with each Scout's marker (ADR 0053 decision 3) still drawn, and it opens on hover or a key. The filter and the attention marker keep their job; most of the width goes back to the list.
5. **When room runs out, the rail yields first, then the list, then the detail.** The abstract needs a readable line; a list row is a title and one line of why.

## Considered options

- **A paper always expanding in place.** Rejected, decision 1: it trades the triage loop's stable rows for width the container query and the collapsed rail already return, and it reverses a design handoff (ADR 0052) for a layout detail.
- **A permanent rail of full names.** Rejected, decision 4: about 180px of a 1280px window for a filter.
- **The filter as chips or a dropdown above the list.** Not chosen, decision 4: it costs height and hides the markers; the fallback if Scout names will not abbreviate.
- **A peek that opens over the list on a key.** Not chosen, decision 1: a second way to see the same thing beside a pane that already shows it.
- **Prototyping the layouts first.** Skipped: the answer was structural, and the one open feel, line length beside a collapsed rail at 1280px, is a screenshot in the layout ticket (`docs/agents/run.md`).

## Consequences

- **+** The Queue holds at any window size and sidebar state, not only at the sizes a media query guessed.
- **+** The wide layout keeps its stable rows, so J/K is as fast as before.
- **−** Two layouts to keep in step, list-and-detail and expand-in-place, behind one chosen row.
- **−** The collapsed rail's open gesture and the container threshold are open until the spec.
- The spec carries: the container query, the collapsed rail and its markers, the expansion where stacked, a test that J/K moves one open row, and a 1280px screenshot checked for the abstract's line length. It is blocked on the rail's ticket from #850's spec, since both change the Queue's layout (CLAUDE.md, Parallel work).
