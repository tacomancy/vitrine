# Vitrine

A local-first research workspace built around the Question rather than the note. Plain Markdown vault, PDFs annotated in place, scheduled Scouts that propose papers, and three dashboards that each lead to an action.

- `docs/reference/design-brief.md` — what it is and why. Frozen.
- `CLAUDE.md` — how work happens here. `CONTRIBUTING.md` — branch and merge mechanics.
- `CONTEXT.md` — the vocabulary. `docs/architecture.md` and `docs/adr/` — the decisions.
- `docs/reference/prototypes/` — the twelve pinned Claude Design prototypes, one per surface and dashboard.
- `website/` — the public site at [tacomancy.com](https://tacomancy.com), built by `Scripts/build-site.sh` and deployed from `main`. The root is the studio; Vitrine is at [/vitrine/](https://tacomancy.com/vitrine/), and its prototype gallery shows the twelve exports live, restyled into the brand.

Vitrine is built by [Sarah Lehman](https://github.com/dr-tacomancer) under [Tacomancy](https://tacomancy.com/tacomancy/), a one-person studio.

**Status:** the design is complete and every surface has a pinned prototype. The stack is settled (ADR 0005) and scaffolded: `pnpm install && pnpm dev` opens the window on a running core. Nothing vault-related exists yet.

The previous native macOS app lives in `main`'s history before the reimagining.
