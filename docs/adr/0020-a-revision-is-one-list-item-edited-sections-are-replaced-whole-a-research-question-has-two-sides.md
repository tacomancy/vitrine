# 0020: A Revision is one list item with its previous text indented inside it; sections the user edits are replaced whole; a Research Question has two sides and resolves by write-back

**Status:** Accepted

Beat 2 of the map (#131) is the first code to write a Position history, the first to edit a section of an app-owned file on the user's behalf, and the first to attach sources to a Research Question. ADR 0006 decided the history lives in the file, newest first, with the full previous text; ADR 0008 fixed the seven write operations and named `## Position history` as owned. Neither said what one Revision looks like on disk, which operation the Research Question view uses when the user edits `## Working answer` on the page, or whether the prototype's third side, *unsorted*, exists. A `grill-with-docs` pass on 2026-09-20 settled them; the detail is `docs/architecture.md` § Vault layout and § Research Question view and triage.

## Decisions

1. **One Revision is one Markdown list item.** The first line is `- <timestamp> · <field>`; `why:` and `from:` are continuation lines indented under it, and the previous text under `from:` is indented one level further so blank lines between its paragraphs stay inside the item. An empty `from:` means the field was empty before. Obsidian renders it as a list; the locator's list-item ranges find it with no new grammar; and it is the shape every later Kind's history (Hypothesis claim and Criteria, Experiment design and observations) reuses.
2. **A coalesced Revision spans its window honestly.** Saves to one field within ADR 0006's 30 minutes are one entry, stamped with the *latest* save and holding the text from before the *first*. An entry has no id; its timestamp identifies it. A why added later from the history view rewrites the owned section whole.
3. **Both edit paths record.** An edit on the page records the Revision at once; an edit in Obsidian is detected by the watcher's Position diff and spliced when the file is quiet (ADR 0013). A history that saw only in-app edits would silently omit the common case for a page that lives for months.
4. **An *Edited section* is a third category beside owned and user prose.** `## Working answer`, `## Open threads`, `## Related questions`, and — when a source is moved or detached — the two sources sections are the user's prose that the app replaces whole with `replaceSection`, only because the user edited them on a surface, never on its own initiative. Working answer is also a Position, so its replacement records a Revision; moving a source between sides is not one — the history is of positions, not of the bibliography, and a move that changed a mind is named by the why on the next Revision. No new operation; ADR 0008's set is unchanged.
5. **Two sides, not three.** Supporting and opposing are the only places a source attaches; attaching is the judgement. The prototype's *unsorted* side is rejected: the brief's reason for the split is that a one-sided literature must look conspicuous, and an unsorted pile is where that signal hides. A paper not yet judged is Related, or nothing.
6. **A Research Question has `status: open | answered | abandoned`, never `promoted`,** and resolving or abandoning it writes back like a resolved Hypothesis does: the Working answer as it stands is the answer, and the originating Question becomes *answered* (or *abandoned*) with one line pointing at the page. The Question is the record; a promoted Question whose pursuit ended must not read *promoted* forever.
7. **A stub can be made by hand from the attach form.** Until Scouts land the vault has no stubs, and a Research Question page with nothing to attach cannot be lived with; the form's *new stub* is `createFile` with four fields and the citekey rule the Scout beat needs anyway.
8. **Where the window is, is the URL hash.** `#/inbox`, `#/questions/<path>`, `#/loose-ends`. The second surface ADR 0010 was waiting for has arrived, and a hash costs nothing over a location value passed down while giving the iPad client and a later "open in Vitrine" link an address. Still no store library.

## Considered options

- **Previous text in a fenced block or blockquote.** Rejected: a fence renders the old answer as code in Obsidian; a blockquote needs `>` on every line and reads as a quotation of someone else.
- **A YAML block or HTML comment per Revision.** Rejected: invisible or uneditable in Obsidian, and the history is "the app's real subject" — it must read without the app.
- **Timestamp of the first save on a coalesced entry.** Rejected: the entry would then claim the answer changed *before* most of the typing happened.
- **Only in-app edits recorded; Obsidian edits deferred.** Rejected: the silent-shift case is exactly what the brief says the mechanism exists to catch.
- **`replaceFile` for the page's edits.** Rejected: it would rewrite sections the user did not touch and skip the per-section verification.
- **A third `## Unsorted sources` section.** Rejected as above; and adding a section later is a layout change while removing one after files carry it is a migration.
- **The RQ carries `promoted` as a status, or no status.** Rejected: *promoted* is the Question's word; a page needs *open* vs *answered* to show its own state and to feed Loose Ends.
- **A location value passed down, no URL.** Rejected only on cost: same code, no address.
- **A source move as its own Revision kind.** Rejected: it would give the history a second grammar for something that is not a position held at a time.
- **Only listing sources that exist, no hand-made stub.** Rejected: a fresh vault would make the page dead weight for four beats.

## Consequences

- **+** Every Position history in the vault has one grammar from the first file written; the Hypothesis and Experiment beats inherit it and its tests.
- **+** The Research Question page is usable for months without the Vault editor: its prose sections are editable in place and in Obsidian alike.
- **+** A resolved Research Question closes the loop the brief draws for Hypotheses; the Inbox stops showing *promoted* for a question that has been answered.
- **−** Edited sections mean the app replaces prose whole; a concurrent Obsidian edit to the same section between read and save is caught by the write protocol's hash check and re-apply, but a re-apply that lands on a changed section refuses, and the page must show that refusal as a line, not lose the typing.
- **−** Decision 5 means a reading list has no home on the page. If living with it shows that papers pile up in `related:` waiting to be read, the third side can be added then.
