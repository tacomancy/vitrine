# 0046: A Scout filters by Tags or a Query, never both; Tags compile at every run and fail by name when none compile

**Status:** Accepted

Beat 10b (#179, spec #678) lets an arXiv Scout's Filter be Tags, on ADR 0018's Lexicon. The spec marked four calls **(confirm)** (its decisions 1, 2, 6 and 7); the maintainer confirmed the set and they shipped in #685–#691. This ADR records them with the decisions beside them that the code now depends on. It does not reopen ADR 0018 or ADR 0045 decision 3.

## Decisions

1. **A Filter is Tags or a Query, exclusive.** The file carries `filter.tags` or `filter.query`, never both and never neither; a file that does is unreadable and says which. Combining them is additive and can follow.
2. **Tags are stored as written and compiled at every run.** No Terms and no compiled string are stored on the Scout; each Tag's Lexicon is read at the Tag's own depth, so a parent searches the union of its descendants' papers and a child never takes its parent's Terms. Several Tags are OR'd.
3. **A run records the compiled query it asked** in `scout_runs.query`, so what any past run searched is readable and drift between runs is a named cause of a `parse` failure.
4. **A Lexicon change runs nothing.** Only saving an edited Filter runs a Scout. The window is untouched, so a Term added later does not find older papers; *also search back to* is the way to ask.
5. **A Tag with nothing to compile refuses the save and fails the run.** Save names the Tag and the way out (Seed a Term, or use a Query). A saved Scout whose Tags later compile to nothing, or whose Tag is gone, records a failed run of the new `error_kind` `tags` naming them, due at the next check, and never an `ok` run with no results. A run on several Tags where only some compile goes on with those and names the rest in its note.
6. **Switching a Filter keeps the Scout.** An existing arXiv Scout moves between a Query and Tags on its form as the same file, with its history and window.
7. **Tag Filters are for the arXiv source only,** and no Loose Ends row or Home item is added: the existing failed-Scout row carries the sentence.

## Considered options

- **Tags ANDed with a Query.** Rejected for now, decision 1: the exclusive form answers "what does it search?" once.
- **Storing the compiled query on the Scout.** Rejected, decision 2: it would drift from the Lexicon, which ADR 0018 promised cannot happen.
- **Running the Scout on a Lexicon edit.** Rejected, decision 4: editing Terms would spend arXiv's budget unasked.
- **Skipping a Tag that does not compile.** Rejected, decision 5: a typo or a renamed Tag would look like a quiet field.
