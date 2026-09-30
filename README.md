# Vitrine

A local-first research workspace built around the Question rather than the note. Plain Markdown vault, PDFs annotated in place, scheduled Scouts that propose papers, and three dashboards that each lead to an action.

- `docs/reference/design-brief.md` — what it is and why. Frozen.
- `CLAUDE.md` — how work happens here. `CONTRIBUTING.md` — branch and merge mechanics.
- `CONTEXT.md` — the vocabulary. `docs/architecture.md` and `docs/adr/` — the decisions.
- `docs/reference/prototypes/` — the twelve pinned Claude Design prototypes, one per surface and dashboard.
- The public site is [tacomancy.com/vitrine/](https://tacomancy.com/vitrine/), with the twelve prototypes live in its [gallery](https://tacomancy.com/vitrine/prototypes/). It is authored in [`tacomancy/tacomancy`](https://github.com/tacomancy/tacomancy), not here (ADR 0012).

Vitrine is built by [Sarah Lehman](https://github.com/dr-tacomancer) under [Tacomancy](https://tacomancy.com/), a one-person studio.

**Status:** the design is complete and every surface has a pinned prototype; the stack is settled (ADR 0005), scaffolded and packaged — `pnpm install && pnpm dev` opens the window on a running core, `pnpm package` installs the app. Four of the eight surfaces are live against a real Markdown vault — two-keystroke capture and the **Question Inbox**; the **Research Question view**, with triage, a working answer kept as a Position history rather than overwritten, sources on two sides, and resolve; the **Hypothesis view**, with criteria written before any run, a state derived from them with its rule printed beside it, edits after evidence marked, and the result written back to the question it came from; and the **Experiment view**, which holds a run's purpose, its design written before running, where it ran, its plots and files drawn inline (stored in the vault, or linked where they lie and checked when the run is attached as Evidence) and its observations, beside an **Experiment Inbox** of completed runs not yet written up or attached — along with the first of the three dashboards, the **Loose Ends** shell. The vault is watched and indexed, so an edit made in Obsidian reaches the app. **Settings** (⌘,) states where the vault is and where the PDFs are, naming an iCloud Drive or Dropbox folder the PDF folder links to; while that folder does not resolve, the footer says *papers not arriving*. The **Reader** opens a paper's PDF beside what already touches it: annotations made in Preview or on an iPad are re-matched when the file is re-saved and become blocks in the Source, a highlight whose note begins `Q:` becomes a Question, one that cannot be found is a Loose end to resolve rather than a link that rots, and a selection becomes a highlight, a margin note or a Question from the page. Everything else is designed and not yet built.

The previous native macOS app lives in `main`'s history before the reimagining.
