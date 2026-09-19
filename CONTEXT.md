# Vitrine

A local-first research workspace whose primary object is the Question rather than the note. This is the vocabulary code, tests, issues, UI copy, and commit messages use. It starts from `docs/reference/design-brief.md` § Primary objects and is expected to diverge as implementation reveals distinctions the brief didn't need; any divergence traces to an ADR in `docs/adr/`.

## Language

### The vault

**Vault**:
The folder of plain Markdown files, PDFs, and small artifacts that holds everything the app knows. Readable and editable by any other tool; the app is not the only way in.
_Avoid_: Library (v1's word), database, workspace (that is the app)

**Note**:
An ordinary Markdown file with links, tags, and backlinks. Obsidian behaviour is the tiebreaker for anything unspecified.

**Tag**:
A slash-separated topic label parsed into a tree (`ml/interpretability/probing`). A parent's coverage is the union of its children's.
_Avoid_: Topic (a tag *is* the topic axis; "topic cluster" is a Scout Queue grouping, not a tag)

### Sources and reading

**Source**:
A PDF in the vault with highlights and annotations stored in the file itself.
_Avoid_: Paper, document, attachment

**Source stub**:
A bibliographic record with no PDF attached yet — title, authors, venue, date, link. Created by accepting a Proposal; becomes a Source when a PDF is attached.
_Avoid_: Reference, citation, placeholder

**Annotation**:
A highlight or margin note stored in a PDF as a standard annotation object, individually addressable so a Note or Question can link to it.
_Avoid_: Highlight (one kind of annotation, not the general term), comment

**Annotation identity**:
The app's stable ID for an Annotation, kept in a sidecar index mapping ID to page, rectangle, and quoted text. PDF objects have no reliable ID across editors, so identity is re-matched on every Ingest: quoted text first, geometry second.

**Ingest**:
The app noticing a changed PDF on disk and reading its Annotations back in. Triggered by the file, never by the user. Yields new Annotations, new Questions (from the `Q:` convention), and Unmatched Annotations.
_Avoid_: Import, sync (sync moves files; ingest reads them)

**Unmatched annotation**:
An Annotation that previously had links pointing at it and could not be re-identified on Ingest. Never dropped; surfaces in Loose Ends until resolved as *relink*, *drop the links*, or *treat as new*.

**`Q:` convention**:
An Annotation whose note begins with `Q:` becomes a Question on Ingest, with page and quoted passage as provenance.

### Questions

**Question**:
A lightweight capture that always carries Provenance. Has a Status. The app's primary object.
_Avoid_: Idea, task, todo, item

**Provenance**:
What the user was reading or doing when a Question was captured, the page or timestamp, and the date. Recorded automatically at capture, never reconstructed later.
_Avoid_: Source (that word is taken), origin (used for Proposals)

**Status** (of a Question):
One of *open*, *promoted*, *answered*, *abandoned*. Age is a neutral, sortable fact and never a state.
_Avoid_: Overdue, stale (in code — "stale" is only a Scout health term)

**Capture**:
Making a Question in two keystrokes from anywhere, with Provenance attached without typing.

**Triage** (of a Question):
Acting on a Question from the Inbox: promote to Research Question, promote to Hypothesis, link, answer, or drop.

**Promotion**:
Turning a Question into a Research Question or a Hypothesis. The Question's Provenance travels with it. A Research Question may sharpen into a Hypothesis; that is the expected route.

**Research Question**:
A promoted Question answered by reading. Holds a Working answer with Position history, supporting Sources, opposing Sources, related questions, and open threads. Supporting and opposing are structurally separate, not a tag on one list.
_Avoid_: RQ in prose; project

**Working answer**:
What the user currently believes about a Research Question. Explicitly provisional; a Position.

### Position history

**Position**:
A claim held at a time — a Working answer, a Hypothesis claim, an Experiment design or observation, or a Criterion. Editing one adds a Revision rather than overwriting.

**Revision**:
One entry in a Position history: when it changed and what it changed from. Recorded automatically. May carry a *why*.

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
*supported* when all Criteria are met; *falsified* when any falsifying Criterion is met; otherwise *inconclusive*. Inconclusive is the default and a real outcome. An override to supported requires a written justification recorded as a Revision.

**Experiment**:
A run designed and recorded here but executed elsewhere. Exists independently of any Hypothesis. Holds purpose, design, where it ran, Artifacts, observations, and a hand-maintained status (*planned*, *running*, *complete*, *abandoned*).
_Avoid_: Run (that is what happened elsewhere), test

**Evidence**:
An Experiment attached to one Criterion, with a note on what it shows for that Criterion. One Experiment may be Evidence for several Criteria across several Hypotheses.

**Artifact**:
A file produced by an Experiment — plot, screenshot, CSV snippet, sample output. *Stored* in the vault beside the Experiment when small; *linked* with path, size, date, and description when heavyweight. The threshold is unset (brief § Open questions).

### Scouts

**Scout**:
A scheduled background agent watching one source on a cadence and producing Proposals. Has a source, an optional filter, and a cadence.
_Avoid_: Agent (too general), watcher, feed

**Watched source**:
A page or feed a Scout extracts from — a lab's publications page, a blog, a proceedings index, RSS/Atom. Extraction may need a model call.

**Structured source**:
A literature API a Scout queries — Semantic Scholar, arXiv, OpenAlex, PubMed, Crossref. Returns fields directly.

**Proposal**:
A metadata card a Scout produced: title, authors, date, venue, keywords, abstract as published, link back, and Origin. No model-generated summary, no file. Missing fields show as missing.
_Avoid_: Candidate, suggestion, result, message

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
