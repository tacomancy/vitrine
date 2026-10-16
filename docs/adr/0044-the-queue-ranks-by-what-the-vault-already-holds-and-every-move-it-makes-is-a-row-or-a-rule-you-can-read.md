# 0044: The Queue ranks by what the vault already holds, and every move it makes is a row or a rule you can read

**Status:** Accepted

ADR 0016 decision 6 put the Queue's history-dependent mechanics on a Wait list and said a later beat's grill would reopen it. Beat 9 made accept rate visible, so the grill for beat 6b (#183) ran on 2026-10-16. It settled the half of the list that needs accept history; the half that needs the Lexicon or a second source still waits (decision 1). The rule every answer follows is ADR 0039's: **what the researcher did, or what the machine did on its own, is a row or a rule; nothing is inferred later from the absence of one.** `queue.sqlite` has no rebuild path (ADR 0006 d.10), which is why that is worth stating. Column names, numbers and sentences are `docs/architecture.md` § Scouts.

## Decisions

1. **Scope.** Ships: Rank and the rank sort, the counterweight slot, Lane moves, aging into a digest, Mute rules, per-Scout Caps, bulk reject and defer, and *group by Question*. Still waiting, each on the thing it needs: topic-cluster grouping, keyword-overlap ranking and Corroboration through the Lexicon (beat 10). Title merging leaves the list: `source_key` merges on arXiv id, DOI and url (ADR 0018), and a title match would be the fuzzy hiding ADR 0039 d.1 refused.
2. **Rank is derived at read time; there is no score column.** A stored score would freeze the history of the day it was written, in a database that cannot be rebuilt. It is an ordered comparison with no weights: authors with accepted work in the vault (Sources and stubs both, so hand-attached papers count), then Corroboration (distinct Scouts), then the number of Assigned Questions, then newest. Venue acceptance is read where a venue exists, which on arXiv is rarely. A reject counts against nothing — it is about a paper, not its author — and no number is offered for the researcher to tune. Review defaults to Rank, Skim stays newest-first, and the choice lasts the session. The card's *why* names the signals that fired. Keyword overlap needs the Lexicon (decision 1).
3. **Aging is a digest, not a demotion.** Review items older than the Scout's window collapse into one expandable line at the foot of the stack. They stay pending and stay in Review depth, since a demotion would shorten the count that Home and Scout Activity read without anyone having decided anything. The window is per Scout, 14 days by default.
4. **Mute rules are a vault-wide file read as found, applied at read time.** Author and venue match exactly after trim and case-fold; a keyword is a case-insensitive substring of title or abstract (there are no keywords on a Proposal). Adding a rule catches what is pending and what arrives; deleting it returns it. Both Lanes. A muted Proposal counts nowhere but *N muted* and writes no triage row, so it never touches Accept rate. Saving a rule first reports how many pending items it would catch. Only pending and deferred Proposals can be muted. Stored as a rule rather than flagged per Proposal so that a rule that is quietly wrong can be edited and everything it held comes back.
5. **A Cap keeps what it cuts.** The cut-off Proposals get state `capped`: counted, linked, never rejected, released by *show them*, and visible as *N below your cap of M*. It does nothing before the Scout has enough triage to rank by.
6. **One floor for "enough history".** Caps and the counterweight slot activate when a Scout has five counted triage acts — the floor Accept rate already uses. Rank sort works from the first card, because with no history its signals are all zero.
7. **The counterweight slot is one per Scout group per run, second from the top, labelled, and never filled with filler.** Eligible: found by two or more Scouts and none of its authors has accepted work in the vault. It is exempt from the Cap. Venue is dropped from the brief's test because arXiv rarely supplies it.
8. **Lane moves are recorded.** `triage` gains `demote` (a Review Proposal deferred a third time, undone defers not counted; it can still be promoted by hand) and `raise` (a Skim Proposal a second Scout also finds, because Corroboration crosses Lanes). A `raise` excludes the Proposal from Accept rate as a hand promotion does (ADR 0039 d.4): the Scout did not place it. The card says why it moved.
9. **Bulk acts are one row per Proposal plus one id for the gesture.** `triage` gains a nullable `bulk`; `batch` stays reject-this-run's run id. Reject group (`⇧R`) and defer group (`⇧D`) cover the pending Review cards in the group on screen. Bulk rejects count toward Accept rate, as reject-this-run's do. `⌘Z` undoes the whole gesture by compensating rows, for as long as its cards are in the session's stack (ADR 0039 d.6). No modal — the act says what it did and how to undo it.
10. **A Proposal appears in every Assigned Question's group.** *Group by Question* adds an *Unassigned* group, and says a paper can be in several. Acting on a card removes it from all of them, and a bulk act covers exactly the cards in its group. Group by Scout stays the default.
11. **The knobs live on the Scout.** Optional `cap`, `review_days` (14) and `skim_days` (30, today's constant) in the Scout file, under *Queue behaviour* on the form, per ADR 0025 d.2. Absent means the default; a value that does not parse is surfaced by name, as ADR 0039 d.7 does for a bad file.
12. **No new Loose Ends rows and no new Home items.** Nothing here fails: a Cap, a Mute rule and an aged item are choices. Home's *Review depth* reads the digest (older than window, muted excluded). Scout Activity's Volume line gains *N below your cap* and *N muted* beside *already in your vault*, plain counts that judge nothing (ADR 0042).

## Considered options

- **A stored score.** Rejected, decision 2.
- **A weighted score.** Rejected, decision 2: it invites tuning a number the researcher cannot judge.
- **Aging demotes to Skim.** Rejected, decision 3.
- **Mute as a flag per Proposal; mute as `queue.sqlite` rows.** Rejected, decision 4: the first cannot be corrected by editing a rule, the second cannot be read or edited by hand.
- **Dropping what a Cap cuts.** Rejected, decision 5: a silent cut is the failure `CLAUDE.md` § Invariants names.
- **Reusing `batch` for group acts.** Rejected, decision 9: it is a run id by ADR 0039 d.5 and beat 9 excludes by it.
- **A Proposal in its first Question's group only.** Rejected, decision 10: it would hide it from the rest.

## Consequences

- **+** Nothing is hidden or lost: a muted, capped or aged Proposal is one click from the stack and counted where it was cut.
- **+** The first card ranks the same as today until history exists, so the beat changes nothing for a new vault.
- **−** `queue.sqlite` moves to schema version 7: `capped` as a state, `demote` and `raise` as actions, `triage.bulk`. Additive.
- **−** Author overlap reads the vault's Sources on each read; the Source index makes it a query, but it is the cost of not storing a score.
- **−** Until the Lexicon lands, "outside the usual" means *corroborated by authors you have not accepted*, which on one source is a narrow slot.
