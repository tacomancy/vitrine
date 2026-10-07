# Vitrine

A local-first research workspace whose primary object is the Question rather than the note. This is the vocabulary code, tests, issues, UI copy, and commit messages use. It starts from `docs/reference/design-brief.md` § Primary objects and is expected to diverge as implementation reveals distinctions the brief didn't need; any divergence traces to an ADR in `docs/adr/`.

## Language

### The vault

**Vault**:
The folder of plain Markdown files, PDFs, and small artifacts that holds everything the user authored or accepted. Readable and editable by any other tool; the app is not the only way in.
_Avoid_: Library (v1's word), database, workspace (that is the app)

**App state**:
Everything the app knows that is not vault content: the annotation identity index, Scouts and their runs, the Proposal queue, the Lexicon, dismissals. Travels with the vault but is not part of it; never synced, never a wikilink target.
_Avoid_: Database, cache (some of it cannot be rebuilt), config

**Index**:
The app's disposable record of what the vault's Markdown contains — files, links, block ids, tags, Positions — kept current by the watcher and rebuilt from the files whenever it is missing or out of date. Every list a surface shows comes from it; no write is ever based on it.
_Avoid_: Cache (it is one, but the word invites reading it as optional), database, search index (search is one thing it holds)

**Current** (of the Index):
The state in which the Index may be trusted to say a link does not exist: the open-time sweep has finished, the watcher is healthy, and every settled Markdown change has been applied. When not current, an unlinked Annotation is Unmatched rather than Removed.
_Avoid_: Fresh, up to date, synced

**Kind**:
Which sort of thing a vault file is — Note, Source, Source stub, Question, Research Question, Hypothesis, or Experiment. Declared in the file itself, never inferred from the folder it sits in.
_Avoid_: Type (taken by the type system), category

**Note**:
An ordinary Markdown file with links, tags, and backlinks. Obsidian behaviour is the tiebreaker for anything unspecified.

**Tag**:
A slash-separated topic label parsed into a tree (`ml/interpretability/probing`), the same tag whatever its casing. A parent's coverage is the union of its children's.
_Avoid_: Topic (a tag *is* the topic axis; "topic cluster" is a Scout Queue grouping, not a tag)

**Outline**:
The app's reading of one Markdown file: its frontmatter, headings and their sections, block ids, links and tags as written, inline fields, and list items, each with the range of source text it covers. Produced by `packages/markdown` from the file's text alone; carries no resolution and nothing Kind-specific. What the Index stores per file, and what `vault.outline` shows.
_Avoid_: AST, parse tree (it is ranges, not a tree to print back), metadata cache (Obsidian's word for its own)

**Owned section**:
A `##` section of a vault file that the app rewrites whole — `## Annotations`, `## Position history` — as opposed to the user's prose, which it never touches.
_Avoid_: Managed section, generated section

**Lead**:
The body of a vault file before its first `##` heading — the whole body of a Question, the text above `## Working answer` on a Research Question. Where the write-back line from a resolved Hypothesis lands, so that it can never fall inside `## Position history` (ADR 0008 decision 2). One of `appendToSection`'s three targets, beside a `##` section and a `###` block.
_Avoid_: Preamble, intro, body (the lead is part of it)

**Edited section**:
A `##` section of an app-owned file whose body is the user's prose, which the app replaces whole only because the user edited it on a surface — on a Research Question, `## Working answer`, `## Open threads`, `## Related questions`, and the two sources sections when a source is moved or detached. Never rewritten on the app's own initiative; in Obsidian it is ordinary text. A Working answer is also a Position, so replacing it records a Revision; moving a source is not a Revision (ADR 0020). A save of one carries the section's text as the surface read it beside the Write's `basedOn`: replacing a section whole is the one write a stale re-apply could land wrongly, so a section changed underneath is refused for the surface to show as Changed on disk, never overwritten.
_Avoid_: Owned section (the app rewrites those unprompted), field, form

**Shape problem**:
An app-owned file missing structure its Kind expects. Four cases the Index records: a Hypothesis without `## Criteria`; a `###` under `## Criteria` without `^c<n>`; an Owned section present twice; a criterion's `outcome::` or `relationship::` holding a value outside its vocabulary. Two more a page reports for itself and the Index never stores: a section the page draws whose heading is not in the file (retyped), and an Edited section present twice. Reported as `{ path, kind, problem, block? }` beside the rest of the Outline, never in place of it; a missing Owned section is not one (ADR 0008 decision 10) — the app appends it — but a page still says it could not show it.
_Avoid_: Corrupt, malformed, invalid file, unreadable (that is a file whose frontmatter does not parse)

**Write**:
One hash-checked application of operations to a vault file — `{ operations[], basedOn }`, where `basedOn` is the hash of the Outline the operations were computed from. Re-applied to the current content if the file changed underneath, verified by re-parsing, written atomically; refused with a reason when it cannot be re-applied or fails verification, and then nothing touches the disk. The result carries the content as written and its hash, for the Index to record an own write. `replaceFile` (the Vault editor's save) and `createFile` are the two whole-file exceptions: the first is refused only when the file is Changed on disk, the second only when the file exists.
_Avoid_: Patch, diff (a string patch cannot find its target again; an operation can), save (that is the editor's word for its `replaceFile`)

**Changed on disk**:
The state of a file open in the Vault editor with unsaved typing whose bytes on disk no longer match what the editor was given — an Obsidian edit, a sync, the app's own splice. Shown as a line, never a dialog; resolved as *keep mine* or *take the disk copy*, and until then nothing is written. A clean editor simply reloads.
_Avoid_: Conflict, merge, stale (a Scout health word)

**Ambiguous link**:
A bare wikilink whose name matches more than one file, none of which sits beside the linking file. Resolves to nothing and surfaces as a Loose end rather than picking one.
_Avoid_: Broken link (that is an unresolved one), conflict

**Unresolved link**:
A link that lands on nothing: no file has the name or path, or the file is there and lacks the `#Heading` or `#^id` the link names. The third resolution state beside *resolved* and *ambiguous*; computed by the Index across the vault, never by one file's Outline.
_Avoid_: Broken link, dead link, dangling link

**Implicit tag**:
A tag present in the tree only because a descendant is — `ml` when the vault carries `ml/probing` and nothing tagged `ml` itself. Has the union of its children's files and an exclusive count of zero; shown like any other node so the hierarchy is real wherever the user tagged.
_Avoid_: Virtual tag, synthetic parent, folder

### Sources and reading

**Source**:
A PDF in the vault with highlights and annotations stored in the file itself.
_Avoid_: Paper, document, attachment

**Source stub**:
A bibliographic record with no PDF attached yet — title, authors, venue, date, link. Created by accepting a Proposal, or by hand from a Research Question's attach form; becomes a Source when a PDF is attached. The same record throughout: attaching changes nothing anyone links to.
_Avoid_: Reference, citation, placeholder

**Citekey**:
The short handle a Source or Source stub is linked by — first author's surname and year, `klinzing2019`, with a letter suffix on collision.
_Avoid_: Key, slug, bibkey

**Annotation**:
A highlight or margin note stored in a PDF as a standard annotation object, individually addressable so a Note or Question can link to it.
_Avoid_: Highlight (one kind of annotation, not the general term), comment

**Annotation identity**:
The app's stable ID for an Annotation, kept in a sidecar index with its page, geometry, and quoted text. PDF objects have no reliable ID across editors, so identity is re-matched on every Ingest: quoted text first, geometry second.

**Annotation block**:
One Annotation's list item in a Source's `## Annotations` section — the page, the quoted text, and a `^h<n>` that carries the Annotation identity into the vault so `[[citekey#^h12]]` resolves in Obsidian. The note, when there is one, is a second paragraph inside the item: a note on the line directly below would continue the item's paragraph and leave the `^h<n>` naming nothing (#164, ADR 0006).
_Avoid_: Annotation line (it is rarely one line), highlight block

**Ingest**:
The app noticing a changed PDF on disk and reading its Annotations back in. Triggered by the file, never by the user. Yields new Annotations, new Questions (from the `Q:` convention), Removed Annotations, and Unmatched Annotations. Every PDF that changed within one run window is one Ingest run.
_Avoid_: Import, sync (sync moves files; ingest reads them)

**Ingest run**:
The PDFs ingested together: those of every Batch that closed inside one run window, or those of one ask that does not wait, such as attaching a Source's PDF or the read after a sweep. One summary line, at most one panel, one record in App state. Fifty PDFs returning from the iPad are one run, not fifty notifications; runs that still land close together are a Burst.
_Avoid_: Ingest event, batch (in UI copy)

**Burst** (of Ingest runs):
Runs that land within a few seconds of each other. They share one summary line, their counts added; a run that lands after the burst starts a line of its own.
_Avoid_: Batch (that is the watcher's), group

**Settled** (of a file):
Quiet for long enough — no watcher events, two stats agreeing — that a sync client or Preview is judged to have finished writing it. Nothing is read or hashed before it settles.
_Avoid_: Stable, debounced

**Batch** (of the watcher):
The files that settled together, applied to the Index as one transaction and announced as one change; it closes the moment its files settle, Markdown or PDF alike. A PDF's Ingest waits a run window for stragglers beyond that, so one Ingest run can span several Batches.
_Avoid_: Debounce group, changeset

**Run window**:
How long the PDFs of a Batch are held for stragglers before they are ingested — not a Scout run's window, which is the dates that run covers. It starts again with each change that names a PDF, but no PDF is held past a ceiling, so a delivery that never goes quiet is still read in turn.
_Avoid_: Debounce, grace period

**Own write**:
A change to a vault file the app made itself, recognised by the watcher because the file's hash is the one the app recorded when it wrote. Indexed at the moment of writing, so the watcher has nothing to do when it sees it.
_Avoid_: Echo, self-event, expected write

**Rename** (as the watcher sees it):
A file that vanished at one path and appeared at another with the same content in one Batch. Paired for every file; a surface holding the old path follows it to the new one.
_Avoid_: Move (Finder's word; the same thing), delete-plus-create

**Not watching**:
The state in which the watcher has failed and could not be reopened, so changes made outside the app are not reaching the Index. Shown in the footer channel with the reason and a *retry*; never allowed to look like a quiet vault.
_Avoid_: Offline, disconnected, stale

**Sweep**:
A stat-only pass over files comparing size and modification time to what the app recorded, catching up what the watcher could not see — at vault open, after a watcher failure, and over the PDF folder when the window regains focus. Reads no content. Never a timer.
_Avoid_: Poll, rescan, full scan

**Evicted** (of a PDF):
Present in the folder but with its bytes not on disk — iCloud or Dropbox keeping it online-only. Unreadable-not-changed: never hashed, never ingested, until the Reader opens it and the read brings it down.
_Avoid_: Missing (that is a file that is gone), placeholder, offline

**Conflict copy**:
A second PDF the sync service created because the Mac and the iPad both wrote the same file — recognised by a document fingerprint matching an existing Source. Never a Source of its own; a Loose end resolved as *use this copy* or *discard*.
_Avoid_: Duplicate, new Source

**Unreadable PDF**:
A PDF the engine could not read — encrypted, damaged, or one it stopped on. Its Source is never ingested quietly: it is a Loose end naming the reason, resolved as *try again* (once, by the user — a file the engine trapped on is never retried automatically) or marked deliberate. Not an Unreadable Question file (ADR 0009), and not an Evicted PDF, which is unreadable-not-changed.
_Avoid_: Corrupt PDF, failed Ingest

**Document-changed group**:
The Unmatched annotations one replaced PDF left behind, held together under a single row headed by the event (*the document changed*) rather than as separate decisions. Resolved as a batch — *drop the links* or *treat as new* for all of them — or one row at a time, where *relink* also lives, since relinking needs a target per annotation.

**Connection**:
Something that points at a Source or one of its highlights: a page that links to it or to a block of it, or a Question whose provenance names it, whether or not any note links that Question. The Reader lists them in its Connections panel and marks each highlight that has one with a tick in the gutter. A Connection opens where it has an Address and is only named where it has none.
_Avoid_: Backlink (a Connection is wider: it includes a Question that no link mentions)

**Unmatched annotation**:
An Annotation that previously had links pointing at it and could not be re-identified on Ingest. Never dropped; surfaces in Loose Ends until resolved as *relink*, *drop the links*, or *treat as new*.

**Removed annotation**:
An Annotation that nothing linked to and that could not be found on Ingest. Counted, never a decision; a vanished Annotation that something pointed at is Unmatched instead.
_Avoid_: Deleted (the app did not delete it), lost

**Tombstone**:
What an Annotation becomes when the user resolves it as *gone*: its identity and quoted text stay so every link to it still resolves, marked as gone. The user's notes are theirs to edit; the app never rewrites a link on their behalf. *Treat as new* ends in the same state: the old identity is tombstoned and the annotation it might have been keeps or gets a fresh identity of its own, so an Unmatched annotation has one terminal state besides *relink*.
_Avoid_: Deleted annotation, dangling link

**`Q:` convention**:
An Annotation whose note begins with `Q:` becomes a Question on Ingest, with page and quoted passage as provenance. The Reader writes the same convention when it makes a Question from a selection, and records the Question in the same act so Ingest never makes a second (ADR 0038).

### Questions

**Question**:
A lightweight capture that always carries Provenance. Has a Status. The app's primary object.
_Avoid_: Idea, task, todo, item

**Provenance**:
What the user was reading or doing when a Question was captured, the page or timestamp, and the date. Recorded automatically at capture, never reconstructed later. Its context is one of *reading* (the Source and the page in view, and — when made from a selection — the highlight that carries `Q:`; with no selection, no annotation and nothing written into the PDF), *writing*, *ingest*, *resolving* (the follow-up captured as a Hypothesis's loop is closed), *pursuing* (captured on a Research Question's or a Hypothesis's page — the new Question is a sub-question of it), *observing* (captured from an Experiment's observations — `from` is the Experiment, and nothing is written onto its page; the page shows it by backlink), or *other*.
_Avoid_: Source (that word is taken), origin (used for Proposals)

**Unattached**:
The Provenance of a Question captured with no document open: `context: other` and no `from`. Time and place are still a Provenance, so the capture is never blocked on a choice; what it belongs to can be linked later.
_Avoid_: No provenance (it has one), orphan (a Loose Ends word), untagged

**Sitting**:
The run of captures a Question was made in: the longest run containing it whose consecutive `captured` timestamps are all within ninety minutes of each other. Wall-clock adjacency, never *same `from`* — a sitting that moved from one paper to the next is exactly the train of thought worth recovering, and `from` is already a line above on the pane. The Detail pane names the others in it and never totals them; a Question alone in its sitting adds nothing to the pane at all. A Partial has no `captured` and so belongs to no sitting, its own or anyone else's (ADR 0024).
_Avoid_: Session (an app's own run), batch, cluster, group

**Status** (of a Question):
One of *open*, *promoted*, *answered*, *abandoned*. Age is a neutral, sortable fact and never a state. Every status is shown as a glyph and a label (`◆` open, `■` promoted, `●` answered, `×` dropped — the label follows the triage verb); only open carries colour, and that colour is the accent. A file with no `status:` is open: it was never triaged (ADR 0009).
_Avoid_: Overdue, stale (in code — "stale" is only a Scout health term)

**Partial**:
A file whose frontmatter says `kind: question` but lacks `question` or `captured`, so it cannot be shown as a row. Listed anyway, by file name and modification time, marked as such — visible rather than dropped. Not a Status, and not counted as a Question (ADR 0009).
_Avoid_: Invalid, broken (that is Unreadable), malformed

**Unreadable**:
A file the app could not read, whose frontmatter does not parse, or whose `captured` or `status` holds a value the vocabulary cannot read. Counted in a quiet footer line on the Inbox that opens to each path and reason; never dropped silently (ADR 0009).
_Avoid_: Error, corrupt, skipped

**Capture**:
Making a Question in two keystrokes from anywhere, with Provenance attached without typing.

**Landing** (of a Question):
The moment a capture becomes a row: the Inbox re-reads the vault, the new Question is the selection, and the keyboard is on the list so `j`/`k` act on it. Happens when the Inbox is on screen; from another surface the capture is written and focus returns to where it was (ADR 0010).
_Avoid_: Refresh, sync, notification

**Triage** (of a Question):
Acting on a Question from the Inbox: promote to Research Question, promote to Hypothesis, link, answer, or drop.

**Promotion**:
Turning a Question into a Research Question or a Hypothesis. The Question stays as its own record with Status *promoted*, and the new object carries a copy of the Provenance. A Research Question may sharpen into a Hypothesis; that is the expected route, and the Research Question stays *open* — reading may go on beside the test — gaining only a line under its related questions. Promotion to a Hypothesis asks for one thing, the claim: a question cannot be turned into a falsifiable statement by copying its words.

**Write-back**:
A Resolved Research Question answering the Question it came from, or a Hypothesis whose loop is closed writing its result to the object it was promoted from — one hop, never further. A Question written to becomes *answered* with one line pointing at the result. A Research Question written to gains the line and keeps its Status: a test of a sharpened claim has not answered the broader question, and resolving it stays the user's, which then writes back to its own Question. Falsified is a real answer. An abandoned Research Question writes back the same way, and the Question becomes *abandoned*: the Inbox is the record, and *promoted* would be a lie about a pursuit that ended.
_Avoid_: Close, resolve (that is what happens to the Hypothesis)

**Related** (of a Question):
Another Question, Note, or Source the user explicitly linked from the Inbox's Link action — or, on a Research Question, listed in `## Related questions`, which is the same edge kept on the page. Only these count as edges for Coverage; a mention in prose does not. Linking writes only the linking side; the other side's backlink is the Index's.
_Avoid_: Mentioned, connected, see also

**Open thread** (of a Research Question):
One thing the user still does not know about it, kept as a task-list line so a resolved thread is ticked, not deleted. Never a Question: a thread that deserves Provenance is captured as one, from the page.
_Avoid_: Todo, sub-question (that is a Question with `pursuing` Provenance)

**Reopen** (a Question):
Setting a dropped or answered Question back to *open*, keeping whatever answer text it holds.

**Reopen** (a Research Question):
Setting a Resolved or Abandoned page back to *open*, and nothing else: the body, the Position history, and the Write-back line on its Question all stay where they are, so resolving is a status and not an archive. The Question's own status is the Inbox's to reopen. `answered` stays too, as the day the page was last resolved; the next Resolve overwrites it.

**Research Question**:
A promoted Question answered by reading. Holds a Working answer with Position history, supporting Sources, opposing Sources, related questions, and open threads. Supporting and opposing are structurally separate, not a tag on one list.
_Avoid_: RQ in prose; project

**Working answer**:
What the user currently believes about a Research Question. Explicitly provisional; a Position. When the Research Question is Resolved, the Working answer as it stands is the answer — there is no separate answer field.

**Status** (of a Research Question):
One of *open*, *answered*, *abandoned*. Never *promoted*: that is the originating Question's word for having spawned it.

**Resolved** (of a Research Question):
Its Status set to *answered* by the user, taking the Working answer as the answer. Writes back to the Question it was promoted from. Not a Loose end and not derived: the user decides when reading is done.
_Avoid_: Closed, done, finished

**Abandoned** (of a Research Question):
Its Status set to *abandoned* by the user: reading ended without an answer. Writes back exactly as Resolved does, and the Question becomes *abandoned* too. Carries no date of its own — the day is in the Write-back line, as a dropped Question's is.
_Avoid_: Cancelled, failed, archived

**Supporting / Opposing** (of a source on a Research Question):
The two sides a source is attached to, and the only two: attaching is the judgement. A paper not yet judged is not evidence and is not attached; it may be Related.
_Avoid_: Unsorted (the prototype's third side, rejected — ADR 0020), for/against in code

### Position history

**Position**:
A claim held at a time — a Working answer, a Hypothesis claim or its design notes, an Experiment's design or its observations, or a Criterion. An Experiment's purpose is not one. Editing one adds a Revision rather than overwriting. A Criterion's Position is its whole block — text, Relationship, Outcome, and Evidence — so recording an Outcome or detaching Evidence leaves a trail as rewording does.

**Revision**:
One entry in a Position history: when it changed and what it changed from, in full. Recorded automatically; edits to the same Position within a short window are one Revision. May carry a *why*.

**Pending Revision**:
A Revision the watcher raised for a Position edited outside the app, held in App state with the previous text until the file has been quiet long enough to splice it in — so the app never writes under the user's cursor in Obsidian, and never loses what the text changed from.
_Avoid_: Draft revision, external edit (that is the cause, not the record)

**Why**:
An optional short note on a Revision saying what prompted the change, optionally linked to the Source, Annotation, or Experiment responsible. Revisions with a why lead the history view; the rest collapse into a trail of dates.
_Avoid_: Reason, rationale, comment

### Testing

**Hypothesis**:
A promoted Question answered by testing: a falsifiable claim with Criteria. Its state is derived from the Criteria, never set.
_Avoid_: Status dropdown, any verb like "mark supported"

**Criterion**:
One independently resolvable condition on a Hypothesis, recorded before evidence arrives. Has an Outcome and a Relationship. Its identity is a number that is never reused, not while the Criterion exists and not after it is deleted; its label is the Relationship's letter and that number — `F1`, `C2`, `D5` — so changing the Relationship changes the letter and never the number. A Position history entry records the label as it stood.
_Avoid_: Test (that is the whole Hypothesis), condition, check

**Edited after evidence** (of a Criterion):
A change to a Criterion's text or Relationship made while Evidence is attached to it. Permitted, and marked permanently: on the Criterion itself with its previous wording readable, and in the Position history as an entry that never collapses. Recording an Outcome is never this — it is what Evidence is for. An edit made in Obsidian is marked exactly as one made on the page; there, Evidence present at either end of the quiet window counts, since the window cannot say which came first (ADR 0034).
_Avoid_: Tampered, amended, post-hoc (that is the risk it guards against, not the mark)

**Deleted after evidence** (of a Criterion):
A Criterion with Evidence under it, gone from the file. The page never does this — a tested Criterion leaves the rule by becoming diagnostic — so only an edit made outside the app can; the watcher records it as the loudest entry in the Position history, naming the Criterion and holding its whole block. A Criterion deleted before any Evidence is a draft withdrawn, recorded quietly.
_Avoid_: Removed, withdrawn

**Outcome** (of a Criterion):
*met*, *not met*, or *inconclusive*, recorded by the user. A Criterion with no Outcome recorded is *Awaiting evidence*, never *inconclusive*.

**Awaiting evidence** (of a Criterion):
No Outcome recorded yet — the state every Criterion is written in. Not an Outcome: *not yet tested* must never read as *tested and inconclusive*, so the difference is whether anyone recorded one. Whether any Evidence is attached is a separate fact; a Criterion with an Outcome and nothing attached says so rather than showing the Outcome alone.
_Avoid_: Pending, untested (as an Outcome value), unresolved (that includes *inconclusive*)

**Relationship** (of a Criterion to its claim):
*confirming* (met supports), *falsifying* (met kills the claim regardless of the others), or *diagnostic* (informative, does not decide). Chosen when the Criterion is written, with no default. A Criterion with no Relationship does not count yet: it blocks *supported* and cannot falsify. Making a Criterion diagnostic is how it leaves the rule once Evidence exists — it stays on the page, marked Edited after evidence — rather than being deleted.

**Derived state** (of a Hypothesis):
*falsified* when any falsifying Criterion is met; *supported* when none is, every confirming Criterion is met, every falsifying Criterion is not met, and there is at least one of either; otherwise *inconclusive*. Diagnostic Criteria never decide. A Criterion Awaiting evidence blocks *supported* without deciding anything, and a Hypothesis with no Criteria, or only diagnostic ones, is inconclusive. Inconclusive is the default and a real outcome. Never stored, always recomputed; each time it moves, the move is an entry in the Position history — a record of when the rule began returning a different answer, not a stored state.

**Close the loop** (of a Hypothesis):
The user's act of writing a result back, and the moment the follow-up capture is offered. Open when the Derived state is *supported* (an Override included, and the line says so) or *falsified*, and when it is *inconclusive* with every Criterion carrying an Outcome — tested and undecided is an answer; not yet tested is not. Never automatic: the Derived state is live and may move again, and a write into another object is the user's to make. Nothing is stored on the Hypothesis — whether the loop is closed is read from the Write-back line in the object it was promoted from, whichever Kind that is. If the Derived state later moves, the page says the line no longer matches, and closing again appends a new line; a Write-back line is never edited. A Hypothesis written directly, promoted from nothing, has no loop to close; the follow-up capture is still offered.
_Avoid_: Resolve (a Research Question's verb), conclude, mark done

**Override**:
A considered call that an inconclusive Hypothesis is supported on partial evidence — never falsified, and never with no Outcome recorded at all, since there is then nothing to be partial about. Exists only as a Revision with a mandatory why. Voided by any later Revision of a Criterion, by a Criterion added or deleted, or by a Revision of the claim it judged; never by design notes. The voiding is itself a Revision, and a fresh Override is a fresh why.
_Avoid_: Manual status, force supported

**Experiment**:
A run designed and recorded here but executed elsewhere. Exists independently of any Hypothesis. Holds purpose, design, where it ran, Artifacts, observations, and a hand-maintained status (*planned*, *running*, *complete*, *abandoned*); changing the status is not a Revision. Named by a short name the user types when making it, which is also its folder's name and is never changed by the app. Made on its own surface or from a Criterion that needs Evidence not yet run — never promoted from a Question: it may say what prompted it (*came from*), and that leaves the Question's Status alone.
_Avoid_: Run (that is what happened elsewhere), test

**Where it ran**:
An Experiment's links out — repo, commit, entry point, config, W&B project, results directory — as labelled lines whose labels are the user's own. Facts about elsewhere, not a Position: edited in place without a Revision.
_Avoid_: Location, run link, ran at

**Experiment Inbox**:
The Experiments that are *complete* and either have no observations yet or are Evidence for no Criterion — derived, never a flag. A run leaves it by being written up and attached, or by being abandoned; nothing clears it. The testing side's counterpart of the Question Inbox, under the same rule: no badge, no tally of undone work.
_Avoid_: Queue, backlog, uninterpreted runs (in copy)

**Evidence**:
An Experiment attached to one Criterion, with a note on what it shows for that Criterion — the note is required, since it is the difference between Evidence and a link. One Experiment may be Evidence for several Criteria across several Hypotheses. Attaching is a Revision of the Criterion and never records its Outcome; that stays a separate act.

**Linked from** (of a linked Artifact):
The machine an Artifact was linked on and its Fingerprint there, written beside it. What lets attaching it as Evidence say one of three things: *here and unchanged*, *on another machine* (named), or *changed or gone* — never a refusal. A link made on another machine is never judged missing here. A link to a URL is not checked and says so.
_Avoid_: Origin (a Proposal's), source machine, host (the shell's counterpart)

**Fingerprint** (of a linked Artifact):
Its size, modification time, and a hash of its first and last mebibyte — enough to tell an edited or replaced file from the one linked, without reading a checkpoint whole.
_Avoid_: Hash, checksum (both imply the whole file), document fingerprint (a PDF's, for Ingest)

**Artifact**:
A file produced by an Experiment — plot, screenshot, CSV snippet, sample output. *Stored* in the vault beside the Experiment when under 25 MB; *linked* with path, size, date, and description when heavier — the threshold proposes, and the choice is the user's per Artifact (#94). A property of the Artifact, never a Setting. A stored Artifact arrives either way: the app copies it in when the user adds it on the page, or it appears in the Experiment's folder by other means and the page offers to show it. The app copies an Artifact in, never out, and never moves one.
_Avoid_: Attachment, file (too general), output (that is what a run writes elsewhere)

### Scouts

**Scout**:
A scheduled background agent watching one source on a cadence and producing Proposals. Has a source, an optional Filter, and a cadence — structured fields only, never prose a model reads. Lives in App state, not the vault.
_Avoid_: Agent (too general), watcher, feed, brief (the design brief's metaphor; there is no text to brief a Scout with)

**Filter** (of a Scout):
What narrows a Scout's source: a Query, Tags, or nothing. A Tag becomes search terms deterministically, through its Lexicon, compiled into the source's own syntax (ADR 0018); until that slice lands a Filter is a Query. No model call is involved. The Questions a Scout is Assigned to are not part of its Filter: they say what it is for, not what it searches.
_Avoid_: Brief, prompt, topic

**Assigned** (a Scout, to Questions):
The open Questions a Scout is run on behalf of. Stamped on every Proposal's Origin and on the accepted stub; what the coverage-gap row counts a Question as covered by. Says nothing about how well a Proposal fits the Question — that is ranking, which is separate (ADR 0016).
_Avoid_: Briefed on, matched (implies a score), linked (that is Related), watching (that is the source relation)

**Due** (of a Scout):
Its cadence has elapsed since its last completed run — one that finished without failing. Runs happen only while the app is open — at vault open and on a periodic check — so a missed day is folded into the next run's window rather than lost. A failed run does not complete: a network or HTTP failure leaves the Scout due at the next check, while a rate-limited or unreadable answer waits a full cadence from the attempt, since asking again sooner gets the same answer. *Run now*, or editing the Query, runs it whether or not it is due.
_Avoid_: Scheduled, overdue, late

**Query**:
A hand-written search string, in the Structured source's own syntax, that a Scout sends as its Filter. The only Filter until the Lexicon exists; afterwards the escape hatch for a Question whose Tags have none.
_Avoid_: Prompt, search

**Watched source**:
One URL a Scout fetches on its cadence — a lab's publications page, a blog, a proceedings index. When the page advertises a Feed the Scout reads that, and the page is never sent to a model; otherwise it needs an Extraction. Never crawled: one page and the feed it advertises, no link-following. Has no Filter until Tags exist; its Scout is made on the same form as an arXiv Scout and is first run at its first due check, never on save.
_Avoid_: Site, crawl target, scrape

**Feed**:
An RSS or Atom document a Watched source advertises, whose entries map to a Proposal card directly. Read deterministically; no model call, no Extraction. A feed that fails is a failure said as one, never a reason to fall back to the model.

**Extraction**:
The one model call in the Scout pipeline: a Watched source's page, reduced to text, is asked for exactly the card fields — copied, never composed; missing shows as missing. Every returned item is then Verified before it can become a Proposal.
_Avoid_: Summarisation, parsing (that is what a Feed or an API gets), scraping

**Verified** (of an extracted item):
Its title and link both occur literally on the fetched page. An item that is not Verified is dropped and counted on the run, never proposed. What stands between a hallucinated card and the Queue.
_Avoid_: Confident, high-confidence (nothing is scored), validated

**Source key**:
What identifies a Proposal across sources: an arXiv id, else a DOI, else the normalised link. Two Scouts finding the same key produce one card with two Appearances.
_Avoid_: External id, dedup key

**Provider**:
A model API the user holds a key for. One at launch, Anthropic; identified by name, and the name is where its Credential lives.
_Avoid_: Vendor, backend, LLM

**Credential**:
The user's own key for a Provider, kept in the login Keychain by the app and read only when a run needs it. Entered once, never displayed again, removable. Leaves the device only in a request to that Provider.
_Avoid_: API key (in copy — say key), token (that is the session token), secret

**Blocked on credentials** (of a Scout):
A Scout whose Watched source needs an Extraction while no Credential exists, or whose Provider rejected the key. Nothing has failed; something is missing. Shown apart from *broken*, resolved by adding a key — storing one runs the Scouts waiting on it. *No key* is *not yet*; a key the Provider rejected is a fault in the *wrong* Voice, though Settings names both. The *no key* run it leaves went no further than the missing key, so it is no check of the field: it is left out of every count of runs, every mean over them and the Quiet field's baseline (ADR 0042). Read from either end of the same derivation: the Scout's row says it is waiting, and Settings names the Scouts waiting on that Provider's key — named, never counted (ADR 0025).
_Avoid_: Broken (a failure), unconfigured, disabled

**Structured source**:
A literature API a Scout queries — Semantic Scholar, arXiv, OpenAlex, PubMed, Crossref. Returns fields directly.

**Proposal**:
A metadata card a Scout produced: title, authors, date, venue, author keywords, abstract as published, link back, and Origin. No model-generated summary, no file. Missing fields show as missing; a field the source is known never to supply is not shown at all (ADR 0018). Lives in App state until accepted; acceptance writes a Source stub carrying the Origin.
_Avoid_: Candidate, suggestion, result, message, proposed Source

**Origin** (of a Proposal):
Which Scout found it, which Questions that Scout is Assigned to, and whether it came from a Retroactive search. Carried onto the Source stub on acceptance.

**Retroactive** (of a Proposal or a stub):
Found by a backward search over already-published work rather than by an ongoing run: for a Structured source, a search offered when the Scout is created and bounded by a backstop date; for a Watched source, everything already on the page at the Scout's first run. Shown as such so the batch can be triaged or rejected together.
_Avoid_: Backfill, historical, catch-up

**Appearance**:
One run returning a Proposal — the Scout, the run, when, and the link. A Proposal keeps every Appearance; a revised preprint or a second Scout's find is a new Appearance on the same card, never a second card. The mechanism Corroboration is built on.
_Avoid_: Duplicate, hit, occurrence

**Held** (of a Proposal):
A Proposal whose Source key is already a Source or Source stub in the vault — one the researcher made by hand, or one an earlier accept wrote before its record caught up. It is never a card: the run and the Scout's group count it, *already in your vault*, each linking to the file. Triage records nothing for it and Accept rate ignores it; nothing is written to the file it matches.
_Avoid_: Duplicate, skipped, filtered

**Lane**:
Where a Proposal sits for attention: *Review* (a queue; accept/reject is meaningful) or *Skim* (a feed; scrolling past is the interaction, items age out). Set by the Scout as a prior, then promoted or demoted by ranking — or promoted by hand, since Lanes govern attention, not capability.

**Triage** (of a Proposal):
Acting on a Proposal from the Queue: *accept* (writes a Source stub), *reject* (kept, never proposed again, no longer shown), *defer* (returns with that Scout's next completed run), or *promote* (Skim to Review). *Pass* moves on and records nothing; the card goes to the bottom of the session's stack. Every triage act is recorded with its time; Accept rate is read from that record. *Reject* and *defer* can be undone while the card is still in the session's stack; *accept* cannot, because it wrote a file (ADR 0039).
_Avoid_: Archive, dismiss, snooze (for defer), delete

**Corroboration**:
The same work surfacing from several Scouts, merged into one Proposal that keeps every appearance. A ranking signal; a merged card lands in the highest Lane any component reached.

**Accept rate**:
Per Scout, accepted over triaged Review-lane Proposals. Skim items are never rejected and carry no signal. Only a Proposal the Scout itself placed in Review counts: one the researcher promoted from Skim by hand and then accepted writes a stub like any other, but says something about the researcher's choosing, not about the Scout's brief. A *reject this run* on a Retroactive run is not counted either: clearing a backward search nobody wanted says nothing about the brief. Drawn over time as one point per week, and only for a week with enough triaged Review items to judge; a thinner week is a gap, never a zero.

**Candidates proposed** (per Scout):
New Proposals over the trailing thirty days, credited to the Scout of a Proposal's first Appearance — the credit Accept rate uses, so the two cannot disagree. A Held Proposal is not a find: it is counted apart as *already in your vault*, and a card another Scout also found is still counted once, with *also found elsewhere* on the first Scout's row. Shown as a bare count; no chart (ADR 0042).

**Cost per run** (per Scout):
The mean cost of the trailing thirty days' runs that called a model, read from the run rows and never stored on a Scout. A Scout whose runs make no model call says *no model call*, never $0.00; a run on a model the price table does not know shows its tokens and *unpriced* and is left out of the mean. A `no key` run is no run: it fetched nothing and is in no count or mean (ADR 0042).

**Dropped** (of a Scout):
Retired by the user: the Scout's file keeps its data and gains a `dropped` date, the scheduler skips it, and the Queue rail and Scout Activity stop listing it. Nothing it owns is removed — its runs, its triage record, the stubs that name it in `origin_scout` — so health, Accept rate and Clocked but unquestioned keep reading true. Its pending Proposals stay in Review until triaged, under its name, marked dropped; none is rejected on the user's behalf, since a bulk reject would write triage rows that speak about a brief the user has already given up on. Undoable while the row is on screen, and from the line that lists dropped Scouts. Not *paused*, which is a Scout that will look again.
_Avoid_: Deleted, archived, removed

**Coverage gap**:
An open Map row with no Scout looking for it: none of the Scouts Assigned to it is unpaused, undropped and free of a missing key. A Scout that is *broken* still covers, since its fault already surfaces on its own row. A Question whose only Scouts are not looking is a gap that names them. Shown on Scout Activity as a cut list with the cut stated, never totalled; resolved by briefing a Scout, which opens the new-Scout form with the Question already Assigned.
_Avoid_: Unbriefed (the brief's word — a Scout has no brief), uncovered (Coverage is Material, not Scouts)

**Source health**:
Per Scout: last successful run, last new item, and the last error and its kind — network, HTTP status, rate-limited, parse (the response lacked what was expected; an API's structure change), interrupted (the app closed before the run finished), credentials (no key, or the key rejected), model (the Provider failed or refused), or extraction (the items came back unverified, or none came back from a page that still lists what it listed before — a page's structure change). Derived from the Scout's runs, never stored on the Scout, and said in one sentence per error kind that every surface renders verbatim (ADR 0032). *Broken* means the most recent run did not succeed, and takes the *wrong* Voice. A Scout that has not looked — never run, Paused, or Blocked on credentials — takes *not yet*, and a Quiet field takes *claim*. Fields arriving systematically empty is not a health state: the items verify, so the run is `ok`, and it is the Accept rate that says why it cannot be computed.
_Avoid_: Status (of a Scout), failing (say broken), stale (only for a last successful run that is old, never for a partial Extraction)

**Quiet field**:
A Scout that ran, parsed cleanly and found nothing — the state a broken Scout must never be mistakable for (`CLAUDE.md` § Invariants). Said as a Claim rather than shown as a zero, warranted by three facts: when it last ran, that the run parsed cleanly, and what this source usually yields (ADR 0032). The third is what tells a source that is genuinely quiet from a reliably productive one gone unusually quiet, so no threshold judges it.
_Avoid_: Empty run, no results, zero new, silent (a Scout that has not looked is *not yet*, not quiet)

**Mute**:
A rule (author, venue, keyword) that moves Proposals to a muted view rather than discarding them.

### The app

**Host**:
The shell-side counterpart the core asks for the things only a desktop shell can do — show the folder chooser, and from beat 4 the file chooser an Artifact is added through (ADR 0035). A small interface the core is constructed with; the iPad client has no Host and so no chooser, because the vault lives on the Mac.
_Avoid_: Shell (the Host is what the shell provides, not the shell itself), bridge, IPC

**First run**:
What the window shows when no vault is open: the promise that files stay plain Markdown on disk with the app's own state in one folder beside them, and one action, *Open a vault*. Not a Surface. Also what a remembered vault that has gone missing yields — silently, because a moved folder is not a fault.
_Avoid_: Onboarding, welcome screen, empty state

### Surfaces and dashboards

**Surface**:
One of the eight screens the brief names: Home, Question Inbox, Reader, Research Question view, Hypothesis view, Experiment view, Scout Queue, Vault. All eight are about the work. Ingest review is a panel, not a Surface; First run is a state, not a Surface; Settings is a ninth screen and not one of the eight (ADR 0025).

**Dashboard**:
One of the three analytical surfaces opened deliberately from Home: Question Map, Scout Activity, Loose Ends. Each answers a distinct question, and every element leads to an action.

**Voice**:
Which of three things the first slot of a short surface or row is doing, and the app has exactly three (ADR 0032). *Claim*: it looked and there is nothing — a full sentence carrying a Warrant. *Not yet*: it has not looked — a fragment with no Warrant, and optionally the reason it has not, which is never a fault. *Wrong*: it tried and could not — the same fragment with the warning glyph and a reason, which always is. Learned on one surface and read the same on every surface after it, so a list that is empty can never be mistaken for one that failed.
_Avoid_: State, tone, empty state, zero state

**Warrant**:
What a Claim rests on, shown in the slot where a row otherwise carries its Provenance. Only the *claim* Voice has one: the other two assert nothing about the world, so they have nothing to prove (ADR 0032). A row asserting that nothing is there with an empty Warrant is unfinished, which is what makes the distinction survive a careless render.
_Avoid_: Evidence (that is a Hypothesis's), proof, justification (that is an Override's), caveat

**Settings**:
The screen that says how this vault is arranged: where the vault is, where the PDFs are, and what the app talks to. Every line on it is a fact with a referent outside the app, checkable against the world; it holds no preference — no value whose only effect is on the app's own behaviour — so there are no themes, no sync toggle, no account, and no home for a default that belongs to the object it governs. Not one of the eight Surfaces and not a Dashboard: those are the work and readings of it, this is the arrangement they sit in. Has an Address (`#/settings`) and opens with ⌘,; unreachable from First run (ADR 0025).
_Avoid_: Preferences, options, configuration, admin

**Address**:
Where the window is, as a URL hash the router parses — `#/inbox`, `#/loose-ends`, `#/settings`, `#/question/<path>`, `#/research-question/<path>`. Every surface and every object with a page has one; nothing can be on screen without one (ADR 0021). A Kind-addressed object takes its Kind's own name, singular, as `kind:` spells it; surfaces keep their own (ADR 0026). An Address naming an object is where to arrive, not a cursor that follows the user afterwards: moving the Inbox's selection does not rewrite it. One that does not resolve — the prefix ADR 0026 retired, or a file the vault cannot answer for — lands on the Inbox naming the Address and what came back, never on a page with nothing on it and never silently somewhere else (ADR 0027 decision 7). A hash nobody ever wrote is not an Address and says nothing.
_Avoid_: Route (the router's type, not the word for users), URL, link (that is a wikilink)

**Global command**:
⌘K: the window-wide command that goes to any object with an Address, or captures a Question, from any surface (story CAP-9). One list serves both, and what ↵ will do is named at all times rather than inferred. Reaches exactly what has an Address and nothing else, so a Kind joins the moment it gains a page and never before. Matches what its rows display — a Question's text, a Research Question's title — not the file name they happen to be stored under. Not the only way to capture: the Capture line keeps its own chord. Not the Picker, and not built from it (beat 2b, #262).
_Avoid_: Palette, command palette, search, Picker (the Picker is scoped to one slot and goes nowhere)

**Destination**:
Somewhere the Global command can go: an object with an Address, matched on its Display name, or one of the Surfaces and Dashboards the renderer merges in beside them. The core's half of the list knows only the objects — Kind, path and Display name — because a Surface is not a file and a hash is not the index's to know (#301). Ranked by how well it answers what was typed, then by Kind, then by how recently its file changed. Before a character is typed there is nothing to answer, so the list is the Surfaces and Dashboards and then the objects by that recency alone — what changed on disk, the same measure for every Kind, and never a record of where the user has been (#304).
_Avoid_: Result, hit, match (the strength of a match is one of a Destination's properties, not its name), target (a wikilink's)

**Capture line**:
⌘': the line at the foot of the window that captures a Question and nothing else, with the Provenance resolved before a character is typed. Kept beside the Global command rather than absorbed into it (beat 2b, #262). Neither chord is live when no vault is open (ADR 0025).
_Avoid_: Capture box, quick capture, inline capture, capture bar

**Sidebar**:
The list of surfaces and dashboards at the window's edge: the map of the product and where the user is on it. Its contents are layout, not a guarantee that something is reachable (ADR 0021).
_Avoid_: Rail (one of the forms it may take), nav

**Picker**:
The one keyboard list of vault files three places open — Link from the Inbox, attaching a Source to a Research Question, `[[` inside a why line. Name-contains over the Index, a Kind glyph per row, and — on a Source or a stub — its title and whether its PDF is there beside it, narrowed by whoever opened it to the Kinds it will accept and away from the file the user is standing on. The title is shown, not matched. Never a search — that is this list's own boundary and not the app's: the Global command matches what its rows display, and matching a body is the Vault editor's beat.
_Avoid_: Search, autocomplete, quick open, palette (the Global command is a different thing)

**Display name**:
The one string a file is named by on screen — a Question's text, a Research Question's title, a Hypothesis's current claim, a Source's title, a Note's file name. Distinct from the name it is stored under, which strips the characters Obsidian forbids and truncates, so the two diverge in the middle of a long or punctuated Question and not only at its tail. The Global command matches this; the Picker matches the stored name (ADR 0027).
_Avoid_: Title (a Source's own field), label, name (the stored basename)

**Loose end**:
One row on the Loose Ends dashboard: something incomplete or broken with a one-click resolution. *Mark deliberate* dismisses it permanently — permanently in the vault, but undoable for as long as the row is on screen (#266): a resolved row stays in place saying what happened, with *undo* beside it, and is gone on the dashboard's next read. Counted per group, never in total, and the count is of the rows still open.

**Row kind**:
What a Loose end is loose *about* — a Research Question with no source, a bare link matching several files — as distinct from the object it names. A dismissal is judged per row kind, so one object can be silenced as one kind and still surface as another.

**Open day**:
A local date on which the vault was opened, or its window brought to the front, in the app. The unit Loose Ends counts a stalled row's wait in, so time away from the vault never makes anything look stalled.
_Avoid_: Active day, calendar day (it is not one)

**Coverage**:
How much Material attaches to a Question (rows) or a Tag (columns) in the Question Map's coverage matrix. Explicit means a human made the link: a Question's Related, a source attached to a Research Question, or a Source stub accepted from a Scout Assigned to the Question — and only if the link resolves. Inferred connections never count; they are offered as Candidate links.

**Material** (of a Question):
A Source or Source stub explicitly attached to a Question, or one of its highlights. A highlight takes its Source's Tags, and a highlight and its own Source count once. Coverage is a count of distinct Material: a cell is the Material attached to a Question that carries a Tag, a row's weight is its distinct Material, a column's weight is the distinct Material carrying the Tag across the rows shown — never a sum of cells, which would count a paper with three Tags three times.
_Avoid_: Evidence (a Hypothesis's), support (that is the Supporting side), attachment

**Map row**:
One open thread of inquiry in the coverage matrix: an open Question that has not been promoted, or an open Research Question with its originating Question folded into it, so one thread is never split across two rows. Answered and abandoned threads are not rows, and neither is a Hypothesis, whose edges are Evidence and not Coverage.
_Avoid_: Question (a row may be a Research Question), item

**Well-supported**:
A reading of the Question Map: the Map rows at the top of the weight sort. Names material enough to answer or promote; carries no threshold of its own.

**Unanchored**:
A reading of the Question Map: a Map row with no Material. No age threshold — age stays a neutral, sortable fact — so a captured Question owes nothing and one promoted last week reads the same as one promoted a year ago. Read from this count and never from the bottom of the matrix, which truncates from the top of the sort (#245).
_Avoid_: Backlog (the prototype's word; there is no total to work through, #252), neglected, stale

**Unquestioned knowledge**:
A reading of the Question Map: a Tag carried by Material that no Map row has an edge to. Either settled, or a sign of collecting without asking.

**Clocked but unquestioned**:
A reading of the Question Map: a Source stub whose `origin_scout` is set, whose Scout was Assigned to no Question, and which no Question has since linked — counted per Tag. Derived, never stored: a stub does not record its Lane, so the reading says *kept from a Scout*, not *from Skim*, which is the brief's wording and diverges from it deliberately (ADR for #91).
_Avoid_: Skim items (the Lane is not recorded), orphan (a Loose Ends word)

**Candidate link**:
A (Question, paper) pair the inferred-link review offers: an unanchored Map row and a Source or stub sharing at least one Tag with it, ranked by shared Tags and then recency. Already-linked papers and rejected pairs never appear. Keyword overlap needs the Lexicon and waits for it. Accepting writes a Related edge and never Supporting or Opposing — attaching is the judgement (ADR 0020) — so a candidate is never evidence. Moves are accept `A`, open `O`, pass `P`, reject `R` (ADR 0016, update of 2026-09-26): pass records nothing and returns the candidate to the bottom of the session's stack; reject is recorded per pair in `dismissals.json` under the Question's `id` and the row kind `inferred-link:<paper id>`, and is undoable while the candidate is on screen; accept is not.
_Avoid_: Suggestion, inferred edge (it is not an edge until accepted), match (implies a score)

**Origins**:
A reading of the Question Map: Provenance aggregated across every Question regardless of Status — which sources and contexts the wondering came from, ranked by how many Questions each produced. Endogenous, like Coverage. Grouped by the Provenance `from` target across every context, with *unattached* captures as one line; each row carries how many Questions it produced and how much Material is attached to them, and the list is cut to its top 10 with the cut stated. Read beside the matrix: an Origin high on the list whose Material is thin is a source worth going back to. Carries no other statistic (how often a source was read, how many sessions a context had) — those are accumulation. The flow funnel the brief placed beside it was cut (#92).
_Avoid_: Provenance panel (Provenance is the per-Question fact; Origins is the aggregate), funnel, flow

**Lexicon**:
The Terms a Tag is measured and searched by: derived from the titles and abstracts of the Tag's papers, with author keywords as extra votes when known, and the user's Seeds and Exclusions applied. One set per Tag, compiled into each Structured source's own syntax. Flat, never inherited from the parent. Visible and editable; a Tag without one is *unplaced*, never low (ADR 0018).
_Avoid_: Keyword set (a keyword is author-supplied; a Term need not be), vocabulary, topic model

**Term**:
One phrase in a Lexicon — derived from the Tag's papers, seeded by the user, or an author keyword. Says nothing about who chose it.
_Avoid_: Keyword (reserved for author-supplied ones), tag, label

**Author keyword**:
A keyword the paper's authors supplied — returned by a Structured source, printed in the PDF, or typed into the Source's `keywords:`. One vote with more weight than a derived phrase; never the only input.
_Avoid_: Keyword alone (ambiguous with a Term), machine keyword, topic

**Seed**:
A Term the user typed into a Tag's Lexicon. Always included, whatever derivation says; a seeded Tag is never unplaced. Typed Terms are the only seeding path — pointing a Tag at a paper is ordinary tagging.
_Avoid_: Manual keyword, override (that is Seeds and Exclusions together), pin

**Excluded** (of a Term):
Removed from a Tag's Lexicon by the user and never derived back for that Tag. Recorded, never forgotten by the next recompute.
_Avoid_: Deleted, blocked, muted (a Scout Queue word)

**Tag's papers**:
The Sources and Source stubs that vote for a Tag's Lexicon: those carrying the Tag, plus those explicitly attached to a Question carrying it. The same set as the Tag's Coverage and as its point on the attention scatter. A parent's papers are the union of its descendants'.
_Avoid_: Corpus, training set, accept history (that is how the set grows, not what it is)

**Unplaced** (of a Tag):
Too few of its papers have text behind them to derive a Lexicon, and it has no Seed. Shown as such on the scatter, never as low attention; still counted toward its parent.
_Avoid_: Low, empty, unmeasured

**Re-measure pending** (of a Tag):
Its Lexicon has changed since field attention was last measured, so the point shows what was measured, marked as such, until the next sync. Distinct from unplaced and from low.
_Avoid_: Stale (a Scout health word), dirty, out of date
