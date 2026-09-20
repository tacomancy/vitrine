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

**Kind**:
Which sort of thing a vault file is — Note, Source, Source stub, Question, Research Question, Hypothesis, or Experiment. Declared in the file itself, never inferred from the folder it sits in.
_Avoid_: Type (taken by the type system), category

**Note**:
An ordinary Markdown file with links, tags, and backlinks. Obsidian behaviour is the tiebreaker for anything unspecified.

**Tag**:
A slash-separated topic label parsed into a tree (`ml/interpretability/probing`), the same tag whatever its casing. A parent's coverage is the union of its children's.
_Avoid_: Topic (a tag *is* the topic axis; "topic cluster" is a Scout Queue grouping, not a tag)

**Owned section**:
A `##` section of a vault file that the app rewrites whole — `## Annotations`, `## Position history` — as opposed to the user's prose, which it never touches.
_Avoid_: Managed section, generated section

**Shape problem**:
An app-owned file missing structure its Kind expects, such as a Hypothesis without `## Criteria`.
_Avoid_: Corrupt, malformed, invalid file

**Ambiguous link**:
A bare wikilink whose name matches more than one file. Resolves to nothing and surfaces as a Loose end rather than picking one.
_Avoid_: Broken link (that is an unresolved one), conflict

### Sources and reading

**Source**:
A PDF in the vault with highlights and annotations stored in the file itself.
_Avoid_: Paper, document, attachment

**Source stub**:
A bibliographic record with no PDF attached yet — title, authors, venue, date, link. Created by accepting a Proposal; becomes a Source when a PDF is attached. The same record throughout: attaching changes nothing anyone links to.
_Avoid_: Reference, citation, placeholder

**Citekey**:
The short handle a Source or Source stub is linked by — first author's surname and year, `klinzing2019`, with a letter suffix on collision.
_Avoid_: Key, slug, bibkey

**Annotation**:
A highlight or margin note stored in a PDF as a standard annotation object, individually addressable so a Note or Question can link to it.
_Avoid_: Highlight (one kind of annotation, not the general term), comment

**Annotation identity**:
The app's stable ID for an Annotation, kept in a sidecar index with its page, geometry, and quoted text. PDF objects have no reliable ID across editors, so identity is re-matched on every Ingest: quoted text first, geometry second.

**Ingest**:
The app noticing a changed PDF on disk and reading its Annotations back in. Triggered by the file, never by the user. Yields new Annotations, new Questions (from the `Q:` convention), Removed Annotations, and Unmatched Annotations. Every PDF that changed together is one Ingest run.
_Avoid_: Import, sync (sync moves files; ingest reads them)

**Ingest run**:
One batch of PDFs that settled together, ingested as one: one summary line, at most one panel, one record in App state. Fifty PDFs returning from the iPad are one run, not fifty notifications.
_Avoid_: Ingest event, batch (in UI copy)

**Settled** (of a file):
Quiet for long enough — no watcher events, two stats agreeing — that a sync client or Preview is judged to have finished writing it. Nothing is read or hashed before it settles.
_Avoid_: Stable, debounced

**Sweep**:
A stat-only pass over files comparing size and modification time to what the app recorded, catching up what the watcher could not see — at vault open, after a watcher failure, and over the PDF folder when the window regains focus. Reads no content. Never a timer.
_Avoid_: Poll, rescan, full scan

**Evicted** (of a PDF):
Present in the folder but with its bytes not on disk — iCloud or Dropbox keeping it online-only. Unreadable-not-changed: never hashed, never ingested, until the Reader opens it and the read brings it down.
_Avoid_: Missing (that is a file that is gone), placeholder, offline

**Conflict copy**:
A second PDF the sync service created because the Mac and the iPad both wrote the same file — recognised by a document fingerprint matching an existing Source. Never a Source of its own; a Loose end resolved as *use this copy* or *discard*.
_Avoid_: Duplicate, new Source

**Unmatched annotation**:
An Annotation that previously had links pointing at it and could not be re-identified on Ingest. Never dropped; surfaces in Loose Ends until resolved as *relink*, *drop the links*, or *treat as new*.

**Removed annotation**:
An Annotation that nothing linked to and that could not be found on Ingest. Counted, never a decision; a vanished Annotation that something pointed at is Unmatched instead.
_Avoid_: Deleted (the app did not delete it), lost

**Tombstone**:
What an Annotation becomes when the user resolves it as *gone*: its identity and quoted text stay so every link to it still resolves, marked as gone. The user's notes are theirs to edit; the app never rewrites a link on their behalf.
_Avoid_: Deleted annotation, dangling link

**`Q:` convention**:
An Annotation whose note begins with `Q:` becomes a Question on Ingest, with page and quoted passage as provenance.

### Questions

**Question**:
A lightweight capture that always carries Provenance. Has a Status. The app's primary object.
_Avoid_: Idea, task, todo, item

**Provenance**:
What the user was reading or doing when a Question was captured, the page or timestamp, and the date. Recorded automatically at capture, never reconstructed later.
_Avoid_: Source (that word is taken), origin (used for Proposals)

**Unattached**:
The Provenance of a Question captured with no document open: `context: other` and no `from`. Time and place are still a Provenance, so the capture is never blocked on a choice; what it belongs to can be linked later.
_Avoid_: No provenance (it has one), orphan (a Loose Ends word), untagged

**Status** (of a Question):
One of *open*, *promoted*, *answered*, *abandoned*. Age is a neutral, sortable fact and never a state. Every status is shown as a glyph and a label (`◆` open, `■` promoted, `●` answered, `×` dropped — the label follows the triage verb); only open carries colour, and that colour is the accent. A file with no `status:` is open: it was never triaged (ADR 0009).
_Avoid_: Overdue, stale (in code — "stale" is only a Scout health term)

**Unattached**:
The Provenance of a Question captured with no document open — `context: other` and no `from`. Time and place are still a Provenance, so the Inbox shows the word rather than a blank.
_Avoid_: No provenance, unknown, none

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
Turning a Question into a Research Question or a Hypothesis. The Question stays as its own record with Status *promoted*, and the new object carries a copy of the Provenance. A Research Question may sharpen into a Hypothesis; that is the expected route.

**Write-back**:
A resolved Hypothesis answering the Question it came from, and any Research Question in between: each becomes *answered* with one line pointing at the result. Falsified is a real answer.
_Avoid_: Close, resolve (that is what happens to the Hypothesis)

**Related** (of a Question):
Another Question, Note, or Source the user explicitly linked from the Inbox's Link action. Only these count as edges for Coverage; a mention in prose does not.
_Avoid_: Mentioned, connected, see also

**Research Question**:
A promoted Question answered by reading. Holds a Working answer with Position history, supporting Sources, opposing Sources, related questions, and open threads. Supporting and opposing are structurally separate, not a tag on one list.
_Avoid_: RQ in prose; project

**Working answer**:
What the user currently believes about a Research Question. Explicitly provisional; a Position.

### Position history

**Position**:
A claim held at a time — a Working answer, a Hypothesis claim, an Experiment design or observation, or a Criterion. Editing one adds a Revision rather than overwriting.

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
One independently resolvable condition on a Hypothesis, recorded before evidence arrives. Has an Outcome and a Relationship.

**Outcome** (of a Criterion):
*met*, *not met*, or *inconclusive*.

**Relationship** (of a Criterion to its claim):
*confirming* (met supports), *falsifying* (met kills the claim regardless of the others), or *diagnostic* (informative, does not decide).

**Derived state** (of a Hypothesis):
*supported* when all Criteria are met; *falsified* when any falsifying Criterion is met; otherwise *inconclusive*. Inconclusive is the default and a real outcome. Never stored, always recomputed.

**Override**:
A considered call that an inconclusive Hypothesis is supported on partial evidence. Exists only as a Revision with a mandatory why; any later change to a Criterion voids it, and the voiding is itself a Revision.
_Avoid_: Manual status, force supported

**Experiment**:
A run designed and recorded here but executed elsewhere. Exists independently of any Hypothesis. Holds purpose, design, where it ran, Artifacts, observations, and a hand-maintained status (*planned*, *running*, *complete*, *abandoned*).
_Avoid_: Run (that is what happened elsewhere), test

**Evidence**:
An Experiment attached to one Criterion, with a note on what it shows for that Criterion. One Experiment may be Evidence for several Criteria across several Hypotheses.

**Artifact**:
A file produced by an Experiment — plot, screenshot, CSV snippet, sample output. *Stored* in the vault beside the Experiment when small; *linked* with path, size, date, and description when heavyweight. The threshold is unset (brief § Open questions).

### Scouts

**Scout**:
A scheduled background agent watching one source on a cadence and producing Proposals. Has a source, an optional Filter, and a cadence — structured fields only, never prose a model reads. Lives in App state, not the vault.
_Avoid_: Agent (too general), watcher, feed, brief (the design brief's metaphor; there is no text to brief a Scout with)

**Filter** (of a Scout):
What narrows a Scout's source: Tags, links to Questions, a Query, or nothing. Questions and Tags become search terms deterministically, through the Tag's Lexicon; no model call is involved.
_Avoid_: Brief, prompt, topic

**Query**:
A hand-written search string a Scout sends to a Structured source, as a Filter in its own right or beside Question links. The escape hatch for a Question whose Tags have no Lexicon yet.
_Avoid_: Prompt, search

**Watched source**:
A page or feed a Scout extracts from — a lab's publications page, a blog, a proceedings index, RSS/Atom. Extraction may need a model call.

**Structured source**:
A literature API a Scout queries — Semantic Scholar, arXiv, OpenAlex, PubMed, Crossref. Returns fields directly.

**Proposal**:
A metadata card a Scout produced: title, authors, date, venue, keywords, abstract as published, link back, and Origin. No model-generated summary, no file. Missing fields show as missing. Lives in App state until accepted; acceptance writes a Source stub carrying the Origin.
_Avoid_: Candidate, suggestion, result, message, proposed Source

**Origin** (of a Proposal):
Which Scout found it and which Question it matched. Retroactive results are tagged as such.

**Lane**:
Where a Proposal sits for attention: *Review* (a queue; accept/reject is meaningful) or *Skim* (a feed; scrolling past is the interaction, items age out). Set by the Scout as a prior, then promoted or demoted by ranking.

**Corroboration**:
The same work surfacing from several Scouts, merged into one Proposal that keeps every appearance. A ranking signal; a merged card lands in the highest Lane any component reached.

**Accept rate**:
Per Scout, accepted over triaged Review-lane Proposals. Skim items are never rejected and carry no signal.

**Source health**:
Per Scout: last successful extraction, last new item, and whether a structure change was detected. A broken Scout must never look identical to a quiet field.

**Mute**:
A rule (author, venue, keyword) that moves Proposals to a muted view rather than discarding them.

### The app

**Host**:
The shell-side counterpart the core asks for the things only a desktop shell can do — today, one thing: show the folder chooser. A one-method interface the core is constructed with; the iPad client has no Host and so no chooser, because the vault lives on the Mac.
_Avoid_: Shell (the Host is what the shell provides, not the shell itself), bridge, IPC

**First run**:
What the window shows when no vault is open: the promise that files stay plain Markdown on disk with the app's own state in one folder beside them, and one action, *Open a vault*. Not a Surface. Also what a remembered vault that has gone missing yields — silently, because a moved folder is not a fault.
_Avoid_: Onboarding, welcome screen, empty state

### Surfaces and dashboards

**Surface**:
One of the eight screens: Home, Question Inbox, Reader, Research Question view, Hypothesis view, Experiment view, Scout Queue, Vault. Ingest review is a panel, not a surface.

**Dashboard**:
One of the three analytical surfaces opened deliberately from Home: Question Map, Scout Activity, Loose Ends. Each answers a distinct question, and every element leads to an action.

**Loose end**:
One row on the Loose Ends dashboard: something incomplete or broken with a one-click resolution. *Mark deliberate* dismisses it permanently. Counted per group, never in total.

**Coverage**:
How much explicitly linked material attaches to a Question (rows) or a Tag (columns) in the Question Map's coverage matrix. Inferred connections never count; they are offered as candidate links.

**Lexicon**:
The keyword set a Tag is measured against for field attention, built from accept history. Flat, never inherited from the parent. A Tag without one is *unplaced*, never low.
