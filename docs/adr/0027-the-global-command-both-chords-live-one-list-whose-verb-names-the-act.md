# 0027: The Global command — both chords live, one list whose verb names the act

**Status:** Accepted

ADR 0021 decided only *that* ⌘K is how anything is reached, and left five things to beat 2b (#262): what it reaches beyond objects with an Address, how it matches, what it looks like, whether capture moves into it, and which of ⌘' and ⌘K survives. A prototype of three structurally different answers (branch `prototype/global-command`, never merged) and a four-round grill settled them.

## Decisions

1. **Both chords live, and they are two terms.** ⌘' is the **Capture line** — a strip at the foot of the window that captures and nothing else. ⌘K is the **Global command** — one list that goes somewhere or captures. They share one capture procedure and one Provenance resolution: **the chord never changes the Provenance**, which is where the user was standing, so ⌘K on a Research Question page captures `pursuing` and links the new Question into that page's `## Related questions` exactly as ⌘' does. The `context` union gains no member. Neither chord is live when no vault is open (ADR 0025 decision 5, which the Capture line already follows).

2. **One list, and the verb names the act.** Destinations rank above a capture row that is always last. The default side follows match strength — an exact or prefix hit selects the destination, anything else selects the capture — and `⇥` swaps. `↵` therefore means different things at different moments, so **the verb is the safety**: its own surface step, the key drawn as a key, the mode in brass, and the thing ↵ will act on named in full rather than implied. Brass appears once, in the verb, at the point the decision is made (`BRAND.md` law 3). When the capture is the only row there is, the row drops the text the verb is already carrying and keeps only its Kind glyph and its Provenance.

3. **Its own procedure and its own component.** ADR 0021 left "whether one list serves both" to the second use; this is the second use and the answer is **no**. The Picker is Kind-narrowed, goes nowhere, and hands a value back to one slot; the Global command is window-wide, goes somewhere, and can write — and it lists surfaces and dashboards, which are not files at all. The Picker is untouched.

4. **Reach is the Address rule and nothing more.** What has an Address is reachable; what does not, is not. A Tag, a Sitting, a Loose end row gain nothing here, and a Kind joins the moment a beat gives it a page. One rule instead of an audit per Kind.

5. **Matching is on the Display name**, not the stored file name: matching what a row visibly says is the only non-surprising behaviour, and a file name strips the characters Obsidian forbids and truncates at 80, so the two diverge mid-string and not only at the tail. Affordably: the indexer writes a lowercased Display name column on `files`, beside `lstem`, so the match is an indexed column rather than a scan of `fields` per keystroke — an index on `fields (value)` would buy nothing, since SQLite cannot use one for a contains-`LIKE`. Still not a search: no bodies, and no FTS table exists. `CONTEXT.md` § Picker's *never a search* is the Picker's own boundary, not the app's.

6. **Ordering is match strength, then Kind, then recency** — exact, prefix, word start, contains — so an exact hit outranks a surface and a surface outranks an object that merely contains the word. Before a character is typed the list is the surfaces and dashboards, then recent objects by `files.mtime`: one ordering for every Kind, and not `captured`, which answers *when I wondered it* and is the Inbox's sort. A cut list says how long it is, as the Picker's does. The Address the window is already on is listed, marked as current, and never the default selection.

7. **A jump is one `pushRoute`, and the hash does not track the cursor.** An Address naming an object is where to arrive, not a live cursor: going to a Question opens the Inbox with that row selected, and moving the selection afterwards does not rewrite the Address. Focus after a jump or a capture is ADR 0010's — the surface the thing landed in decides. A pasted Address that does not resolve, including one using the prefix ADR 0026 retired, lands on the Inbox saying which Address did not resolve.

8. **A capture that duplicates an existing object is written anyway**, with no check and no warning. Decision 2 already points the user at the existing one — an exact hit puts the selection on the destination and the verb reads *go to* — so a second signal would duplicate the one the verb exists to give. Two Questions asking the same thing months apart is information, not a defect.

9. **This beat adds no Loose Ends row and no Home item.** There is no such thing as a half-made jump, and a capture from ⌘K is the same write as one from ⌘', already covered.

10. **The Sidebar names both chords** in a quiet footer line. It is layout and so the Sidebar's own call (ADR 0021 decision 3), recorded here only because `App.test.tsx` asserts the opposite and that assertion encodes the older call.

## Considered options

- **⌘K only, with ⌘' retired or reduced to an alias.** The tidier answer — one chord, one component, nothing to drift — and rejected on the brief: capture "is never interrupted by a form", and a strip at the foot of the window is not an interruption in the way an overlay over a scrim is. That gap will matter most in the Reader beat, where capture happens mid-page. The cost accepted is that capture-inside-⌘K is the *second* path, which is a real divergence from #262's prompt ("the capture half is the reason it exists"); its job is the state where a search found nothing and the thing being looked for is the thing worth writing down.
- **Capture pinned above the list, always selected** (prototype variant A). Rejected: every jump pays one arrow, forever.
- **Two columns, destinations and capture side by side** (prototype variant C). Rejected: nothing is inferred because both outcomes are on screen, but it is wide and busy and pushes against calm and keyboard-first.
- **Extend `picker.candidates` with flags** for surfaces and recency. Rejected under § Code standard: inspecting the second use case showed two different things that happen to both be keyboard lists, not one thing needing a parameter.
- **Match the stored file name**, as the Picker does. Rejected: a word legible on the row would fail to find it, which is the § Invariants smell even though nothing breaks.
- **Let the hash track the Inbox selection.** Rejected: it fills the back stack with rows until *back* stops meaning "where I came from".

## Consequences

- **+** Reachability stays one sentence, and the Sidebar, the Picker and the Capture line each keep exactly their existing job.
- **+** The verb makes the one genuinely risky thing about this design — an `↵` that changes meaning — legible at the moment it matters, rather than argued about in a spec.
- **−** Two ways to capture exist, so two UIs can drift. What stops them is that they share the procedure and the Provenance resolution; only the presentation differs, and that is the thing the two chords are *for*.
- **−** `files` gains a denormalised column that the indexer must keep true. ADR 0014 drops and rebuilds the index on schema mismatch, so the cost is a rebuild rather than a migration.
- **−** Beat 2b now carries a rename (ADR 0026) alongside its feature, which makes it a larger slice than the beat sequence assumed. Doing the rename anywhere later is strictly more expensive.
