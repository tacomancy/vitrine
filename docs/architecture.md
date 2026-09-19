# Architecture

Technical decisions the brief structurally couldn't hold: library choices, file formats, how ingestion triggers. Living; edited as work proceeds. A decision that is hard to reverse also gets an ADR in `docs/adr/`, and this file points at it.

## Decided

- Web technology, one codebase, packaged per device — ADR 0001.
- Annotations in the PDF; sidecar index for identity — ADR 0002.
- Phase 1 reading is Preview plus ingest; sync scope is the PDF folder only — ADR 0003.

## Open, in the order they block work

1. Desktop shell (Electron or Tauri), UI framework, language, test runner — blocks the first slice.
2. Vault file layout: how a Question, Research Question, Hypothesis, Experiment, and Source stub are written as Markdown, and where the sidecar index lives.
3. PDF renderer and annotation library for the Reader.
4. Markdown parser, and the tag grammar it shares with the tag tree.
5. How ingest is triggered (file watcher) and coalesced.

Each goes through `grill-me` before its ADR is written.
