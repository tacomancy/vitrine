# 0003: Phase 1 reading is Preview plus ingest; sync scope is the PDF folder only

**Status:** Accepted

Reading on the iPad starts as Preview on iPadOS over a synced folder (iCloud or Dropbox), with the Mac app ingesting annotations when the file returns (`design-brief.md` § Reading on iPad, § Sync is deferred). The synced scope is the PDF folder only, never the vault or the app's own state: file-level sync of PDFs is what those services do well, and syncing the vault would create a conflict-resolution problem the brief removed rather than solved. One machine holds the vault. Question capture from the iPad survives by the `Q:` convention.

## Considered options

- **PWA Reader first.** Deferred to phase 2: costs pencil fidelity and only works on the home network.
- **Native iPadOS Reader first.** Deferred to phase 3: needs a developer account and a second build. The Reader is designed so this is a port, not a rewrite.
- **Sync the whole vault.** Rejected: conflict resolution was the ugliest engineering problem in the original design.

## Consequences

- **+** No iPad code and no sync layer in phase 1.
- **−** The `Q:` convention and the re-matching logic (ADR 0002) are unproven in real use; the brief lists both as open questions.
- Sync returns only if a native iPad app does, and then file-level, never a proprietary backend.
