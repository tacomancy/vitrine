# Vitrine

A local-first research workspace built around the Question rather than the note. Plain Markdown vault, PDFs annotated in place, scheduled Scouts that propose papers, and three dashboards that each lead to an action.

- `docs/reference/design-brief.md` — what it is and why. Frozen.
- `CLAUDE.md` — how work happens here. `CONTRIBUTING.md` — branch and merge mechanics.
- `CONTEXT.md` — the vocabulary. `docs/architecture.md` and `docs/adr/` — the decisions.
- `docs/reference/prototypes/` — the twelve pinned Claude Design prototypes, one per surface and dashboard.
- The public site is [tacomancy.com/vitrine/](https://tacomancy.com/vitrine/), with the twelve prototypes live in its [gallery](https://tacomancy.com/vitrine/prototypes/). It is authored in [`tacomancy/tacomancy`](https://github.com/tacomancy/tacomancy), not here (ADR 0012).

Vitrine is built by [Sarah Lehman](https://github.com/dr-tacomancer) under [Tacomancy](https://tacomancy.com/), a one-person studio.

**Status:** the design is complete and every surface has a pinned prototype. The stack is settled (ADR 0005) and scaffolded: `pnpm install && pnpm dev` opens the window on a running core. Nothing vault-related exists yet.

The previous native macOS app lives in `main`'s history before the reimagining.
