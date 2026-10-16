# 0045: The attention scatter stores monthly counts, syncs only after a first press, and keys Lexicon edits to the Tag as written

**Status:** Accepted

Beat 10 (#178, spec #636) draws the Question Map's second panel on ADR 0018's Lexicon. ADR 0018 left four things to this beat's grill, and each is expensive to change once a vault holds data written under it. This ADR is from a `grill-with-docs` pass on 2026-10-16. It does not reopen ADR 0018 or ADR 0041.

## Decisions

1. **A Measurement stores the field's monthly publication counts, never the growth.** For each measured Tag: the compiled query, the count for each of the last 24 complete months (the current month is partial and excluded), and when. Growth is derived on read as (last 12 − prior 12) ÷ prior 12, so the definition can change without a re-fetch. One yearly `group_by` call would be cheaper, but it cannot give a trailing twelve months and fixes the definition at fetch time; about 24 one-credit calls per Tag stays near $0.07 a day for 20 Tags (research #132). Measurements are App state that survives an Index rebuild, not Index rows, because they cost budget to re-fetch.
2. **The sync measures the default depth, and any other depth the first time it is viewed.** A rolled-up parent is its own Tag with its own Lexicon and query, so depths multiply the work. Measuring every Tag at every depth spends the keyless budget on points nobody looked at; measuring only the visible depth makes every depth change a wait. A depth viewed is queued once and then kept.
3. **Seeds and Exclusions belong to the Tag as written.** Keyed by the full Tag path of the Tag the editor was opened on. A parent's Seeds are not its children's and a child's never reach its parent: a parent's Lexicon is derived from the union of its descendants' papers, never from their Lexicons, so "flat, not inherited" holds in both directions (ADR 0018 d.2).
4. **The first *Sync now* is the consent; sync is automatic after it.** Terms come from the text of the user's own papers and so say what they are researching; they go to OpenAlex, which needs no credential. A vault in which *Sync now* has never been pressed makes no outbound request on open, and the panel says nothing has been synced, with every placeable Tag *not yet measured*. After the first press, due-on-open sync runs (stale after 7 days, or the compiled query changed) with no timer. Settings' *What it talks to* names OpenAlex and what is sent. This is a decision about network use, not credentials: the BYOK invariant is untouched.
5. **Unplaced has two named causes.** Fewer than N = 3 of the Tag's papers have text and no Seed, or the field's count for the prior 12 months is below **50** (below which a percentage is noise). The chip says which. Seed is offered in both; for the field cause the editor shows the measured counts.
6. **The axes cross at the median of the placed Tags**, stated on the chart, and with fewer than four placed Tags no quadrant is drawn and the Tags list as ranked.
7. **Keyword-overlap Candidate links** need at least two distinct Terms from one Lexicon of a Tag the row carries, found in the paper's phrase table, and apply only to papers sharing no Tag with the row. They rank after every shared-Tag candidate and name the Terms matched. A looser rule is the placeholder match ADR 0041 d.9 refused. This is the beat's last ticket and the first to be cut.
8. **The scatter's coverage is the Tag's papers, not the matrix's Coverage.** ADR 0018 d.2 and the glossary called them the same set; the code says otherwise: a matrix column counts Material attached to open Map rows carrying the Tag, so a tagged paper nothing points at counts nothing there, while it is a vote for the Lexicon. A point, its size and its Lexicon must agree, which is the reason ADR 0018 gave, so the scatter plots the papers held and says so on the chart in one line. The glossary's *Tag's papers* and *Coverage* each now say they are not the other.
9. **A Seed is normalised as a derived phrase and is 1–3 words.** Lower-cased, ASCII-folded, punctuation-stripped, so the editor, the phrase table and the query speak one unit. A Term already derived becomes seeded in place, so a later derivation cannot drop it; a Seed no paper contains is still compiled into the query, since it is the user's claim about the Tag's meaning. An empty, over-long or already-seeded Seed is refused on the control with its reason (ADR 0033).
10. **The sync's controls and its date.** *Sync now* queues every stale, pending or not-yet-measured Tag at the default depth and any viewed depth, in coverage order, and stops on `rate_limited`, saying how many are waiting. The *as of* line is the oldest measurement among the plotted points; an unmeasured Tag has no date and is listed as *not yet measured*. The first press opens a one-line confirm in the panel, not a modal, naming OpenAlex and what is sent, with *Sync* and *Not now*; *Not now* leaves the vault never-synced.

## Considered options

- **Yearly `group_by` counts.** Rejected, decision 1.
- **Measuring every Tag at every depth; only the visible depth.** Rejected, decision 2.
- **Seeds merged across parent and child on roll-up; keyed by the rolled-up path.** Rejected, decision 3: a Seed would reach Tags the user never opened.
- **Automatic sync on open from the first run; always manual.** Rejected, decision 4.
- **Fixed growth and coverage thresholds for the quadrants.** Rejected, decision 6: arbitrary for most fields.
- **Plotting the matrix's Coverage on the scatter.** Rejected, decision 8.
- **A modal consent; an average *as of* date.** Rejected, decision 10.
- **A route and Address for the Lexicon editor.** Rejected: the editor opens inline from a point and needs none.

## Consequences

- `docs/architecture.md` § Lexicon and § Question Map take the constants (24 months, 7 days, 50, K = 10, N = 3) and the shapes above.
- `CONTEXT.md` gains *Measurement* and *Not yet measured*, and sharpens *Unplaced*, *Excluded*, *Tag's papers* and *Coverage*. ADR 0018 d.2's "same set as Coverage" is read as decision 8 corrects it.
- Reversibility, hardest first: the stored Measurement row and `lexicon.json` keying, the consent rule (a vault that has pressed *Sync now* cannot be un-asked), the unplaced causes, the median rule, then constants.
