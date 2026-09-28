# Reference

Original design intent for the project, frozen at the point it was produced. Nothing in this directory is edited after the fact. See `CLAUDE.md` at the repo root for how this tier relates to the living docs (`CONTEXT.md`, `docs/architecture.md`, `docs/adr/`) and the precedence rules between them.

## Contents

- `design-brief.md` — the full design brief
- `design-prompts.md` — the eleven Claude Design prompts, in order, plus the "what to push back on, by surface" table
- `prototypes/` — pinned snapshots from Claude Design, numbered to match the prompts: 00–11 from `design-prompts.md`, and 12 (the empty vault) and 13 (Settings) from the bodies of issues #314 and #290, since that file stays frozen at eleven. Per prompt: the exported HTML (`NN-<surface>.html`) and a full-length PNG of it at the design's own width — 1528 px for 00–11, 3732 px for 12 (its contrast set puts three 1180 px windows side by side, and scaled to 1528 they cannot be told apart), 2536 px for 13. The HTMLs are interactive — open one in a browser; they need `support.js` beside them (the export's runtime, kept once for all of them) and a network connection for the web fonts. 12 and 13 are canvases that fetch their windows from `VaultWindow.dc.html` and `SettingsWindow.dc.html` beside them, so serve the folder over HTTP (the `prototypes` launch configuration does) rather than opening the file directly; `13-settings.html` was exported as `Settings.dc.html` and renamed to its prompt's number. Where a prototype puts states behind tabs or scrolls inside its app frame, the PNG shows the default tab and the first screen of the frame only
- `branding/` — the visual identity carried over from the earlier Vitrine project (tokens, typography, marks, an interactive brand-kit page). Its own `BRAND.md` is the authoritative spec for this subfolder — read that before writing any UI, chart, or marketing surface. Colour, type, and tokens are settled; the voice/tone guidance in that file is a leftover assumption from the other project and is *not* settled for this one.

## Rule

Nothing here gets edited. A correction or a new decision goes in the living docs, not here.

This README is the tier's index, not part of its content: it changes when the contents of this directory change, and only then.
