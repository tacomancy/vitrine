# 0001: Native macOS app in Swift and SwiftUI

**Status:** Accepted

## Context

Vitrine is specified as a native macOS application. "Native" rules out
Electron and web-wrapper approaches, but still leaves the question of which
Apple UI framework carries the app, and how much of it stays portable.

## Decision

Vitrine is written in Swift. The UI is SwiftUI, dropping to AppKit only where
SwiftUI can't yet do the job (the Markdown editor is the likely first case).
All non-UI logic — library scanning, parsing, indexing, link and tag resolution,
search — lives in a separate Swift package with no UI framework dependency and
its own tests. The app target is a thin shell over that package.

macOS is the only target for v1. Nothing in the core package may assume macOS
specifically, so an iPadOS target stays possible later without a rewrite —
but it is not being designed for now.

## Consequences

- **+** First-class macOS integration: file system access, Finder, Spotlight,
  system Markdown-adjacent conveniences, no web runtime.
- **+** Core logic is testable with `swift test` and free of view code.
- **−** Some editor behaviors will need AppKit (`NSTextView`) bridged into
  SwiftUI, which is more work than a web text editor.
- **−** No Windows/Linux story. Accepted: this is a personal, Mac-first tool.
- Exact project layout (Xcode project vs. SwiftPM-only, package naming,
  minimum macOS version) is a separate, later ADR.
