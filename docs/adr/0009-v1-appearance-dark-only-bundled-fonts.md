# 0009: v1 ships the dark appearance only, with Inter and IBM Plex Mono bundled

**Status:** Accepted

## Context

`BACKLOG.md` held two open questions that block the first screen's asset
setup: whether the cream "playbill" light appearance ships in v1 alongside
the default dark one, and which of the brief's three fonts the app must
bundle (the brief's Google Fonts link is web-only, ADR 0004).

## Decision

**Dark only in v1.** Every color is a semantic color asset named for its
brief token (`bg`, `bg-surface`, `fg-muted`, `primary`, `accent`, …) with
only the dark value set; the app forces the dark appearance. Light is a
later spec that fills in the second value of each asset and lifts the
override — a value addition, not a refactor.

**Bundle Inter (400–700) and IBM Plex Mono (400–500).** Both are OFL and
may be embedded in a distributed app. **Josefin Sans is not bundled**: the
brief bans it inside product UI and v1 has no display copy. A bundled font
failing to load is a bug, not a fallback mode; there is no system-font
fallback design.

## Consequences

- **+** One appearance to verify against the brief while the shell is new.
- **+** Assets are token-named from day one, so light is additive.
- **−** No light mode in v1; users with a light system appearance get a dark
  Vitrine. Accepted; screen 07b remains the reference for later.
- **−** Two font families add ~1 MB to the bundle. Accepted.
- The `/prototype` and first screen record the SwiftUI translation (font
  registration, color-asset names, the appearance override) in
  `docs/visual-implementation.md` (ADR 0004).
