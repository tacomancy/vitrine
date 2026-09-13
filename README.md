# Vitrine

A native macOS app for personal knowledge management, research, note-taking,
and continuous learning — in the tradition of Obsidian and LogSeq, growing
toward agentic source collection, dashboards, and research-idea tracking.

**Status:** scaffolded — an app that launches to an empty window, a core
package with one test, and CI. No features yet.

## Building

Requires Xcode 26. Nothing to install.

- `open Vitrine.xcodeproj` — ordinary macOS app project; the `Vitrine` scheme
  builds the app and runs every test.
- `Scripts/test.sh` — the one verification command: build, all tests,
  coverage. What CI runs.
- `Scripts/coverage-gate.sh build/Vitrine.xcresult` — the coverage floor.
- `cd VitrineCore && swift test` — the fast inner loop for core logic.
- `swift format lint --strict --recursive App VitrineCore` — formatting, as CI checks it.

- `CLAUDE.md` — how to work on this repo (agents and humans alike)
- `CODING_STANDARDS.md` — the bar for code; what `/code-review` checks against
- `.claude/skills/` — Matt Pocock's engineering skills, vendored (`/ask-matt` to navigate)
- `CONTEXT.md` — the vocabulary
- `docs/adr/` — decisions and why
- `design/` — the design-system brief (authoritative) and UI mockups (reference)
- `BACKLOG.md` — what's parked, and what's still open
