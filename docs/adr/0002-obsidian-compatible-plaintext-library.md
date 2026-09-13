# 0002: A library is an Obsidian-compatible folder of Markdown; the index is disposable

**Status:** Accepted

## Context

Vitrine explicitly builds on the precedent of Obsidian and LogSeq. The single
most valuable property of those tools is that the user's notes are plain files
they own, usable by other software. It also means Vitrine can be tried on an
existing Obsidian vault from day one, and abandoned without loss.

## Decision

A **library** (Obsidian: vault) is a folder of Markdown files with optional YAML frontmatter, using
Obsidian's conventions for links (`[[Title]]`, `[[Title|text]]`, `![[file]]`),
tags (`#tag` inline, `tags:` in frontmatter), and aliases (`aliases:` in
frontmatter). The files on disk are the only source of truth.

Anything Vitrine derives — the list of notes, tags, links, backlinks, search
content — is an **Index** that can be deleted and rebuilt from the library at any
time with identical results. The index holds nothing the library does not.

Where Vitrine's behavior on a file-format detail is unspecified, it matches
Obsidian's, and the resolution is recorded in `CONTEXT.md`. Vitrine's own
per-library state (the **sidecar**), if any, lives in a single hidden folder at the library root
(name to be fixed when first needed) so that it is easy to ignore in git and
in Obsidian.

## Consequences

- **+** Any existing Obsidian vault is a valid Vitrine library, and vice versa.
  Editing the same folder with both tools is supported, not merely tolerated.
- **+** Notes are readable, diffable, and git-friendly; no export step exists
  because there's nothing to export.
- **+** Index corruption has a trivial fix: delete it.
- **−** Vitrine cannot store per-note data that Obsidian doesn't understand
  without either using frontmatter (visible to the user) or the index (lost on
  rebuild). Later features (§ Reserved in `CONTEXT.md`) must respect this or
  supersede this ADR explicitly.
- **−** Watching the file system for external edits becomes necessary, since
  the library may change underneath the app. How, and how eagerly, is a later ADR.
- Index storage (in-memory vs. SQLite, etc.) is an implementation choice
  constrained by this ADR, not decided by it.
