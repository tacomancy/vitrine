# 0024: A sitting is a run of captures no more than ninety minutes apart, derived in the renderer

**Status:** Accepted

Spec #206 story 60 asks the Inbox to show *the other questions captured in the same sitting*, so a Question can be read back into the train of thought it was pulled out of — and says in the same breath that "what counts as one sitting is this spec's to name." The spec did not name it; it passed the call to ticket #265, which had to settle it to build the pane. Decided: **a sitting is the maximal run of Questions whose consecutive `captured` timestamps are each no more than ninety minutes apart** — wall-clock adjacency, computed in the renderer from the list the Inbox already has, with the threshold a number in code. `CONTEXT.md` § Sitting is the vocabulary; `packages/renderer/src/sitting.ts` is the whole of the logic.

Ninety minutes is a judgement, not a measurement: long enough to hold a reading session with a break in it, short enough that a morning and an afternoon do not merge into one. What makes it defensible is not that it is optimal but that it is a single number a reader can state in a sentence and check a pane against by looking at four timestamps.

## Considered options

- **Group by `from` — the questions that came out of the same source.** The obvious reading, and rejected for two reasons. `from` is already on the pane one line above the sitting, so grouping by it would say twice what is said once. And a sitting that moved from one paper to the next is *exactly* the train of thought story 60 wants recovered — grouping by source would cut the pane at the moment the thinking crossed over, which is usually the interesting moment. It also collapses badly at the edges: every Unattached capture (`context: other`, no `from`) would form one sitting spanning years, or none at all.

- **Group by calendar day.** Cheap and explicable, but a day is not a sitting: captures at 08:00 and 23:00 are not one train of thought, and 23:55 and 00:05 — ten minutes apart — would be two. It gets both directions wrong.

- **Record the sitting at capture time**, as an id written into the Question's frontmatter. Rejected on the brief's own invariant, *state is derived, not declared*: a sitting is a reading of timestamps the file already carries, and writing it down would make it a fact that can go stale and disagree with them. It also has no answer for the `Q:` convention — a question ingested from a PDF annotated in Preview belongs to a reading session the app was not running for, so there is no session for it to have been stamped with.

- **A setting for the threshold.** Rejected for the reason `STALLED_OPEN_DAYS` is a constant (`packages/core/src/loose-ends.ts`): it would make the user responsible for a judgement the app is making, and the judgement is not one they have the evidence to make better than the app.

- **A `questions.sitting` procedure in the core.** Rejected: `questions.list` already returns every Question sorted by `captured`, which is all a run needs. A procedure would be a second way to ask a question the Inbox has already asked, and would put the rule behind an RPC boundary for a pane that can compute it in a pure function with its own test.

- **Split on gaps that are large *relative to the others* — a statistical clustering rather than a fixed number.** Genuinely tempting, and rejected under § Code standard's "prefer the obvious solution over the clever one." It is not local: adding captures anywhere in the vault could change how an unrelated sitting is grouped, so the pane would answer differently on Tuesday for a reason the user cannot see. A rule you cannot state in a sentence is one nobody can check the pane against.

## Consequences

- **+** One sentence defines it, and a reader can verify any pane against four timestamps in the files. Nothing is stored, so there is no state to migrate and nothing that can disagree with the vault.
- **+** Changing the number re-groups every sitting retroactively and correctly, which is what makes it safe to revisit once there is real use to judge it against.
- **+** A sitting that crossed from one source to another survives, which is the story's whole point, and a Partial — no `captured` — belongs to no sitting and bridges none, because `Listing` keeps it out of `questions` entirely.
- **−** The number is unvalidated. Someone who reads in twenty-minute bursts gets more and smaller sittings than someone who reads for three hours, and nobody has lived with it yet. This is the same shape as the brief's own open question "How large is *small*?" for the artifact threshold: it wants a real number after real use, and until then it is a guess stated plainly rather than a guess hidden in a heuristic.
- **−** What stamps `captured` on an ingested `Q:` capture is not yet decided — the capture path writes the app's clock (`localIso(now())` in `packages/core/src/questions.ts`), and the Reader and Ingest beats have not shipped. If ingest stamps the run's own time, every question from one returned PDF becomes a single sitting whatever the reading actually looked like. Naming it here so the beat that decides it knows this pane reads that key.
- **−** The rule lives in the renderer, so a second surface that wants sittings — Home's resurfaced questions, say — imports `othersInSitting` or re-derives it. That is the right cost for now and the moment to revisit is the second caller, not before.
- **−** A sitting can in principle cross midnight, and the pane shows each other as `HH:MM` alone. In capture order this still reads correctly (`23:40` then `00:30`); two others reading identically needs roughly sixteen intervening captures spanning a full day. Accepted rather than repeating on every line the date that is already on the line above.
