# Reference

Original design intent for the project, frozen at the point it was produced. Nothing in this directory is edited after the fact. See `CLAUDE.md` at the repo root for how this tier relates to the living docs (`CONTEXT.md`, `docs/architecture.md`, `docs/adr/`) and the precedence rules between them.

## Contents

- `design-brief.md` — the full design brief
- `design-prompts.md` — the eleven Claude Design prompts, in order, plus the "what to push back on, by surface" table
- `prototypes/` — pinned snapshots from Claude Design, numbered to match the prompts. Per prompt: the exported HTML (`NN-<surface>.html`) and a full-length PNG of it at the design's 1528 px width. The HTMLs are interactive — open one in a browser; they need `support.js` beside them (the export's runtime, kept once for all of them) and a network connection for the web fonts. Where a prototype puts states behind tabs, the PNG shows the default tab only
- `branding/` — the visual identity carried over from the earlier Vitrine project (tokens, typography, marks, an interactive brand-kit page). Its own `BRAND.md` is the authoritative spec for this subfolder — read that before writing any UI, chart, or marketing surface. Colour, type, and tokens are settled; the voice/tone guidance in that file is a leftover assumption from the other project and is *not* settled for this one.

## Rule

Nothing here gets edited. A correction or a new decision goes in the living docs, not here.

This README is the tier's index, not part of its content: it changes when the contents of this directory change, and only then.
