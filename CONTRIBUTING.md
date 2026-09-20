# Contributing

Agent guidance lives in `CLAUDE.md`; this file holds the mechanics that apply to anyone, agent or human.

## Branches and pull requests

- Never commit to `main`. Every change lands through a pull request from a short-lived branch, one issue per branch.
- Branch names carry a conventional type prefix: `feat/`, `fix/`, `docs/`, `chore/`, `test/`, `prototype/`. PR titles use the same types in conventional-commit form, scoped when a scope is obvious: `feat(inbox): sort by age`, `docs: seed CONTEXT.md`.
- A `feat` or `fix` PR links the spec issue it implements. Work without a spec issue is not started (`CLAUDE.md` § Development loop).
- `code-review` runs before the PR is opened, not after. The PR body lists any review findings declined, with why.
- Prototypes live on `prototype/<name>` branches and are never merged; the decision they produced goes in an ADR or the spec.

## Merge gates

`main` is protected. A PR merges only when:

- the `guidance` job in `.github/workflows/ci.yml` passes — locally, `Scripts/check-guidance.sh`;
- the `test` job passes — locally, `pnpm lint && pnpm typecheck && pnpm test`;
- the branch is up to date with `main`.

No force pushes to `main`, no deleting it.

## Where things go

- New vocabulary: `CONTEXT.md`. Technical decisions: `docs/architecture.md`. Resolved questions and implementation calls: `docs/adr/`, numbered from the highest existing number, using `docs/adr/0000-template.md`.
- The public site (`tacomancy.com/vitrine/`) lives in `tacomancy/tacomancy` (ADR 0012). Nothing site-related is committed here. A PR that changes what the site should say opens an issue there — `CLAUDE.md` § The public site names the triggers.
- Nothing under `docs/reference/` is ever edited. Its `README.md` changes only when the directory's contents do.
- Issues, labels, and milestones: `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`.
