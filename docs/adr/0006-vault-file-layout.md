# 0006: Vault file layout — one Markdown file per object, kind in frontmatter, app state in `.vitrine/`

**Status:** Accepted

ADR 0005 left the vault file layout as the first open item in `docs/architecture.md`; ADR 0002 left the annotation sidecar's format and location to it. This ADR settles both after a `grill-with-docs` pass. The shape: every Question, Research Question, Hypothesis, Experiment, Source, and Source stub is one Markdown file whose Kind is declared in YAML frontmatter, written by default into a folder per Kind but never identified by its path. Machine-owned fields are flat frontmatter keys; prose lives in the body under fixed `##` headings; links are Obsidian wikilinks. Everything the app knows that is not vault content — the annotation identity index, Scouts, the Proposal queue, the Lexicon, dismissals — is App state in `.vitrine/` at the vault root, beside the vault but never in the sync scope. The exact folder tree, frontmatter keys, and section names are in `docs/architecture.md` § Vault layout; this ADR records the decisions and why.

## Decisions

1. **Kind from frontmatter, folders as a default.** The app writes new objects into `questions/`, `hypotheses/`, `experiments/`, `sources/`, `notes/`, but reads Kind from `kind:`. Moving a file never changes what it is (`design-brief.md` § Platforms and constraints: the app is not the only way in).
2. **Frontmatter for fields, body for prose, never the reverse.** Flat keys only: Obsidian's Properties panel edits flat keys and shows nested maps as an uneditable blob. The one exception is inside a Hypothesis's `## Criteria`, where `relationship::` and `outcome::` are Dataview-style inline fields under a `###` per criterion, because a criterion is a sentence and Evidence attaches to it by block ID. Those two are the only body key-values the app ever parses.
3. **File name for people, `id:` for the machine.** Wikilinks use file names so they read in Obsidian; the app's own references (sidecar, history, Scouts, dismissals) use a 10-character base32 `id` in frontmatter that survives renames and app-closed edits. A Question's file name is its text with Obsidian-forbidden characters stripped, truncated at 80 characters on a word boundary; the exact text is in `question:`.
4. **Promotion creates a new file.** The Question keeps its record (`status: promoted`, `promoted_to:`), the promoted object gets a copy of the Provenance and `promoted_from:`. A Research Question that sharpens into a Hypothesis does the same. The brief's write-back from a resolved Hypothesis ("a real answer: no", § Closing the loop) needs the chain to exist as links.
5. **Position history lives in the file**, in `## Position history`, newest first, every Revision holding the full previous text; edits to one field within 30 minutes coalesce into one Revision, closed early when a why is attached or a Criterion is edited after Evidence exists. That last marker is written permanently at edit time — the only derived judgement the app writes into a file — because the brief says it must stay conspicuous (§ The falsification commitment). Derived Hypothesis state is never written; an override to supported is a Revision with a mandatory why, voided by any later Criterion change, and has no frontmatter key so nothing resembles a status dropdown.
6. **Annotations are blocks in the Source note.** On every Ingest the app rewrites an app-owned `## Annotations` section — one block per Annotation, `^h<n>` per Source — so `[[citekey#^h12]]` resolves in Obsidian with the quoted text on hover and annotation-level backlinks work outside the app. The block ID is the annotation identity ADR 0002 asked for; the sidecar at `.vitrine/annotations/<source-id>.json` holds page, rectangle, quote, and the PDF object fingerprint re-matching keys on. An Unmatched annotation's block stays, marked; *drop the links* leaves a tombstone block rather than editing the user's notes.
7. **PDFs in `sources/pdf/`, the only synced folder.** Source notes stay in `sources/` outside the sync scope (ADR 0003). A Source stub is a Source note with no `pdf:`; attaching a PDF sets one key, so links never change. Citekeys are `<surname><year>`, ASCII-folded, with `a`/`b` suffixes on collision.
8. **Folder per Experiment**, note inside, small Artifacts beside it as embeds; heavyweight Artifacts as a list line with path, size, date, description. Moving or deleting the folder moves or deletes the record.
9. **Scouts are App state**, `.vitrine/scouts/<id>.yaml`, structured fields only. A Scout carries no prose a model reads: the one model call in the pipeline is extraction from watched pages (§ Proposals), and turning a Question into a query is deterministic through its Tags' Lexicon or a hand-written Query. A file with no prose has no business in the Vault surface. Proposals never touch the vault; acceptance writes a Source stub with its Origin.
10. **`.vitrine/` is files plus two SQLite databases.** Files for what a person reads or repairs by hand (Scouts, annotation index, Lexicon, dismissals, `vault.json` with the vault id and one schema version). `queue.sqlite` for Proposals, runs, and triage events — not re-derivable. `index.sqlite` for the vault index and full-text search — always safe to delete.
11. **Surgical writes.** The app rewrites only the frontmatter block (preserving key order, appending new keys) and the sections it owns; every other byte of a file the user edited stays identical. The app never adds frontmatter to a Note; dismissals for Notes are keyed by path and re-keyed on observed renames.

## Considered options

- **Flat vault, no kind folders.** Rejected as the default: the Vault surface and Finder need a sensible listing on day one. Kept as a permitted state by decision 1.
- **ID in the file name** (`q-7f3k2m.md`). Rejected: wikilinks become unreadable, which is the drift the Vault prompt says to defend against.
- **Promotion mutates the file in place.** Rejected: a Research Question that becomes a Hypothesis would lose its page, and the Question's `promoted` Status would have nothing to point at.
- **Position history in a sidecar, or as git commits.** Rejected: the history is "the app's real subject" (§ Position history) and must be readable without the app; git attaches a why to a commit, not a Position, and Obsidian edits arrive as blobs.
- **Prefix or diff instead of full previous text.** Rejected: the brief's floor is "what it changed from"; diffs are illegible as narrative. If a page's history ever dominates the file, Revisions older than a threshold move to `.vitrine/history/<id>.md` with a pointer — a per-file, reversible move, not a format change.
- **Scouts as vault Markdown** (`scouts/<name>.md`, filter as wikilinks). Rejected once it was clear a Scout has no prose: it is config wearing a note's clothes, the "open questions" filter is a rule not a link, and deleting the file from Finder strands its run history.
- **Annotations only in the sidecar.** Rejected: annotation links would resolve in exactly one app.
- **Re-serialise whole files from the model.** Rejected: it makes the app the only editor that gets its way.
- **`~/Library/Application Support` for app state.** Rejected for anything about the vault: the annotation index must move with the vault or every link rots on a new machine. Window state and the session token live there; credentials in the Keychain.

## Consequences

- **+** The vault reads correctly in Obsidian: wikilinks resolve, annotation links show their quote, criteria are addressable blocks, Properties are editable, Dataview can query criteria.
- **+** Every app-internal reference is by `id`, so renames and app-closed edits cannot rot the sidecar, Scouts, or dismissals.
- **−** The Markdown parser (open item) must be a round-tripper, not parse-and-dump. This is a hard requirement it inherits from decision 11.
- **−** The file watcher (open item) inherits three requirements: recognise the app's own writes by content hash so the `## Annotations` rewrite does not echo as a change; treat an iCloud-evicted or Dropbox online-only PDF as unreadable-not-changed, with the Reader materialising on demand — at a few hundred PDFs nobody hits this, at a few thousand it is routine; use FSEvents, not polling, over a vault that will reach tens of thousands of files.
- **−** Stored Artifacts are the vault's only byte-size growth vector. The brief's open threshold ("how large is small?") is the lever and wants a number early; the per-Experiment folder is what makes pruning one record a single delete.
- A `schema` number in `.vitrine/vault.json` versions this whole layout; a key rename ships as one migration keyed on it, never as per-file version handling.

## Update (2026-09-19)

ADR 0007 settled what the sidecar in decision 6 holds: quads and the engine-extracted quote per annotation, raw, and one fingerprint per *document* (trailer `/ID`, page count, per-page text hashes) rather than per PDF object. The field list is `docs/architecture.md` § Annotation identity.

## Update (2026-09-19, ADR 0008)

Decision 11's surgical writes are now a closed set of seven operations (`docs/architecture.md` § Markdown), applied by locate-and-splice. One assumption in decision 2 is still to be confirmed by the fixture corpus: that Obsidian resolves `[[hypothesis#^c1]]` when `^c1` sits on the `###` heading line. If it does not, the id moves to the line below the heading and this ADR gets a further update.

## Update (2026-09-19, ADR 0013)

The file watcher's three inherited requirements are settled: own writes are recognised by a per-file `{ size, mtime, hash }` record (in the sidecar for PDFs, in `index.sqlite` for Markdown), evicted PDFs are detected by `blocks === 0` and never read, and the mechanism is `fs.watch` on FSEvents with a stat-only sweep as the safety net. Decision 5's coalescing window now also governs when a Position edited in Obsidian is spliced into the file, from a pending Revision held in `queue.sqlite`; decision 10's charter for that database widens to "app events that are not re-derivable" — Ingest runs, conflict copies, pending Revisions join Proposals and Scout runs. Decision 11's re-keying of Note dismissals on rename is done by pairing content hashes within one watcher batch.
