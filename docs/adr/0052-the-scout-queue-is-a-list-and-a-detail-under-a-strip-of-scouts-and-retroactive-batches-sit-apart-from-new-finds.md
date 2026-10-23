# 0052: The Scout Queue is a list and a detail under a strip of Scouts, and Retroactive batches sit apart from new finds

**Status:** Accepted

The Review lane drew one card with every other pending title in a flat list beneath it, so a first look at a watched page (forty-odd papers) buried the handful an ongoing run found. A Claude Design handoff (option 1b, 2026-10-23) re-laid the surface: a health strip of tiles, one per Scout, that also filter; a ranked list on the left and the selected Proposal on the right; Retroactive batches in their own section; one footer channel for the last act and the keys. The mock is the layout; ADR 0044 and ADR 0042 remain the behaviour, and this record settles where every shipped thing lands in the new frame.

## Decisions

1. **The tile replaces the rail row and only filters.** One tile per Scout, drawn from the same `Health` the rail and Loose Ends read (ADR 0032 decision 7), so the Voice line is never reworded here. A dropped Scout with cards waiting and a Scout file that does not parse each keep a tile (the latter with its wrong-voice sentence, the former saying *dropped*), with `—` for Accept rate. A broken Scout therefore cannot hide in a strip nobody filters (spec #447 story 42).
2. **A filter opens a Scout header at the top of the list.** Under "only {Scout} · show all": cost, Assigned Questions, Edit, Pause/Resume, Run now, *N already in your vault*, *N below your cap of M · Show them*, and the deferred-while-dropped line. Nothing the rail's selected Scout showed is lost, and none of it is on the tile.
3. **Rank orders NEW FINDS; Retroactive batches sit below, unranked.** The detail's chips name only the signals that fired (ADR 0044 decision 2). The counterweight slot reads *outside the usual* in the row's second line in place of the rank summary and as a chip in the detail; a Lane move (*moved to Skim after three defers*, *raised*) is a chip in the detail; the digest stays one collapsed line at the foot of NEW FINDS.
4. ***Reject this run* is offered on a Retroactive batch only.** Accept rate already leaves a Retroactive run's rejects out (`COUNTED` in `triage.ts`, and the Accept rate entry in `CONTEXT.md`); ADR 0044 decision 9's "as reject-this-run's do" meant the bulk act's rows are one id per gesture, not that they count, and the footer says *not counted toward accept rate*. The group act (`⇧R`, `⇧D`) keeps clearing whatever list is on screen, so a run that was not Retroactive is cleared there and counts, as any reject does.
5. **Sort and Group by are text toggles in the header** (`sort: rank`, `group: scout`), each held for the session (ADR 0044 decision 2). Grouping by Question swaps the strip for Question tiles that carry a count and the line saying a paper can be in several.
6. **Skim and Muted are tabs in the same frame.** Skim is lines, newest first, with *show older* at its foot, and its detail offers Accept, Open and Send to Review, with no reject, defer or pass. Muted is the rules and what they hold, with *Mute by name* inside it; the header's *Mute rules* opens it too.
7. **Keys.** J/K move in both lanes beside the arrows Skim has; `U` undoes beside `⌘Z`; A, D, R, P and `⇧R`, `⇧D` are unchanged. Keys are ignored while focus is in an input, textarea, select or contenteditable (ADR 0030 holds: the list follows the chosen row).
8. **One footer channel.** The last act's words and *undo · U* sit left, the keys right. A refusal replaces the act's words and is announced as an alert (ADR 0033), never behind an undo link; a failed read still says so by name.

## Considered options

- **Controls on the tile** (Run now, Pause, Edit). Rejected, decision 1: it turns a filter into a menu and crowds a strip that must stay one line of Voice per Scout.
- **A per-Scout detail pane when no card is selected.** Rejected, decision 2: the controls act on the list, so they live with it, and a selected card keeps the whole pane.
- **Dropping Group by Question or Sort from this surface.** Rejected, decision 5: both are shipped and the mock's silence on them is not a decision to remove them.
- **Following the mock literally where it is silent** (no Cap, digest, Counterweight, Skim or Muted). Rejected: those are ADR 0044's and are choices the researcher can see and reverse.

## Consequences

- **+** New finds stay a short, ranked list however large a first look is.
- **+** Every Scout, healthy or not, is in one place with one Voice, and a filter is one click to clear.
- **−** The core must hand the renderer a Retroactive run as a unit (its Scout, pending count, run cost and titles); `Card.retroactive` is only a flag and `Group.runId` is the newest clean run, which need not be the Retroactive one.
- **−** Reject this run on a non-Retroactive run is gone as a button; the group act replaces it and counts toward Accept rate.
- **−** The Queue grows its own tests per slice because the surface is rebuilt behind unchanged behaviour: the existing `scout-queue.*.test.tsx` suites are the contract.
