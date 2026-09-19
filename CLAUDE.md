# CLAUDE.md

## Project

**Vitrine** — a local-first research workspace built around the Question object rather than the note. Read `docs/reference/design-brief.md` and `docs/reference/design-prompts.md` in full before working on any surface — no partial reads, no relying on a prior session's summary.

## Reference material

**Frozen — original design intent, never edited (see `docs/reference/README.md`):**
- `docs/reference/design-brief.md`, `docs/reference/design-prompts.md`
- `docs/reference/prototypes/` — pinned Claude Design snapshots, not live links: per prompt, one exported HTML (`NN-<surface>.html`, interactive when opened in a browser beside `support.js`) and one full-length PNG of it, numbered to match the prompt. Read the PNG; the HTML holds any states behind tabs that the PNG could not capture
- `docs/reference/branding/` — visual identity (palette, typography, logo/wordmark, design tokens) carried over from the earlier Vitrine project. The only thing reused from that project — nothing else about it applies here.

**Living — current understanding, edited as work proceeds:**
- `CONTEXT.md` — domain vocabulary, starting from the brief's Primary Objects table and expected to diverge as implementation reveals distinctions the brief didn't need
- `docs/architecture.md` — technical decisions the brief structurally couldn't hold (library choices, file formats, how ingestion triggers)
- `docs/adr/` — resolved former Open Questions, plus implementation-only decisions

**Precedence:**
- Living docs win wherever they speak. Frozen docs are the fallback for whatever living docs haven't caught up to yet.
- Any divergence between a living doc and the brief should trace to an ADR — that's what makes it a decision instead of unnoticed drift.
- On a prototype: the brief wins on behavior it specifies (no badges, no red states, derived-not-declared state, no force-directed graph); the prototype wins on layout and visual treatment. Check it against `docs/reference/design-prompts.md`'s "what to push back on, by surface" table before trusting it as settled. A surface with no prototype in `docs/reference/prototypes/` falls back to brief prose plus the visual language the existing prototypes established.
- Palette and typography come from `docs/reference/branding/`, not from a prototype or from scratch — prototypes and UI work should be drawing on it, not inventing an alternative.

**Rules:**
- Never edit the frozen tier.
- New vocabulary goes in `CONTEXT.md`, technical decisions in `docs/architecture.md`, resolved questions or implementation calls in `docs/adr/` — never a new file alongside these.
- Reference brief/prompt sections by name (e.g. `## Scouts`) instead of restating their content here.

## Invariants

Never silently violate these:
- Agent output is always a proposal — nothing writes to the vault without explicit acceptance.
- Annotations live in the PDF as standard annotation objects, not a database.
- Vault is plain Markdown files. Local-first; sync scope is the PDF folder only.
- BYOK — no credentials leave the device except to the configured model provider.
- No force-directed graph for the Question Map. Sorted matrix, labeled scatter, ranked lists.
- No silent failures — an unmatched annotation surfaces for a decision rather than disappearing; a broken Scout must never look identical to a quiet field.
- State is derived, not declared — e.g. a Hypothesis's status is computed from its criteria, never set directly.

## Development loop

Run in this order, per tracer-bullet slice:

1. **`grill-me`** — pressure-test the slice's plan, one question at a time, before code exists.
2. **`to-issues`** — break the plan into end-to-end, demoable vertical slices (not schema/API/UI layers).
3. **`tdd`** — red-green-refactor. Test written before the code that satisfies it.
4. **`diagnose`** — as needed: reproduce → minimize → hypothesize → instrument → fix → regression-test.
5. **`code-review`** — before merge, checked against the brief section implemented and the code standard below.

`grill-with-docs` and `improve-codebase-architecture` are in use now that `CONTEXT.md` / `docs/adr/` exist. `to-prd` stays excluded — it would regenerate the brief from conversation, with less authority than the original.

## Code standard

Overrides `code-review`'s default smell baseline:
- Prefer the obvious solution over the clever one. No abstraction until a second real use case needs it.
- Comment the *why*, not the *what*. Skip anything that restates the code.
- Extra weight near load-bearing spots: annotation re-matching, Scout source-health, derived Hypothesis state. A future reader should see why that logic exists without re-deriving it from the brief.

## Review cadence

- **Per slice**: `code-review` at merge, against the brief section implemented and the standard above.
- **Periodic** (weekly, or every N merged issues): `improve-codebase-architecture` across everything merged since the last pass — catches inconsistent judgment calls between branches that no single diff would surface, and checks for `CONTEXT.md` / ADR drift.

## Parallel work

- One `git worktree` / branch per issue (`claude --worktree <name>`).
- Before running two issues in parallel, check whether either touches a shared load-bearing piece — the annotation-identity index, the Position History mechanism. Sequence those instead of parallelizing.
- Tests are the interface contract between slices — an agent shouldn't need the other branch's context, just a suite that fails loudly if an assumption breaks.
- Short-lived branches, one issue each. Full suite green (not just the branch's own tests) and review approval required before merge — enforced by branch protection and CI, not just this file.

## Setup

Run `/setup-matt-pocock-skills` once per repo. Domain-doc layout: `CONTEXT.md` + `docs/adr/`, as above.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `tacomancy/vitrine`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the root plus `docs/adr/`. See `docs/agents/domain.md`.
