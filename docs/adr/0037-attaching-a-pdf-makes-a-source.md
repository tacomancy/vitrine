# 0037: Attaching a PDF makes a Source

**Status:** Accepted

A Source stub is a paper the vault knows of and holds no file for (ADR 0006 decision 7). ADR 0006 said attaching a PDF "sets one key", `pdf:`, so links never change. That undercounts what attaching has to do. A stub deliberately has no `id:` and no sidecar, but a Source's annotation sidecar needs a key that survives a rename of either the Markdown file or the PDF. And a picker or a glyph reading `kind:` has to say *stub* only for a paper with no file.

A PDF the user drops into `sources/pdf/` that no Source's `pdf:` names shows in Loose Ends as *no Source* (spec #416, #417). Attaching it to a stub is the first way that row is resolved.

## Decisions

1. **Attaching is one write of three keys.** `pdf:` is set to the file's own name relative to `sources/pdf/`, `kind` goes from `source-stub` to `source`, and `id:` is minted. One `setFrontmatter`, so a failed write leaves the stub as it was.
2. **Only a stub takes it, only a PDF nothing names.** A file of any other Kind is refused, as is a PDF some Source or stub already names, and a PDF whose bytes are not on this Mac (an evicted file is never hashed or acted on).
3. **Links do not change.** They name the citekey, and the citekey is untouched. A Research Question that cited the stub resolves the Source.
4. **The app never renames, moves or copies a PDF.** A Source's `pdf:` records whatever the file is called. `<citekey>.pdf` in `docs/architecture.md` § Vault layout described a tidy vault, and is no longer a rule.
5. **A Finder rename is followed.** The watcher already pairs a rename by content (ADR 0013). Each paper naming the old file gets its `pdf:` rewritten to the new name, once the index is current, so a rename paired before the Source is read still finds it. A file moved out of `sources/pdf/` is not followed. A row's *mark deliberate* is keyed by the PDF's path and travels with a rename the way a Note's does.
6. **The write guard learns one exception.** `verify` (ADR 0008 decision 3) refuses a splice that changes `kind`, which catches an eaten fence. It now accepts exactly one change: `source-stub` to `source`, when an operation names it. Any other change is still refused.

## Considered options

- **Rename the PDF to `<citekey>.pdf` on attach.** Rejected. Whatever syncs the folder is the only thing meant to touch it, and a rename would race it.
- **Mint the `id:` when the sidecar is first written.** Rejected. Then the flip to `source` and the key it needs are two writes, and a crash between them leaves a Source with no key.

## Consequences

- `docs/architecture.md` § Vault layout no longer says `<citekey>.pdf`, and ADR 0006 decision 7 points here.
- *Create a Source* (from a PDF's metadata) arrives with the PDF engine and mints `id:` the same way.
- A rename the app misses (a crash between the pairing and the rewrite) leaves the Source naming a file that is gone. The *PDF missing* row is where that shows; it is a later ticket's.
