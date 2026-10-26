# 0053: The Scout Queue shows papers, one Scouts screen owns the Scouts, and an erased Scout leaves a tombstone

**Status:** Accepted

Beat 14 (ADR 0052) put a Scout header, with Edit, Pause/Resume, Run now and cost, and a tile per Scout with its Accept rate on the Queue, while drop, restore and the dropped line stayed on Scout Activity (ADR 0042), behind a link on Home. The two screens then read as one, and the one that looked like the place to manage a Scout could not drop it (#850, grilled 2026-10-26). Every decision below is hard to reverse once a Scout has been erased or an address linked, and each has a plausible alternative a later reader would propose. It amends ADR 0052 decisions 1, 2 and 5 and ADR 0042 decision 1; the rest of both stands.

## Decisions

1. **The Queue is the papers; the Scouts screen is the Scouts.** Edit, Pause/Resume and cost leave the Queue's Scout header. What stays are the facts about the papers (*N already in your vault*, *N below your cap of M · Show them*, the deferred-while-dropped line, Retroactive batches, Skim and Muted) and *Run now* while one Scout is filtered, since it is a run and not a change to the Scout and is wanted mid-triage. Create, Edit, Pause, Drop, Restore and Erase are on the Scouts screen only.
2. **The rail returns, always as Scouts, and only filters.** It replaces the tile strip (ADR 0052 decision 1) and keeps the tile's Voice line. It does not change under *Group by Question*: Questions become headings in the list (amending decision 5), so a marker stays visible in every mode. A dropped Scout with cards waiting keeps a row, marked *dropped*, as the tile had.
3. **A marker beside a Scout's name says it needs you, and a Scout without one is fine.** It is drawn from the Voice, not beside it: *wrong* and *blocked on credentials* carry one; paused, dropped, quiet and *not yet* otherwise carry none, and a low Accept rate never does (ADR 0042 decision 8: no threshold the app can defend). *Wrong* keeps its warning glyph (ADR 0032). A missing key is not a fault (`CONTEXT.md`, *Blocked on credentials*), so its marker is a different shape; the shape is a spec decision. Shape and words, never colour alone, never red. A Scout that has not run, or whose health could not be read, says so in words; blank never means *not checked*.
4. **Two ways across, both plain.** A link at the foot of the rail, always; and a line above the list when any Scout is marked, naming it and linking to its row. The line goes when the cause does, never by a button.
5. **The Scouts screen is the screen that was Scout Activity, renamed for what it now does.** Its address is `#/scout-management`, because `#/scouts` is the Queue's; `#/scout-activity` keeps resolving to it (ADR 0021: every surface has an Address, and a hash someone saved should not stop working). A Scout's form leaves the Queue and takes its own addresses under it, `#/scout-management/new` and `#/scout-management/<id>/edit`, so *try* and a draft survive a reload and the back button works.
6. **A dropped Scout can be erased, and erasing leaves a tombstone.** Offered only on an already-dropped Scout, behind a confirmation, and refused while any of its Proposals is pending or deferred; the researcher triages those first, since erasing must not reject them for them (ADR 0042 decision 1). The Scout's file is removed and a tombstone, its name and id, stays, so the run rows, `triage` rows, `origin_scout` on stubs and *Clocked but unquestioned* keep resolving and Accept rate keeps reading true. A tombstone is never a row: it is not on the dropped line and cannot be restored; it appears only where a record names it, marked *erased*. Erase cannot be undone, which is why drop is first and stays undoable. This is an exception to *drop retires; it never erases*, not a reversal of it: the history is kept.
7. **No new design handoff.** Prototype 10 and the existing form carry the layout; the spec goes back to design only if it finds a screen the prototype does not show.

## Considered options

- **Keep retire-only and make drop findable.** Rejected, decision 6: the researcher who said "delete" had a Scout they would never want again, and a dropped line that only grows is a list nobody can clear.
- **Erase everything the Scout owns.** Rejected, decision 6: it orphans `origin_scout` on accepted stubs and rewrites Accept rate and *Clocked but unquestioned*; the very thing ADR 0042 refused.
- **Erase while Proposals are pending, leaving them in Review under the tombstone.** Rejected, decision 6: a second kind of orphan in the Queue, for a case the researcher can clear in one pass.
- **Colour the Scouts red, amber and green.** Rejected, decision 3: the brief has no red states, and amber needs a threshold ADR 0042 refused.
- **Mark every Scout, with a marker for a healthy one.** Rejected, decision 3: attention is drawn only to those that need it; a Scout that is quietly fine is said in words, as the Voice already does.
- **A rail that swaps to Questions under Group by Question.** Rejected, decision 2: a broken Scout would be invisible whenever the list is grouped.
- **A paper expanding in place instead of a detail pane.** Not decided here; it is its own question (#851).
- **Take `#/scouts` for the Scouts screen and move the Queue.** Rejected, decision 5: every link to the Queue changes, from Home, Loose Ends and the sidebar, to rename a label.

## Consequences

- **+** One place to change a Scout, one place to read what it found, and a link between them that says so.
- **+** A researcher can finally remove a Scout for good without breaking the record of what it did.
- **−** Erasing loses the Scout's brief (its Query, Tags and Assigned Questions); only its name and id remain. The confirmation says so.
- **−** `docs/architecture.md` § Scout Activity and its bullets on drop carry the old name and the Queue's header until the spec's tickets land; they are updated by the ticket that moves each thing, not here.
- **−** The marker's shape for a Scout waiting on a key is open until the spec.
- The spec carries: the rail and its filter, the marker rule and its tests (a quiet, paused or dropped Scout shows none; *wrong* and *blocked on credentials* do), the line above the list, the Scouts screen's rename with `#/scout-activity` still resolving, the form at its own addresses, the drop-then-erase path with its refusal and tombstone, and `architecture.md`'s update.
