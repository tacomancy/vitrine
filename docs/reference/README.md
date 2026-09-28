# Reference

Original design intent for the project, frozen at the point it was produced. Nothing in this directory is edited after the fact. See `CLAUDE.md` at the repo root for how this tier relates to the living docs (`CONTEXT.md`, `docs/architecture.md`, `docs/adr/`) and the precedence rules between them.

## Contents

- `design-brief.md` — the full design brief
- `design-prompts.md` — the eleven Claude Design prompts, in order, plus the "what to push back on, by surface" table
- `prototypes/` — pinned snapshots from Claude Design, numbered to match the prompts. Per prompt: the exported HTML (`NN-<surface>.html`) and a full-length PNG of it at the design's own width, 1528 px unless noted below. The HTMLs are interactive — open one in a browser; they need `support.js` beside them (the export's runtime, kept once for all of them) and a network connection for the web fonts. Where a prototype puts states behind tabs or scrolls inside its app frame, the PNG shows the default tab and the first screen of the frame only
  - **12 and 13 differ.** Their prompts are not in `design-prompts.md`, which stays frozen at eleven: Prompt 12 is the body of issue #314 and Prompt 13 the body of #290, both as they stood on 2026-09-28, each run under the standing header in [#314's comment](https://github.com/tacomancy/vitrine/issues/314#issuecomment-5867665314) — and 13 also under the addendum in [#290's comment](https://github.com/tacomancy/vitrine/issues/290#issuecomment-5868364526). Each is a canvas that fetches its windows from a sibling file — `VaultWindow.dc.html`, `SettingsWindow.dc.html` — so serve the folder over HTTP (the `prototypes` launch configuration does) rather than opening the file directly. 12's PNG is 3732 px wide, because its contrast set puts three 1180 px windows side by side and at 1528 they cannot be told apart; 13's is 2536 px. `13-settings.html` was exported as `Settings.dc.html` and renamed to its prompt's number.
- `branding/` — the visual identity carried over from the earlier Vitrine project (tokens, typography, marks, an interactive brand-kit page). Its own `BRAND.md` is the authoritative spec for this subfolder — read that before writing any UI, chart, or marketing surface. Colour, type, and tokens are settled; the voice/tone guidance in that file is a leftover assumption from the other project and is *not* settled for this one.

## Rule

Nothing here gets edited. A correction or a new decision goes in the living docs, not here.

This README is the tier's index, not part of its content: it changes when the contents of this directory change, and only then.
