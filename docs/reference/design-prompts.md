# Design prompts

One prompt per session, in this order. Each is written to stand alone — paste it whole, react to what comes back, then move on. Order is deliberate: Question Inbox first because it embodies the premise, Home last because it summarizes everything else.

## Prompt 0 — Establish the shape

Don't ask for finished screens here. The goal is a visual language and a navigation model, so that "Source stub" and "Skim lane" mean something in later prompts.

---

I'm designing a desktop research workspace, built with web technology and packaged as a desktop app on macOS, with the same app opened on an iPad as a full-screen PWA for reading. Think Obsidian — a local-first Markdown vault with bidirectional links, tags, folders, and a graph view — but built around a different primary object.

Obsidian's primary object is the note. Mine is the **question**. The premise: research is driven by open questions, not by documents. Most tools let you store what you've read. Almost none let you track what you still want to know, where the wondering came from, and whether you ever resolved it.

The app has these objects:

- **Note** — ordinary Markdown note with links, tags, backlinks
- **Source** — a PDF with highlights and annotations; annotations are individually linkable
- **Source stub** — a bibliographic record with no file attached yet
- **Question** — a lightweight capture that always records its provenance (what I was reading, which page, when)
- **Research Question** — a promoted Question with structure: working answer, supporting sources, opposing sources
- **Scout** — a scheduled background agent that watches a source and proposes papers

And these six surfaces:

1. **Home** — today's state at a glance; light by design
2. **Question Inbox** — recent captures awaiting triage
3. **Reader** — PDF viewing, highlighting, annotation
4. **Research Question view** — the structured page for one promoted question
5. **Scout Queue** — agent-proposed papers awaiting accept or reject
6. **Vault** — ordinary note-taking plus graph view

For this first pass I want the **overall shape**, not finished screens: the navigation model and how the six surfaces relate; the visual language (typography, color, density, how a serious research tool should feel to work in for hours); and a rough wireframe of the main window showing where navigation lives and how a surface occupies it.

Tone: this is a tool for sustained focused work, not a consumer app. It should feel closer to a well-made desktop application than to a web dashboard. Dense where density helps, calm everywhere else.

## Prompt 1 — Question Inbox

Run this first. If it doesn't feel right, something is wrong upstream in the premise, and you want to know that before five more screens are drawn.

---

Design the **Question Inbox** for the research workspace we established.

This is the screen that carries the app's premise, so it matters most. A Question is something I wondered while doing something else — reading a paper, sitting in a lecture, writing a note. Capture takes two keystrokes and is never interrupted by a form. The Inbox is where those captures land.

**Every Question carries provenance** — what I was reading or doing, the page or timestamp, and the date. This is the feature no other tool has, and it should be visible on every row without dominating it. "Q: does this hold for sparse inputs?" means little; the same question showing it came from page 7 of a specific paper three weeks ago is a different object entirely.

**A Question has a status:** open, promoted, answered, abandoned. Triage actions from the Inbox:

- **Promote to Research Question** — for things I'll answer by reading
- **Promote to Hypothesis** — for things I'll answer by testing
- **Link** — attach it to an existing question, note, or source
- **Answer** — resolve it in place
- **Drop** — abandon it

**The hardest design constraint:** most questions will stay open forever, and that is expected, not a failure. Idle curiosity is the raw material. So this screen must never feel like a backlog of debt.

- No badge counting unanswered questions
- No overdue states, no red, no nagging
- Age is a sortable dimension and a neutral fact, not a warning
- A list that only grows must still feel inviting to open on day 400

This is the central tension: it needs to be genuinely useful for triage while never implying I'm behind. Sorting, filtering by tag or status or origin, and search all matter, because at volume this list gets long.

Show me the Inbox at realistic scale — a few hundred questions, varied ages, mixed origins. I want to see how it handles being full, not how it looks on day one.

Also show the two-keystroke capture interaction: what appears when I hit the shortcut while reading, and how provenance gets attached without me typing it.

## Prompt 2 — Reader

The other capture path, and the one that has to work on a tablet.

---

Design the **Reader** for the research workspace.

This is where I read PDFs — papers, book chapters, slide decks — with highlighting and margin annotation. The app is web technology, packaged as a desktop app on macOS. In phase 1 the tablet reading happens in Preview on iPadOS rather than in my app: PDFs sync via a folder, I annotate with an Apple Pencil, and the Mac app ingests the annotations when the file comes back. So this Reader is primarily a desktop surface — but it must also work full-screen at iPad proportions with touch and pencil targets, because a browser-based tablet Reader is the next phase.

**Annotations are first-class, addressable objects.** A highlight is not decoration on a file; it's a thing a note can link to. "See the third paragraph of section 4" becomes an actual link to an actual highlight. Design for that: highlights need identity, and it should be obvious how to reference one.

**Selecting text offers three actions:**

- **Make a note** — a new Markdown note seeded from the selection
- **Make a question** — a Question capture, provenance filled in automatically from the paper, page, and position
- **Link to existing** — connect this passage to a note, question, or another source

The second is the important one. A question that occurs to me on page 7 should cost nothing to record and should remember exactly where it came from, with no typing beyond the question itself.

**Annotations arrive two ways, and the Reader must handle both.** Made in the app directly, or ingested from a PDF annotated elsewhere. Ingested highlights whose note begins with `Q:` become Questions automatically, with page and quoted passage attached.

**Design the ingest review.** When a PDF returns with new annotations, I need to see what came in: new highlights, which became Questions, and — critically — any annotation the app could not confidently re-match to its previous identity. Annotation identity is reconstructed from quoted text and geometry, so it can fail, and a silent failure rots links. Unmatched annotations should surface for a decision, not disappear.

**Design priorities, in order:**

1. Reading comfort. This is where hours are spent. Typography, margins, and contrast matter more than feature density. Chrome should recede while reading.
2. Annotation without leaving the page. Highlighting and margin notes should feel like paper, not like a form.
3. Capture that doesn't interrupt. The question-capture interaction must not pull me out of reading.
4. Tie-back visibility. While reading, I should be able to see that this paper already connects to things I know — existing notes, existing questions, prior highlights — without that display competing with the text.

Show the reading view in its calm state, the selection interaction with its three actions, and how existing connections to this source surface without cluttering the page.

Show the Reader at two sizes: as a panel inside the desktop window, and full-screen at iPad proportions with touch and pencil targets sized accordingly. The second is how it's actually used for hours, so it should feel like the whole app rather than a stripped-down view. Also show the desk configuration: Reader on the tablet, Research Question view on the Mac, and how capture flows between them.

## Prompt 3 — Research Question view

The promotion destination, and where position history gets designed — it's reused by Hypothesis and Experiment, so get it right here.

---

Design the **Research Question view** for the research workspace.

This is what a Question becomes when I promote it — a question I've decided to actually pursue by reading. One page per question, and it lives for months.

**Its structure:**

- **The question itself**, with its original provenance preserved — where I first wondered it
- **Working answer** — what I currently believe, explicitly provisional and expected to change
- **Position history** — how that answer has evolved, and why
- **Supporting sources** — evidence for
- **Opposing sources** — evidence against
- **Related questions** — links to other questions, including the sub-questions this one spawned
- **Open threads** — what I still don't know

**The key design idea:** supporting and opposing sources are *structurally separate*, not one bibliography with tags. A living literature review for a single question should make the shape of the disagreement visible at a glance. If everything I've collected supports my working answer, that should look conspicuous rather than comfortable.

Each attached source can carry my own note on why it's here — which specific finding supports or undercuts the answer — and can link down to specific annotations in the PDF rather than just to the paper as a whole.

**Position history is the app's real subject.** What I currently believe matters less than how I came to believe it and what changed my mind. The working answer is not a field that gets overwritten — it is a position held at a time, and editing it adds to a history rather than replacing one.

Two tiers, and the distinction drives the design:

- **Every revision is recorded automatically** — when it changed, what it changed from. No prompt, no friction. Editing must feel as fast as editing a text field, because a mechanism that slows down writing stops being used.
- **Any revision can carry a "why"** — a short note on what prompted the change, optionally linked to the source, annotation, or experiment responsible.

Marked revisions are what the history view leads with. Unmarked ones collapse into a quiet trail of dates. The effect is that recording reasoning is optional but rewarded: a question whose answer shifted four times with three explanations reads as a train of thought, while one that shifted silently still shows *that* it shifted.

Design both the inline affordance — how I add a "why" while editing, without being interrupted if I don't want to — and the history view itself, which should read as a narrative of changing your mind rather than as a diff log.

**What it must not become:** a generic document editor with headings. The structure is the point. But it also can't be so rigid that it's tedious to maintain — most of these pages will be half-filled most of the time, and a page with an empty "opposing sources" section shouldn't look broken.

**Show these states:**

1. **Freshly promoted** — the question, its provenance, and almost nothing else. This is the most common state and it must look intentional, not empty.
2. **In progress** — some sources on both sides, a hedged working answer, a few open threads
3. **Mature** — many sources, a confident answer, resolved and unresolved threads visible

Also show how a source gets attached and sorted into supporting or opposing, and the position history view for a question whose answer has changed several times — some revisions explained, some not.

## Prompt 4 — Hypothesis view

The other promotion path. The derived-state mechanic is the point; watch for it coming back as a status dropdown.

---

Design the **Hypothesis view** for the research workspace.

A Hypothesis is what a Question becomes when it needs testing rather than reading. The app never executes anything — my experiments are computational and analytical, and run in other tools. This app owns the **argument**: what I'm claiming, what would disprove it, and whether the evidence changed my mind.

**The page holds:**

- **The claim** — a falsifiable statement, with position history showing how it has been revised
- **Criteria** — a list, each independently resolvable, each with an outcome of met, not met, or inconclusive
- **Design notes** — what's varied, what's held constant, known confounds. A paragraph, not a formal DOE matrix.
- **Evidence** — Experiments attached per criterion, each with a note on what it shows *for that criterion*

**Each criterion declares its relationship to the claim:** *confirming* (met supports it), *falsifying* (met kills it regardless of the others), or *diagnostic* (informative but doesn't decide). These need to be visually distinct — falsifying criteria carry more weight than the others and the page should show that.

**The central mechanic: state is derived, never chosen.** There is no status dropdown.

- All criteria met → **supported**
- Any falsifying criterion met → **falsified**
- Mixed or unresolved → **inconclusive**

**Inconclusive is the default and a real outcome**, not a waiting state. With cheap computational runs it's the most common honest result. Overriding it to "supported" is allowed but requires a written justification that lands permanently in the position history — the design should make that override feel like a considered act rather than a click.

**Falsified is a result, not a failure.** It should look as substantial as supported, never greyed out or struck through. It answers the originating question with a real answer, and it typically spawns the next question — so resolving a hypothesis offers to capture that follow-up, pre-linked to the result.

**Criteria are recorded before evidence arrives.** They aren't locked, but a criterion edited after evidence exists must be conspicuous in the history and stay conspicuous. This is the mechanic that guards against post-hoc storytelling, which is the real risk when runs are cheap enough to do two hundred of them.

Show three states: freshly promoted with criteria stated and no evidence; mid-flight with some criteria resolved and conflicting; and concluded as falsified. Also show the position history view, and the criterion-edited-after-evidence warning state.

## Prompt 5 — Experiment view

Independent of hypotheses. The artifact handling is new to this app — nothing else in the vault works this way.

---

Design the **Experiment view** and its inbox for the research workspace.

An Experiment is a run I designed and recorded here but executed elsewhere — in code, a notebook, W&B, a results directory. Crucially it **exists independently of any hypothesis**. I run things to see what happens before knowing what claim they bear on, and some never attach to one. An experiment that produced an interesting surprise still needs somewhere to live.

It's the testing-side counterpart of a captured Question: noticed, recorded, maybe promoted later, maybe not.

**The page holds:**

- **Purpose** — what I'm trying to find out. Often looser than a claim: "see whether X matters at all."
- **Design** — what's varied, what's held, conditions, how it's measured. Written before running, with position history so design changes are visible.
- **Where it ran** — links to code, config, commit, W&B project, results directory
- **Artifacts** — screenshots, plots, data snippets, sample outputs
- **Observations** — what I saw, with position history, because interpretation changes
- **Status** — planned, running, complete, abandoned. Maintained by hand; the app drives nothing.

**Artifacts are new to this app.** Everything else in the vault is text I wrote or a PDF I acquired. Artifacts exist nowhere else, so losing them loses the result. Small files are stored in the vault beside the experiment note; heavyweight ones (checkpoints, full datasets) are linked with enough metadata to find them again. A size threshold decides, always overridable, and the app warns rather than silently linking — an artifact outside the vault can vanish without the vault noticing.

Design the artifact area for **visual scanning**: plots and screenshots are the primary record of what happened, so they want to be viewable inline at a useful size, not filed as attachment chips. Mixed types in one place — an image, a CSV snippet, a small table.

**Promotion to evidence is a separate act.** Attaching this Experiment to a Hypothesis criterion carries its own note about what it shows for that criterion. One Experiment can attach to several criteria across several hypotheses, so show how those existing attachments appear on the Experiment page.

**The Experiment Inbox** holds completed runs not yet interpreted or attached — the experimental counterpart to the Question Inbox. Same tone rule applies: it will always have things in it, and that's fine. No debt, no badges.

Show the Experiment page with a rich set of artifacts, the page for one that's still just a design with no results, and the inbox at realistic volume.

## Prompt 6 — Scout Queue

Dense. Expect the first pass to come back as a generic email-style inbox and push back.

---

Design the **Scout Queue** for the research workspace.

Scouts are scheduled background agents that watch sources and propose papers. A Scout watches either a URL (a lab's publications page, a researcher's blog, a conference proceedings index, an RSS feed) or a literature API (Semantic Scholar, arXiv, OpenAlex, PubMed, Crossref). It has an optional filter — a topic, or a link to my open questions — and a cadence from daily to monthly.

**A proposal is a metadata card**, populated from the source itself with no model-generated summary: title, authors, publication date, venue, author-supplied keywords, the abstract as published, a link back, and its origin — which Scout found it and which question it matched. Fields that couldn't be extracted show as missing rather than guessed, so a blog post with no venue is still a valid card.

**The central constraint: I work in a popular field and expect high volume** — dozens to hundreds of proposals a week. The queue's entire job is to reduce what needs looking at and make each look fast. This is not an inbox to read; it's a sorting apparatus.

**Two lanes, assigned per proposal:**

- **Review** — applicable to my work. A queue: items sit until triaged, and accept/reject is meaningful.
- **Skim** — worth clocking, not necessarily a permanent addition. A feed: scrolling past is the whole interaction. Nothing requires clearing; items age out on their own.

The Scout sets a starting lane as a prior, and strong question-match promotes individual items up into Review. Review items skipped repeatedly demote back to Skim rather than accumulating as debt.

**Within Review:**

- Grouping by Scout, by matched question, or by topic cluster — one mental context at a time
- Ranking by author overlap with past accepts, venue history, question-match, and corroboration count across Scouts. Ranking is a default sort, never a filter; nothing is hidden.
- A reserved **"outside the usual" slot** per run: well-corroborated work from authors and venues I've never accepted from. Without it, ranking on my own history slowly narrows me into one corner of the field.
- Keyboard-driven triage: accept, reject, defer, next. Each card leads with why it's here.
- Bulk actions: reject a group, reject a Scout's whole run, bulk-defer
- Muting rules (author, venue, keyword) move items to a muted view rather than discarding them, so a rule that's quietly wrong can be caught

**Accepting creates a Source stub** — the bibliographic record and link, no file. I download the PDF myself later if it proves worth reading.

Show the Review lane at genuinely uncomfortable volume — 200+ pending — and show that it still feels tractable. Show the Skim feed and how it differs in weight and affordance. Show a single proposal card in full, and the keyboard triage flow.

This should not look like an email client. Triage here is closer to sorting a physical stack than to reading messages.

## Prompt 7 — Vault

The familiar surface. The design work here is restraint, not invention.

---

Design the **Vault** surface for the research workspace.

This is the ordinary note-taking view — the part that should feel like Obsidian, because familiarity is the feature. Markdown editing, bidirectional links, backlinks panel, tags, folders, full-text search, graph view.

**Deliberately unremarkable.** I already know how to use this. It should not be reinvented, and it should not try to be clever. If an Obsidian user can't sit down and work immediately, it's wrong.

**What's different, and it's small:**

- **Tags are slash-separated and parsed into a tree** — `ml/interpretability/probing`. The tag browser shows hierarchy, and selecting a parent includes its children.
- **Questions appear as linkable objects** alongside notes and sources. A note can link to a question the same way it links to a note, and backlinks show questions that point here.
- **Source stubs are visible as a distinct kind** — bibliographic records with no file attached. It should be obvious at a glance which sources I actually have PDFs for and which are just references, and attaching a PDF to a stub should be easy from here.
- **Annotation-level backlinks.** When viewing a source, I can see which notes and questions link to specific highlights within it, not just to the file.

Show the main editing view with the backlinks panel, the tag browser with hierarchy, and how a Source stub looks compared to a Source with an attached PDF.

For the graph view: keep it, because users expect it, but treat it as a secondary feature rather than a centerpiece. The app's real relational view lives on the Question Map dashboard, designed separately.

## Prompt 8 — Home

Run this last. It summarizes the other five, so it can only be designed once they exist.

---

Design the **Home** screen for the research workspace.

This is what I see when I open the app. Its job is to tell me the state of things and route me somewhere, then get out of the way.

**It shows:**

- **Review queue depth** — how many Scout proposals are waiting. Counted separately from Skim volume, which is a feed and has no depth.
- **Recent vault activity** — what's changed in the last few days, grouped by topic rather than as a flat file list
- **A few resurfaced questions** — a small rotating set of older open questions, dismissible. Not a to-do list; a prompt to remember what I was curious about.
- **Broken Scouts** — any Scout whose source has stopped parsing cleanly. This is the most important alert in the app: a Scout that silently stopped finding things looks exactly like a quiet field, so it has to be visible here.

**Deliberately light.** The three dashboards — Vault Overview, Scout Activity, Question Map — are full surfaces opened intentionally, not summarized here. Home is a landing, not a command center.

**The resurfaced questions are the hard part.** They must invite rather than nag. This is not "you have 47 unanswered questions" — it's closer to opening a notebook at a random page and finding something interesting. Tone matters more than mechanism here.

**Avoid the dashboard default.** No grid of metric cards, no sparkline wall, no progress rings. I open this app to work, not to review statistics about myself. If a number doesn't lead somewhere, it shouldn't be here.

Show Home in two states: a quiet morning with little pending, and a Monday after a week away with a full Review queue and a broken Scout. The second should communicate urgency about the Scout without making the queue depth feel like failure.

## Prompt 9 — Loose Ends

The easiest dashboard. Run it first to establish that a dashboard here is not a metrics grid.

---

Design the **Loose Ends** dashboard for the research workspace.

This is the maintenance surface: one place where everything incomplete or broken surfaces, so none of it has to be remembered. It should usually be short, and visiting it should take five minutes, not a review session.

**Four groups, in this order:**

1. **Broken plumbing** — Scouts whose source stopped parsing, Scouts with stale extraction, annotations that couldn't be re-matched on ingest. These worsen while ignored, so they're first. Unmatched annotations show their quoted text, current page context, and what linked to them, with three resolutions: relink, drop the links, or treat as new.
2. **Unfinished reading** — Source stubs with no PDF, PDFs attached but never annotated, papers accepted weeks ago with nothing attached since.
3. **Disconnected material** — orphan notes with no links in or out, stubs that never grew past a line, sources annotated but linked to nothing.
4. **Stalled questions** — Research Questions promoted but never given a source, working answers unchanged for months while sources kept arriving, hypotheses sitting inconclusive with criteria unresolved, experiments complete with artifacts but no observations, and linked heavyweight artifacts whose target has gone missing.

**The critical interactions:**

- Every row resolves in one click: attach, link, dismiss, or **mark deliberate**. The last matters most — an orphan note I *want* orphaned must be permanently dismissible, or this list fills with noise and I stop opening it.
- **Counts per group, never a total.** A single "47 loose ends" number turns maintenance into debt. This app never does that anywhere.
- Empty groups collapse. No cheerful zero states.

**This is not a metrics dashboard.** No growth charts, no activity feeds, no accumulation statistics, no progress rings. If a number doesn't name something I could fix right now, it doesn't belong. The visual model is closer to a well-organized punch list than to an analytics page.

Show it in two states: mostly clean with two or three items, and neglected after a month away with every group populated. The second must still feel tractable rather than shaming.

## Prompt 10 — Scout Activity

Operational. The one dashboard where conventional charting is appropriate.

---

Design the **Scout Activity** dashboard for the research workspace.

Scouts are scheduled background agents that watch sources — lab pages, blogs, proceedings indexes, literature APIs — and propose papers into a review queue. This dashboard answers one question: **are my agents earning their keep?**

**Per-Scout, the operational picture:**

- Last run, cadence, filter, and source health
- Candidates proposed over time
- **Accept rate over time, measured on Review-lane items only.** Skim items are never rejected, so they carry no signal. A Scout with a 10% accept rate has a bad brief — and I should be able to edit that brief directly from this screen, without navigating elsewhere.
- Cost and token spend, per-run rather than per-proposal, since proposals themselves are near-free

**Across all Scouts:**

- Review queue depth and age, counted separately from Skim volume
- **Coverage gaps:** open questions that no Scout is currently briefed on. This is the most actionable item on the screen — it names a specific thing I should go do.
- Source health at a glance, since a silently broken Scout looks exactly like a quiet field

**Design notes:** this is the one dashboard where conventional charting fits — accept rate over time is a real trend and a line is the right shape for it. But every Scout row must be directly actionable: edit the brief, change cadence, pause, drop. A screen I can only read is a failure here.

Show it with roughly a dozen Scouts of mixed quality — some productive, one clearly miscalibrated with a poor accept rate, one broken. The miscalibrated one should be obvious at a glance, and fixing it should be visibly one interaction away.

## Prompt 11 — Question Map

Run last. Expect to push back more than once; the pattern-matched answer here is actively wrong.

---

Design the **Question Map** dashboard for the research workspace.

This is a page with four panels, not a single visualization. Two panels use different data sources and must not be merged into one picture.

**Panel 1 — Coverage matrix.** Computed entirely from my own vault. Questions as rows, tags as columns, cell intensity showing how much material attaches. Both axes sorted by total weight, so structure emerges: densely-supported questions rise, empty rows are my backlog, empty columns are knowledge nothing points at. Four readings come out of one panel — well-supported questions, unanchored questions, unquestioned knowledge, and "clocked but unquestioned" (material I kept from the Skim feed with no question behind it, which is the best evidence of an interest I haven't articulated yet).

Edges are **explicit links only** — sources and annotations actually attached to a question. Inferred connections (shared tags, keyword overlap) are not shown as faint edges; they're offered as an **action**: *these six papers share tags with this unanchored question — link any?* Accepting creates a real edge. The same computation becomes a way to close the backlog instead of decoration.

Past roughly 40 questions the matrix stops being readable and falls back to ranked lists. Design both.

**Panel 2 — Attention scatter.** Uses external literature data, synced periodically, with an "as of" indicator. My tags positioned by **field growth rate** (publication volume acceleration, not raw citation count) against **my own coverage**. Point size is my paper count for that tag. Four labeled quadrants:

- High coverage, high attention — crowded area, expect competition
- High coverage, low attention — ahead of the field, or a backwater
- Low coverage, high attention — **blind spot.** The most actionable quadrant.
- Low coverage, low attention — obscure; opportunity or dead end

Tags are slash-separated and hierarchical (`ml/interpretability/probing`), so the scatter needs a **depth control** — mixing a parent and its children double-counts coverage and makes the quadrants meaningless. Tags with too few papers to be measured show as **unplaced**, visually distinct from low-attention, because those mean opposite things.

**Panels 3 and 4** — question flow over time (captured → promoted → answered or abandoned) as a funnel, and a ranked list of which sources and contexts generate the most questions.

**The most important instruction:** none of this is a force-directed graph. A node-and-edge hairball is Obsidian's graph-view failure mode — impressive to look at, useless to act on. Sorted matrix, labeled scatter, ranked lists. If the first pass returns something that looks like a network diagram, it's wrong.

Show the page at realistic scale — 60+ questions, 40+ tags — including the matrix's ranked-list fallback, and show the inferred-link review interaction.

## Running these

**Prompt 0 runs once.** It asks for real design work — navigation, typography, color, a wireframe. Running it repeatedly produces competing visual languages, which defeats the purpose. Follow it immediately with Prompt 1 in the same session, while the language is fresh.

**Try one session first.** The averaging risk comes from asking for six surfaces *in one prompt*, not from six prompts in one conversation. If Claude Design holds a long conversation coherently and each surface gets its own turn, a single session is simpler and skips the re-establishing problem entirely.

**Split only when you see the tell:** later surfaces coming back thinner than earlier ones. That's context degrading. When it happens, start a fresh session per surface.

**If you split, write a standing header first.** Not Prompt 0 verbatim — the *output* of Session 1: the palette, type choices, navigation structure, and density decisions that came back, in five or six lines, plus the object list and surface list from Prompt 0. That header opens every later session. This is the piece these prompts can't supply in advance.

**The three dashboards are Prompts 9–11,** run after the eight surfaces. Loose Ends first, because it is the easiest and it establishes that a dashboard here is a punch list rather than a metrics grid. Question Map last: it needs the most established design language and the most pushback. Consider giving it a fresh session of its own — it is placed last because it needs established context, but last is also where a long session's context is thinnest, and it is the prompt most likely to come back generic.

**What to push back on, by surface:**

| Surface | Likely drift | Correction |
| --- | --- | --- |
| Question Inbox | Becomes a to-do list with counts and overdue states | Age is neutral. No badges, no red. |
| Reader | Chrome competes with the text | Reading comfort first; connections recede until wanted |
| Research Question view | Becomes a generic document editor | The for/against split is structural, not a tag. History reads as narrative, not a diff log. |
| Hypothesis view | State becomes a status dropdown | State is derived from criteria. Falsified looks as solid as supported. |
| Experiment view | Artifacts filed as attachment chips | Plots and screenshots are the record. Show them inline, large. |
| Scout Queue | Becomes an email client | Sorting a stack, not reading messages. Show it at 200+ items. |
| Vault | Gets reinvented | Familiarity is the feature. Restraint. |
| Home | Becomes a metrics dashboard | No grid of cards. Every number leads somewhere. |
| Loose Ends | Gains a total count and starts feeling like debt | Counts per group only. Mark-deliberate must be prominent. |
| Scout Activity | Read-only charts | Every Scout row edits its brief in place |
| Question Map | Comes back as a force-directed graph | Sorted matrix, labeled scatter, ranked lists. Reject hairballs. |

**Still unspecified:** the Hypothesis and Experiment lifecycle (Part 2). The promotion button appears in the Question Inbox prompt, but its destination doesn't exist yet.
