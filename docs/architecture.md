# Architecture

Technical decisions the brief structurally couldn't hold: library choices, file formats, how ingestion triggers. Living; edited as work proceeds. A decision that is hard to reverse also gets an ADR in `docs/adr/`, and this file points at it.

## Decided

- Web technology, one codebase, packaged per device — ADR 0001.
- Annotations in the PDF; sidecar index for identity — ADR 0002.
- Phase 1 reading is Preview plus ingest; sync scope is the PDF folder only — ADR 0003.
- The public site at tacomancy.com is static files in `website/`, assembled by `Scripts/build-site.sh` and deployed by `.github/workflows/pages.yml` on push to `main` — ADR 0004. The root is the studio; Vitrine lives at `/vitrine/` with its gallery, the skills repository at `/skills/` — ADR 0011.
- TypeScript end to end; Electron; React; the core is a local HTTP API the renderer and the iPad PWA are both clients of; a pnpm workspace of `packages/core`, `packages/renderer`, `packages/shell` — ADR 0005 (plus `packages/markdown`, ADR 0008). The detail that ADR leaves to this file:
  - **Build and dev:** Vite for the renderer, `electron-vite` driving main, preload, and renderer from one config — `packages/shell/electron.vite.config.ts`, with the renderer's root pointed at `packages/renderer` and output under `packages/shell/out/`. The core builds separately (`tsc` to `packages/core/dist`), because the shell spawns its entry as a file and must not bundle it. `pnpm dev` builds the core, then starts electron-vite; in development the window loads the Vite dev server for HMR, otherwise the core serves the bundle. Packaging, signing, and updates are chosen when there is something worth installing.
  - **Tests:** Vitest, for `core` and `renderer` alike. `pnpm test` at the root runs three projects from `vitest.config.ts` — `core` (node), `renderer` (jsdom, Testing Library, a fake tRPC link), `tooling` (the lint rules) — and the `test` job in `.github/workflows/ci.yml` runs lint, typecheck, and that suite as the second required check beside `guidance`. The core is exercised in-process with `app.request(...)`, no socket. The end-to-end runner is chosen by the first slice that has a window to drive; until then `VITRINE_SNAPSHOT=<png>` makes the shell render its window hidden, capture it, and quit, so a change can be seen without a window appearing; `VITRINE_SNAPSHOT_AFTER=<ms>` holds the capture long enough for a script on `--remote-debugging-port` to drive the page first (keys, typing, computed styles over CDP). `Scripts/run-hidden.mjs` wraps all of that; `docs/agents/run.md` is the procedure.
  - **RPC:** tRPC; the router type in `core` is the contract, imported type-only by `renderer`. Pushes the brief needs (ingest landed, Scout finished, Unmatched annotation surfaced) are tRPC subscriptions over SSE, so no WebSocket server. Server state in the renderer goes through tRPC's TanStack Query integration; UI state is React local state; no global store until a second surface needs one. The one piece of UI state that crosses components — the Question the capture line just wrote — is held by the window component and handed to the surface on screen, which invalidates `questions.list`, selects the row, and takes the keyboard (ADR 0010).
  - **HTTP server:** Hono, hosting the tRPC adapter, the renderer bundle for the iPad, and PDF bytes for the Reader. Handlers are testable with a `Request` and no socket. The core binds `127.0.0.1` on an OS-assigned port and mints a session token at start; `/trpc/*` requires it as a bearer header and answers 401 before any router code otherwise. The bundle at `/` is served without the token — a navigation cannot carry a header, and the bundle is public code, not vault data. The core sets the bundle's CSP (`default-src 'self'; img-src 'self' data:`) as a response header rather than a meta tag, so the same `index.html` works under the Vite dev server. CORS on `/trpc` is open because the token, not the origin, is the auth.
  - **Shell ↔ core ↔ renderer:** the shell reads port and token from the core's `ready` message over the `utilityProcess` channel and answers the preload's single synchronous IPC (`vitrine:session`) with them; the token never travels in `argv` or a URL. The preload exposes exactly `window.vitrine = { port, token }`. The same channel carries the Host (`CONTEXT.md`): the core sends `pickFolder` with an id, the shell shows `dialog.showOpenDialog` restricted to directories and replies `pickedFolder` with the path or null. `File ▸ Open Vault…` calls `vault.pick` on the core as one more HTTP client; since the renderer has no push channel yet, a vault opened from the menu is shown by reloading the window — a vault switch discards every piece of window state regardless. Pushes to the renderer (ingest landed, Scout finished, a vault switched) are the SSE subscriptions above, whose auth over `EventSource` is still to be decided.
  - **Styling:** plain CSS with CSS Modules per component, importing `docs/reference/branding/tokens.css` unchanged. Not Tailwind: BRAND.md law 1 (semantic tokens, never ramp steps) is a lint rule on `--color-<ramp>-*` outside `tokens.css` — `tooling/eslint-plugin-brand`, on CSS ASTs via `@eslint/css` and on string literals in TS/TSX for inline styles, with its own RuleTester suite. `tokens.css` names no serif family; the renderer defines `--font-serif` in `global.css`.
  - **Fonts:** bundled via `@fontsource` — Inter, IBM Plex Mono, Josefin Sans for the wordmark, and Source Serif 4 for questions and quotations, the role the prototypes drew and ADR 0004 asked this decision to settle. Nothing loads from Google Fonts in the app.
  - **Lint and format:** ESLint (typescript-eslint, type-aware) and Prettier, as the vendored `setup-pre-commit` expects — `pnpm lint`, `pnpm format`, `.prettierrc` per that skill; Prettier covers code only, prose and the frozen tier are ignored. dependency-cruiser via `setup-ts-deep-modules` now that the packages exist.
  - **Compiler:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`, in `tsconfig.base.json` which every package extends. TypeScript stays on the 5.x line until typescript-eslint supports 6/7. Node is whatever the current Electron ships.
  - **Core lifetime:** the app's. No `launchd` agent unless daily Scouts prove they want one.
- One Markdown file per object, Kind in frontmatter, App state in `.vitrine/` — ADR 0006. The concrete layout is § Vault layout below.
- PDFium via WebAssembly in the core is the only thing that reads or writes a PDF; PDF.js in the renderer only draws pages; annotation identity is re-matched text first, geometry second, in five tiers — ADR 0007 (Proposed until `prototype/pdf-roundtrip`, #108, passes). The detail that ADR leaves to this file:
  - **Core engine:** `@embedpdf/pdfium` raw bindings (not `@embedpdf/engines`), in one `worker_thread` behind a job queue; one worker, not a pool. Appearance streams via its `EPDFAnnot_GenerateAppearance`, regenerated after every edit. Saves are incremental (`FPDF_SaveAsCopy` with flag `1`) to a temp file, then renamed; a full save only when the file's existing structure forces it (an encrypted or already-damaged file). Growth per write is measured by the prototype and recorded here.
  - **Renderer:** `pdfjs-dist` directly behind one component — canvas, text layer, Vitrine overlay. The engine's own rendering of text-markup and note annotations is suppressed; the overlay draws them from the core's index. Ink and shapes render from the PDF untouched.
  - **Annotation intent** (renderer → core): page index, geometry in PDF user space, kind, colour, note text. The core snaps geometry to its character boxes, derives the quote, writes the object, assigns the id. Selection text from the renderer is never stored.
  - **Written into the PDF:** `/NM` = sidecar id, `/T` = the user's name, `/CreationDate`, `/M`, `/AP`, standard `/Subj`.
  - The sidecar's fields and the matching tiers are § Annotation identity below.
- Markdown is located and spliced, never re-serialised; a closed set of write operations; Obsidian's grammar in a fourth workspace package, `packages/markdown`, shared by core and renderer; tag identity case-insensitive — ADR 0008. The detail that ADR leaves to this file:
  - **Locator:** `mdast-util-from-markdown` (micromark) with GFM and four extensions of our own — tags, wikilinks, block ids, `key:: value` inline fields — all in `packages/markdown`. Offsets are UTF-16 code units into the source string, which is what `String.prototype.slice` takes. `remark-stringify` is not a dependency.
  - **Frontmatter:** `yaml` (eemeli), `parseDocument` → `set` → `toString`. Known renormalisations: 4-space indent to 2, `[a, b]` to `[ a, b ]`. The fence is `---` at byte 0 (after a BOM if any), closed by `---`; a file whose frontmatter does not parse is *unreadable* for Kind purposes and the app never writes to it.
  - **Package rule** (dependency-cruiser, once `setup-ts-deep-modules` runs): `core` and `renderer` may import `packages/markdown`; it imports neither, and no Node built-in. It builds with `tsc` like the core, because the core imports it at runtime from `dist`, and joins `vitest.config.ts` as a fourth project.
  - **Writes:** § Markdown below — the seven operations, the re-apply, the verify step, and the file-level rules (temp file and rename; EOL, BOM, and trailing newline preserved; new files UTF-8, LF, one trailing newline).
- A `kind: question` file is read as found: frontmatter only, a missing `status` is open, a missing `question` or `captured` is Partial, a wrong value is Unreadable with its reason — ADR 0009.

## Vault layout

The shape ADR 0006 decided, in enough detail to write against. Conventions that hold everywhere: timestamps are ISO 8601 with local offset; links are wikilinks; app-owned fields are flat frontmatter keys; the app reads `tags:` and inline `#tag` but writes only `tags:`; `status: abandoned` keeps the file, and app-initiated deletes go to the macOS Trash. Every app-owned object carries `id:` (10 chars of base32, 50 random bits) and `kind:`.

```
<vault>/
  questions/     Question and Research Question notes
  hypotheses/    Hypothesis notes
  experiments/   one folder per Experiment: <name>/<name>.md plus stored Artifacts
  sources/       Source and Source stub notes, <citekey>.md
  sources/pdf/   the PDFs, <citekey>.pdf — the ONE synced folder (symlink to iCloud/Dropbox)
  notes/         Notes the app creates on request; the user keeps Notes anywhere
  .vitrine/      App state — see below
```

**Question** — `questions/<text, forbidden chars stripped, ≤80 chars>.md`: `* " \ / < > : | ?` and `# ^ [ ]` removed, whitespace collapsed, leading dots removed (a dot-entry is skipped on open), cut at 80 characters on a word boundary; the `id` when nothing survives; ` (2)`, ` (3)`, … on collision. Frontmatter: `id`, `kind: question`, `question` (exact text), `status` (open | promoted | answered | abandoned), `captured`, Provenance as four flat keys — `from` (a wikilink, or free text when `context: other`), `page`, `annotation` (block id, Sources only), `context` (reading | writing | ingest | resolving | other) — plus `tags`, `related` (wikilinks added by the Link action; the only links Coverage counts on a Question), `promoted_to`, `answered`. `question:` is always double-quoted on write — deciding when a plain scalar is safe means carrying YAML's rules, and one wrong call makes a Question unreadable. Body: free; the answer when answered. Write-back from a resolved Hypothesis sets `status: answered`, `answered`, and appends one line — `Answered by [[hypothesis]] — falsified, <date>` — to the Question and to any intermediate Research Question.

**Research Question** — same folder, file name suffixed ` (RQ)`, `kind: research-question`, `promoted_from`, Provenance keys copied not re-derived. Body headings, in order: `## Working answer`, `## Supporting sources`, `## Opposing sources`, `## Related questions`, `## Open threads`, `## Position history`. A source line is `- [[citekey#^h12]] — why it is here`.

**Hypothesis** — `hypotheses/<claim, forbidden chars stripped>.md`, `kind: hypothesis`. Body: `## Claim`, `## Criteria`, `## Design notes`, `## Position history`. Each criterion is `### <criterion text> ^c<n>`, then `relationship:: confirming | falsifying | diagnostic`, `outcome:: met | not met | inconclusive`, then Evidence lines `- [[experiment]] — what it shows for this criterion`. Derived state is never written. An override to supported is a `## Position history` entry with a mandatory `why:`; any later change to a criterion voids it, recorded as its own entry.

**Experiment** — `experiments/<name>/<name>.md`, `kind: experiment`, `status` (planned | running | complete | abandoned, hand-maintained), `ran_at` (list of links out), `tags`. Body: `## Purpose`, `## Design`, `## Artifacts`, `## Observations`, `## Position history`. Stored Artifacts are embeds (`![[plot.png]]`) in the same folder; linked heavyweights are `- <file> — <path or URL> · <size> · <date> — <description>`. Evidence attachments are recorded on the Hypothesis side only; the Experiment page shows them via backlinks.

**Source / Source stub** — `sources/<citekey>.md`, `kind: source | source-stub`. Frontmatter: `citekey` (`<surname><year>`, ASCII-folded, lowercase, `a`/`b`… on collision; first word of the title when authors are missing), `title`, `authors`, `year`, `venue`, `doi`, `url`, `keywords` (author-supplied; feeds the Lexicon), `pdf` (file name under `sources/pdf/`; absent on a stub), `origin_scout` (Scout id), `origin_question`, `origin_retroactive`, `appearances` (every URL Corroboration merged). Body: the user's notes, then an app-owned `## Annotations` section rewritten whole on every Ingest — one block per Annotation in page order, `- p.<n> · "<quote>" ^h<n>` with the note text on the next line; ids are `h` + a per-Source counter, never reused. Unmatched blocks stay, marked `(unmatched)` until resolved; *drop the links* marks the block `(gone)` and leaves it forever rather than editing the user's notes. A Removed annotation's block (ADR 0007: unlinked, and gone from the file) is deleted; its number is never reused. Ink and shape annotations have no block.

**Position history**, in every kind that has one — newest first, each entry `- <timestamp> · <field>` with optional `why:` and `from:` holding the full previous text. Edits to one field within 30 minutes coalesce; a why or a criterion edit after Evidence exists closes the entry early, and the latter is written as `· edited after evidence` permanently. Edits made in Obsidian are detected by the watcher and recorded the same way. Pressure valve if a page's history ever dominates it: entries older than a threshold move to `.vitrine/history/<id>.md` with a one-line pointer.

**`.vitrine/`**
```
vault.json                  { id, schema, created } — one schema number for this whole layout
scouts/<id>.yaml            id, name, source {kind, api | url}, filter {questions: [ids], tags, query},
                            cadence, cap, lane, paused, created. Runtime never lives here.
annotations/<source-id>.json  the annotation identity index — § Annotation identity
lexicon.json                per-Tag keyword weights from accept history; manual seeds
dismissals.json             mark-deliberate and declined inferred links, keyed by id, or by path for Notes
queue.sqlite                Proposals, Scout runs and health, triage events — NOT re-derivable
index.sqlite                vault index and full-text search — always safe to delete
```
Window state, the session token, and the last vault opened (`last-vault.json`, `{ path }`, written only on a successful open) live in `~/Library/Application Support/Vitrine/`; the core owns that folder and tests pass a temp one at construction. Credentials in the Keychain.

**Write discipline.** Every write the app makes is one of the seven operations in § Markdown, spliced into the file so that no byte outside the operation's target changes; the Vault editor's whole-file save is the one exception, and it is the user's own typing. It never adds frontmatter to a Note.

## Annotation identity

The shape ADR 0007 decided. The sidecar stores **raw** values; every rule below that compares them is code, so tuning never migrates a Source.

**`.vitrine/annotations/<source-id>.json`**
```
pdf                       file name under sources/pdf/
document_fingerprint      { id: trailer /ID[0], pages, page_text_hashes[] } — a change is a document-changed event
reading_position
next_block                the per-Source ^h counter; never reused, not even after removal
annotations[]
  id                      what /NM carries when Vitrine wrote the object
  block                   h<n>
  kind                    highlight | underline | strikeout | squiggly | text | freetext | ink | shape (Square, Circle, Line, Polygon, PolyLine)
  page                    0-based index
  quads[]                 8 numbers each, PDF user space, as written (Preview's verbatim; Vitrine's snapped)
  quote                   engine-extracted text under the quads; for text/freetext the /Contents; empty on ink, shape, and image-only pages
  note                    /Contents on markup kinds
  color                   the PDF's /C verbatim
  previous_quote, changed_at   one level only, set by a geometry-tier match
  matched_by              object | text | text-moved | geometry — how the last Ingest found it
  last_matched
  removed_at              set when an unlinked identity failed every tier; the entry stays so the block is never reused
  unmatched_since         set when a linked identity failed every tier; cleared by relink / drop / treat-as-new
  gone_at                 set by *drop the links*: the Tombstone. The entry is skipped by every later Ingest, its block stays `(gone)`, and its links keep resolving
```

**Kinds and what they get.** Markup and notes: identity, a `^h<n>` block, link target, `Q:` carrier. Ink and shape: identity and a count on Ingest; no block, never a link target or `Q:` source. Kind *families* for matching: markup (the four text-markup kinds), note (text, freetext), ink, shape.

**Normalisation** (code, applied at compare time to both sides): Unicode NFKC; join a hyphen at a line end to the next line's first word; collapse whitespace; case-fold. Ligatures fall out of NFKC.

**The tiers, in order, per previously known identity against the annotations now in the file:**

1. **object** — an annotation carrying our `/NM`, same kind family. Wins only if its normalised quote equals ours; otherwise fall through. PDFKit drops `/NM`, so this fires for Reader-only Sources.
2. **text** — same page, same kind family, normalised quote equal.
3. **text-moved** — any page, same kind family, normalised quote equal; page updated. Normally only reached after a document-changed event.
4. **geometry** — same page, same kind family, quad overlap (IoU over the union bounding boxes) ≥ **0.6** — a starting number, tuned by the prototype. A match here with a different quote records `previous_quote`.
5. **Unmatched** if the identity has inbound links (a backlink to `[[citekey#^h<n>]]` in `index.sqlite`, or a Question whose `annotation:` names it); **removed** otherwise. Because `index.sqlite` is disposable (ADR 0006), *removed* is concluded only against an index known to be current for this vault — Ingest refreshes it before this tier runs — and an identity whose links cannot be established is Unmatched, never removed. The cheap failure is a decision; the expensive one is silent link rot (`design-brief.md` § Annotation storage).

At any of tiers 2–4, several candidates are broken by quad overlap — the highest wins, comparing quads across pages as if on one page at tier 3 — and an unbroken tie is Unmatched. Each candidate can be claimed once; two identities claiming one candidate are both Unmatched, linked or not: ambiguity is a decision, so this is the one way an unlinked identity reaches the panel. Tombstones (`gone_at`) take no part in matching. Annotations left unclaimed are **new**: a fresh id and block, and a Question if the note begins `Q:`. A changed `document_fingerprint` runs the same tiers document-wide and groups every resulting Unmatched row under one event with batch resolutions.

**Ingest summary line:** `N new · N questions · N removed · N could not be re-matched` — the panel opens only when the last is non-zero (brief § Ingest review).

## Markdown

The shape ADR 0008 decided, in enough detail to write against.

**What the locator returns for one file** — an *outline*: the frontmatter range and its parsed Document; headings (level, text, range of the heading line, range of the section body to the next heading of equal or higher level); block ids (id, the block's range); wikilinks and Markdown links (target, heading path, block id, alias, embed flag, range); tags (canonical form, form as written, source `frontmatter | inline`, range); inline fields (key, value, range, and the `###` they sit under); list items with ranges, from which the core's Position history module reads Revisions. Everything Vitrine-specific — which sections are owned, what `^c<n>` means, the Revision line grammar — is applied by the core's per-Kind modules to this structure.

**Write operations** — the closed set. Anything else reopens ADR 0008.

```
setFrontmatter(keys)                    one or more keys; order preserved; new keys appended; never removes
setInlineField(blockId, key, value)     outcome:: / relationship:: under a ### … ^c<n>; the value range only
replaceSection(name, body)              an owned section whole: ## Annotations; ## Position history for the pressure valve
prependEntry(section, entry)            a Revision into ## Position history, newest first
appendToSection(target, line)           a line at the end of a ## section or a ### block: Evidence under ^c<n>,
                                        an Artifact line, a source line; `lead` = the body before the first ##,
                                        which is where the write-back line goes (end of file on a Question)
replaceFile(content, basedOn)           the Vault editor's save, and nothing else; the user's own typing
createFile(path, content)               a new object or an app-created Note, written whole
```

A write = `{ operations[], basedOn: <content hash> }`. Before writing: re-hash; on mismatch re-read and re-apply the operations to the new content; splice from the highest offset down (targets never overlap); re-parse the result and verify — frontmatter parses, `kind` unchanged, each owned section present exactly once, block ids the app depends on present; write temp + rename. Re-apply impossible or verification failed → not written, surfaced with the reason. `replaceFile` skips the re-apply (there is nothing to re-apply) and refuses on a hash mismatch, which the editor surfaces as "changed on disk". Notes are written only by the editor, whole.

**Owned sections:** `## <name>` exact, case-sensitive, level 2. Absent → appended after a blank line at end of file. Duplicated → the first is owned, the second untouched, the duplicate surfaced as a shape problem.

**Shape problems:** a `kind:` file missing structure its Kind expects (no `## Criteria`, a `###` criterion without `^c<n>`, a duplicated owned section) is reported in the same channel as *partial* and *unreadable* (#105) and derived state is computed from what parses.

**Tag grammar** (Obsidian's, `help.obsidian.md/tags`): after `#`, letters, digits, `_`, `-`, `/`, and other commonly accepted Unicode including emoji; no spaces; at least one non-digit. Not a tag inside code fences or code spans, inside a link target, or in a text property. Canonical form: NFC, then `toLowerCase()`; `_` ≠ `-`. Display: majority casing per path segment; the app writes the display casing, a new tag as typed. Frontmatter: `tags:` as a YAML list is canonical; the legacy comma-separated string is read, and converted to a block sequence the first time the app adds a tag to that file, as Obsidian's Format Converter does; `tag:` is neither read nor written — Obsidian 1.9 dropped it, and a vault that still has one is a Format Converter job, not the app's. Invalid entries are indexed as `invalid` with position, never silently dropped. Undocumented by Obsidian and settled by the fixture corpus (#112): `#tag/`, `#a//b`, a `#` after `# ` at line start, in a URL, in an autolink, in a `tags:` entry containing a space; how `#Heading` link fragments match; what the Properties editor does to comments and key order.

**Link grammar** (`help.obsidian.md/links`): `[[target]]`, `[[target|alias]]`, `[[target#Heading]]`, `[[target#H1#H2]]`, `[[target#^blockid]]`, `[[#Heading]]`, `![[embed]]` with `|WxH` and `#page=N`; `[text](target.md)` and `[text](target.md#Heading)` with `%20` decoding. Block ids: Latin letters, digits, dashes. Invalid in a target: `# | ^ : %% [[ ]]`. Resolution: a target with `/` by vault-relative path; otherwise by basename, case-insensitive, unique → resolved; several → *ambiguous* (resolves to nothing; a Loose Ends row under Disconnected material offering the path-qualified rewrite); none → *unresolved*. `#^id` matches a block id in that file; how `#Heading` matches heading text (case, trimming) is a corpus item.

**Block ids:** every `^id` in the vault is indexed, app-written or not. The app never rewrites or moves a user's. The per-Source `h` counter starts above the highest `^h<digits>` present.

**Divergences from Obsidian, by design:** display casing (majority per segment, not first-created); ambiguous links resolve to nothing rather than to a best match; invalid tags are recorded rather than ignored.

## Open, in the order they block work

1. How ingest is triggered (file watcher) and coalesced. Inherits from ADR 0006: recognise the app's own writes by content hash (the `## Annotations` rewrite must not echo as a change); treat an iCloud-evicted or Dropbox online-only PDF as unreadable-not-changed, with the Reader materialising on demand; FSEvents, not polling. Inherits from ADR 0007: a write landing while the iPad holds the file open, and whether a note edited to begin with `Q:` after the fact becomes a Question on that Ingest.
2. The Artifact size threshold (brief § Open questions). The only byte-size growth vector in the vault; wants a number after seeing real artifacts.

Each goes through `grill-me` before its ADR is written.
