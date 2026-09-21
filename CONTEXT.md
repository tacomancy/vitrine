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

**Owned section**:
A `##` section of a vault file that the app rewrites whole — `## Annotations`, `## Position history` — as opposed to the user's prose, which it never touches.
_Avoid_: Managed section, generated section

**Shape problem**:
An app-owned file missing structure its Kind expects, such as a Hypothesis without `## Criteria`.
_Avoid_: Corrupt, malformed, invalid file

**Changed on disk**:
The state of a file open in the Vault editor with unsaved typing whose bytes on disk no longer match what the editor was given — an Obsidian edit, a sync, the app's own splice. Shown as a line, never a dialog; resolved as *keep mine* or *take the disk copy*, and until then nothing is written. A clean editor simply reloads.
_Avoid_: Conflict, merge, stale (a Scout health word)

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

**Batch** (of the watcher):
The files that settled together, applied to the Index as one transaction and announced as one change. For PDFs a Batch is also one Ingest run and waits a run window for stragglers; a Markdown Batch closes the moment its files settle.
_Avoid_: Debounce group, changeset

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
What narrows a Scout's source: a Query, Tags, or nothing. A Tag becomes search terms deterministically, through its Lexicon, compiled into the source's own syntax (ADR 0018); until that slice lands a Filter is a Query. No model call is involved. The Questions a Scout is Assigned to are not part of its Filter: they say what it is for, not what it searches.
_Avoid_: Brief, prompt, topic

**Assigned** (a Scout, to Questions):
The open Questions a Scout is run on behalf of. Stamped on every Proposal's Origin and on the accepted stub; what the coverage-gap row counts a Question as covered by. Says nothing about how well a Proposal fits the Question — that is ranking, which is separate (ADR 0016).
_Avoid_: Briefed on, matched (implies a score), linked (that is Related), watching (that is the source relation)

**Due** (of a Scout):
Its cadence has elapsed since its last completed run. Runs happen only while the app is open — at vault open and on a periodic check — so a missed day is folded into the next run's window rather than lost. *Run now* runs a Scout whether or not it is due.
_Avoid_: Scheduled, overdue, late

**Query**:
A hand-written search string, in the Structured source's own syntax, that a Scout sends as its Filter. The only Filter until the Lexicon exists; afterwards the escape hatch for a Question whose Tags have none.
_Avoid_: Prompt, search

**Watched source**:
One URL a Scout fetches on its cadence — a lab's publications page, a blog, a proceedings index. When the page advertises a Feed the Scout reads that; otherwise it needs an Extraction. Never crawled: one page, no link-following.
_Avoid_: Site, crawl target, scrape

**Feed**:
An RSS or Atom document a Watched source advertises, whose entries map to a Proposal card directly. Read deterministically; no model call, no Extraction.

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
A Scout whose Watched source needs an Extraction while no Credential exists, or whose Provider rejected the key. Nothing has failed; something is missing. Shown apart from *broken*, resolved by adding a key.
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

**Lane**:
Where a Proposal sits for attention: *Review* (a queue; accept/reject is meaningful) or *Skim* (a feed; scrolling past is the interaction, items age out). Set by the Scout as a prior, then promoted or demoted by ranking — or promoted by hand, since Lanes govern attention, not capability.

**Triage** (of a Proposal):
Acting on a Proposal from the Queue: *accept* (writes a Source stub), *reject* (kept, never proposed again, no longer shown), *defer* (returns with that Scout's next completed run), or *promote* (Skim to Review). *Next* moves on and records nothing. Every triage act is recorded with its time; Accept rate is read from that record.
_Avoid_: Archive, dismiss, snooze (for defer), delete

**Corroboration**:
The same work surfacing from several Scouts, merged into one Proposal that keeps every appearance. A ranking signal; a merged card lands in the highest Lane any component reached.

**Accept rate**:
Per Scout, accepted over triaged Review-lane Proposals. Skim items are never rejected and carry no signal.

**Source health**:
Per Scout: last successful run, last new item, and the last error and its kind — network, HTTP status, rate-limited, parse (the response lacked what was expected; an API's structure change), credentials (no key, or the key rejected), model (the Provider failed or refused), or extraction (the items came back unverified, or none came back from a page that still lists what it listed before — a page's structure change). Derived from the Scout's runs, never stored on the Scout. *Broken* means the most recent run did not succeed; a run that succeeded and found nothing — or found the page unchanged and never called the model — is a quiet field, and the two must never look alike.
_Avoid_: Status (of a Scout), failing (say broken), stale (only for a last successful run that is old)

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
How much explicitly linked material attaches to a Question (rows) or a Tag (columns) in the Question Map's coverage matrix. Explicit means a human made the link: a Question's Related, a source attached to a Research Question, or a Source stub accepted from a Scout Assigned to the Question. Inferred connections never count; they are offered as candidate links.

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
