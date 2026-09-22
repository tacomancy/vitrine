# 0021: Make the skills the loop names agent-invocable

**Status:** Accepted

`CLAUDE.md` § Development loop is a loop the *agent* runs: it reaches step 1 and invokes `grill-with-docs` itself. Eight of the skills that section names shipped from upstream with `disable-model-invocation: true` (and `allow_implicit_invocation: false` in `agents/openai.yaml`), which reserves a skill for the user typing its slash command and so leaves the documented first step of every tracer-bullet slice with nothing to run. Both flags are removed from the eight, and `Scripts/check-guidance.sh` now checks invocability rather than mere existence (issue #241).

Upstream's flag is not wrong for upstream: it marks user-facing entry points so a model does not spontaneously open a long interview. It is wrong *here*, because this repo's process document hands those same skills to the agent as steps.

## Considered options

- **Leave the flags and point `CLAUDE.md` at the sub-skills instead** (`grilling` + `domain-modeling` in place of `grill-with-docs`). Rejected: it dissolves the wrapper's only job, which is to let one step of the loop name one thing, and it does not generalise. `to-spec`, `to-tickets`, `wayfinder`, `improve-codebase-architecture` and `to-questionnaire` have no sub-skill to redirect to at all. `implement` does — it delegates to `tdd` and `code-review`, the same shape as the grill wrapper — but redirecting there drops the ordering and the commit step it exists to impose. The loop would stay broken in those six places.
- **Leave the flags and rely on slash invocation.** Rejected on two counts. Observed in the Claude Code desktop app, the flag drops the skill from the slash menu as well as from the Skill tool, so it is unreachable from both sides. Even if a later build restored the slash menu, a loop the agent drives cannot depend on the user hand-typing each step.
- **Unflag every vendored skill.** Rejected: the flag is doing real work on the fourteen skills the loop does not name (`ask-matt`, `claude-handoff`, `handoff`, `implement-spec`, `loop-me`, `retro`, `setup-matt-pocock-skills`, `setup-ts-deep-modules`, `teach`, `triage`, `wait-what`, `writing-beats`, `writing-fragments`, `writing-shape`). Those stay as upstream shipped them.

## Consequences

- **+** Every step of § Development loop is runnable by the agent, and CI fails if a future skill update re-breaks one.
- **+** The check now encodes *why* the skills are listed — to be run — not just that the files exist.
- **−** `.agents/skills/` diverges from upstream across eight skills, 16 files. Re-vendoring will reintroduce the flags; the guidance check is what catches that, which is why this is a check and not only a one-time edit.
- **−** The agent can now auto-trigger these eight from their descriptions alone. Accepted: `grilling` itself was already model-invocable carrying the same "'grill' trigger phrases" language, so the wrappers add little new exposure.
- **−** `CLAUDE.md` § Setup still names `/setup-matt-pocock-skills`, which keeps both flags and sits outside the two sections the check parses, so the check stays silent about it. Left deliberately: CLAUDE.md phrases it as a one-time thing the user runs by hand, not a loop step, and it has already been run for this repo. If that slash invocation turns out not to work either, the fix is the same one applied here.
