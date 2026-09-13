# 0005: v1 ships the full tab strip, with non-v1 tabs stubbed

**Status:** Accepted

## Context

The window shell in `design/` has a tab strip — Notes · Sources · Ideas ·
Dashboard · Tags — and shows a SOON badge on the Scouts block. Only Notes and
Tags are functional in v1 (ADR 0003). ADR 0003 also says nothing is added "in
anticipation" of later features. The shell is the one place that rule is
worth an explicit exception, because the strip communicates what Vitrine is
for, and because retrofitting a tab strip onto a two-tab shell later is more
disruptive than shipping the strip now.

## Decision

The v1 shell shows all five tabs as designed. **Notes** and **Tags** are
functional. **Sources**, **Ideas**, and **Dashboard** are **stubs**: the tab
exists, selecting it shows a single placeholder surface carrying the SOON
treatment from the brief, and nothing else — no partial features, no data
model, no settings pane. The Scouts sidebar block is likewise a stub.

A stub becomes a feature only when its concept graduates from `BACKLOG.md`
into `CONTEXT.md` and an ADR. Until then, the stub is the *only* code that
may mention the reserved name.

## Consequences

- **+** The app reads as the product it intends to be, and the shell doesn't
  get rebuilt when v2 features arrive.
- **−** Three visibly empty surfaces ship in v1. Accepted deliberately.
- **−** This is a narrow exception to ADR 0003's no-anticipation rule; it
  does not license any other. See 0003 § Update.
