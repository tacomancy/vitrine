# 0034: An edit made in Obsidian is marked if Evidence stood at either end of its window

**Status:** Accepted

ADR 0031 decision 4 marks a change to a Criterion's text or Relationship made *while Evidence is attached* as *Edited after evidence*. On the page that moment is exact: each edit is its own write, judged against the file as re-read just before it. An edit made in Obsidian is not seen that way. The watcher parks one Revision per field and keeps it open for thirty minutes of further edits (ADR 0020 decision 3), so when it is spliced the core has two texts, the section before the first edit and the section after the last, with any number of Obsidian saves between them. Spec #327 said to judge the suffix "against the file's previous text". Building #336 showed that this leaves a hole: within one window, name a run and then reword the Criterion to fit it, and the previous text shows no Evidence. That is exactly the move the mark exists to catch.

## Decisions

1. **Evidence at either end of the window counts.** A Criterion changed in Obsidian is marked if its text or Relationship moved and a line sat under it before the window, after it, or both. Which Criteria changed, and what they changed from, is still judged against the previous text. Only *tested* reads both ends.
2. **The page's rule is unchanged.** It sees each edit as it happens, so it judges the moment before, as ADR 0031 decision 4 says.
3. **A splice with no `## Criteria` heading to judge against is written unjudged.** The row becomes a quiet `· criteria` entry holding the whole section as it was. Without that heading, every Criterion would read as deleted, and a tested one would get the loudest entry there is, permanently, for what may be a heading retyped mid-edit.

## Considered options

- **The previous text alone, as the spec worded it.** Rejected: under that rule, *name the run, then reword to fit* is invisible whenever it happens inside one window, and the whole point of the ticket is that the guard does not depend on the tool.
- **Stop coalescing criteria rows, so each Obsidian save is judged on its own.** Rejected: Obsidian saves every couple of seconds while typing, so one rewording would become a dozen entries, in the section whose point is that it reads as a train of thought.

## Consequences

- **+** Moving the bar in Obsidian cannot slip past the mark by fitting inside a window.
- **−** The honest order, rewording first and naming the run afterwards within one window, is also marked when made in Obsidian, though the page would not mark it. The entry stays loud, and the page offers a why on it like any marked entry.
