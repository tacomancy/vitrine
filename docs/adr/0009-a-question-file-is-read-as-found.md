# 0009: A Question file is read as found — frontmatter only, missing keys are gaps, wrong values are faults

**Status:** Accepted

ADR 0006 says a file is a Question because its frontmatter says so, and that the app is not the only editor of the vault. The Question Inbox (#105, spec #102) is the first code to read such files, and it meets ones Vitrine did not write: Obsidian's Properties panel, a hand-written file, an older export. `CLAUDE.md` § Invariants forbids a silent failure, so every one of those must land somewhere the user can see. This ADR records how a `kind: question` file is read and what each shortfall becomes.

## Decisions

1. **Frontmatter only.** The file is read up to its closing `---` fence (at byte 0, after a BOM if any — ADR 0008's fence rule) and no further; the body is never loaded. This is a reader, not the locator ADR 0008 puts in `packages/markdown`: when that package lands it finds the fence, and the rules below are what the Inbox does with what it finds. No file is rewritten.
2. **A missing `status` is `open`.** A Question that was never triaged is open, so a file with no `status:` is listed as one. Nothing is written back; the key stays absent until a triage action sets it.
3. **A missing `context` is `other`.** No context recorded means nothing was open when the Question was made: time and place are the whole Provenance, which is what *Unattached* (`CONTEXT.md`) says. Every other Provenance key (`from`, `page`, `annotation`) is optional and passed through as present.
4. **A missing `question` or `captured` makes the file Partial.** It is listed by file name and modification time and marked, because without those two keys there is no row to draw. Partial is a gap, not a fault: the file is well-formed as far as it goes.
5. **A wrong value makes the file Unreadable.** A `captured` that is not a date, or a `status` outside *open · promoted · answered · abandoned*, is a fault to report with its reason, beside a file that cannot be opened or whose frontmatter does not parse. Treating it as Partial would label it "question or captured missing", which is untrue; dropping it is forbidden.
6. **Nothing is counted as owed.** Partial and Unreadable files are listed and counted where they sit; the Inbox's one number counts Questions that exist.

**Update 2026-09-21 (#185).** Decision 1's reader is superseded by ADR 0014: the Inbox is a query over `index.sqlite`, and the index outlines the whole file once, at open or on change, rather than each list reading to the closing fence. Decisions 2–6 hold unchanged — they are applied by the indexer when it meets a `kind: question` file (`packages/core/src/question-kind.ts`), and the Partial and Unreadable outcomes land in the `problems` table beside the file's rows.

## Considered options

- **A missing `status` as Partial.** Rejected: Obsidian's Properties panel and a hand-written file both plausibly omit it, and the file is a perfectly good open Question.
- **Wrong values as Partial.** Rejected: the Partial mark would lie about what is wrong, and a fault deserves its reason.
- **Reading the whole file.** Rejected: the body is prose the app does not interpret on open, and a long file should cost the same as a short one.

## Consequences

- **+** A vault Obsidian wrote opens as it is, with every shortfall visible and none silent.
- **+** The rules are code in `packages/core/src/questions.ts`, so a later decision (say, a `status` alias) changes one function and its tests, not a file format.
- **−** A file the user fixes in Obsidian does not update the Inbox until it is reopened; the watcher (`docs/architecture.md` § Open item 2) inherits that.
- **−** Decision 2 means a Question file with no `status` key and one with `status: open` are indistinguishable in the Inbox; the difference only matters to a tool that queries the key directly.
