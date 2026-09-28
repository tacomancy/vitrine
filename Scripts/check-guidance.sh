#!/usr/bin/env bash
# Checks the guidance tier itself. CI runs this on every PR; run it locally
# before pushing a docs: change. It exists because the rules in CLAUDE.md are
# only rules if something fails when they are broken.
#
# Usage: Scripts/check-guidance.sh [base-ref]
#   base-ref  the ref to diff against for the frozen-tier check
#             (default: origin/main, or skipped if that ref is unknown)
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0
say() { printf '%s\n' "$*"; }
bad() { say "FAIL: $*"; fail=1; }

# 1. The frozen tier is never edited. docs/reference/README.md is the index and
#    may change only alongside a change to the directory's contents.
base="${1:-origin/main}"
if git rev-parse --verify --quiet "$base" >/dev/null; then
  merge_base="$(git merge-base "$base" HEAD)"
  changed="$(git diff --name-only --diff-filter=M "$merge_base" HEAD -- docs/reference/ | grep -v '^docs/reference/README.md$' || true)"
  if [ -n "$changed" ]; then
    bad "frozen reference files modified since $base:"; say "$changed"
  fi
  readme_changed="$(git diff --name-only "$merge_base" HEAD -- docs/reference/README.md)"
  contents_changed="$(git diff --name-only "$merge_base" HEAD -- docs/reference/ | grep -v '^docs/reference/README.md$' || true)"
  if [ -n "$readme_changed" ] && [ -z "$contents_changed" ]; then
    bad "docs/reference/README.md changed without a change to the directory's contents"
  fi
else
  say "skip: frozen-tier diff ($base is not a known ref)"
fi

# 2. Every skill CLAUDE.md names in backticks resolves to a vendored skill, and
#    is one the agent can actually invoke. Only the Development loop and Review
#    cadence sections name skills.
#
#    Existing on disk is not enough: these sections are run by the agent, so a
#    skill flagged user-only leaves the documented step with nothing to run.
#    Upstream sets those flags on user-facing entry points; a skill named here
#    is not one. The truthy/quote variants below are deliberate -- a re-vendor
#    writing `True` or `"yes"` must fail loudly, not pass. ADR 0022.
skills_dir=.agents/skills
sections="$(awk '/^## Development loop/,/^## Code standard/' CLAUDE.md; awk '/^## Review cadence/,/^## Parallel work/' CLAUDE.md)"
for name in $(printf '%s' "$sections" | grep -o '`[a-z][a-z0-9-]*`' | tr -d '`' | sort -u); do
  # Not every backticked word is a skill: a word that is also a path in the
  # repo (a file, a directory) is left alone.
  [ -e "$name" ] && continue
  skill="$skills_dir/$name/SKILL.md"
  if [ ! -f "$skill" ]; then
    bad "CLAUDE.md names \`$name\` but $skill does not exist"
    continue
  fi
  if grep -qiE '^disable-model-invocation:[[:space:]]*['"'"'"]?(true|yes)' "$skill"; then
    bad "CLAUDE.md names \`$name\` as a skill to run, but $skill disables model invocation, so the agent cannot invoke it"
  fi
  policy="$skills_dir/$name/agents/openai.yaml"
  if [ -f "$policy" ] && grep -qiE '^[[:space:]]*allow_implicit_invocation:[[:space:]]*['"'"'"]?(false|no)' "$policy"; then
    bad "CLAUDE.md names \`$name\` as a skill to run, but $policy sets allow_implicit_invocation: false, so the agent cannot invoke it"
  fi
done

# 3. Every .claude/skills link resolves.
for link in .claude/skills/*; do
  [ -e "$link" ] || bad "dangling skill link: $link"
done

# 4. ADRs are numbered without gaps or duplicates, and living docs exist.
if [ -d docs/adr ]; then
  nums="$(ls docs/adr | grep -o '^[0-9]\{4\}' | sort)"
  dupes="$(printf '%s\n' "$nums" | uniq -d)"
  [ -z "$dupes" ] || bad "duplicate ADR numbers: $dupes"
  expected=0
  for n in $nums; do
    if [ "$((10#$n))" -ne "$expected" ]; then bad "ADR numbering gap or misorder at $n (expected $(printf '%04d' "$expected"))"; break; fi
    expected=$((expected+1))
  done
fi
# 5. A spec is published as ready-for-implementation, never ready-for-agent.
#    ready-for-agent marks a ticket an agent can pick up; a spec is the parent
#    of several, and labelling it the same way reads as one grabbable job.
#    Upstream's to-spec applies ready-for-agent, so a re-vendor would silently
#    restore it -- this is what catches that (docs/agents/triage-labels.md).
spec_skill="$skills_dir/to-spec/SKILL.md"
if [ -f "$spec_skill" ]; then
  grep -q 'Apply the `ready-for-implementation` label' "$spec_skill" \
    || bad "$spec_skill does not tell a spec to take ready-for-implementation"
  if grep -qE 'Apply the `ready-for-agent`' "$spec_skill"; then
    bad "$spec_skill tells a spec to take ready-for-agent, which is for its tickets"
  fi
fi

# 6. to-spec and to-tickets link what they publish into the sub-issue tree
#    that closes itself from the bottom up (#329). Upstream says nothing about
#    it, so a re-vendor would publish issues nothing ever closes.
for name in to-spec to-tickets; do
  skill="$skills_dir/$name/SKILL.md"
  [ -f "$skill" ] || continue
  grep -q '§ Specs, tickets, and beats' "$skill" \
    || bad "$skill does not link what it publishes into the sub-issue tree (docs/agents/issue-tracker.md § Specs, tickets, and beats)"
done

for f in CONTEXT.md docs/architecture.md CLAUDE.md CONTRIBUTING.md; do
  [ -e "$f" ] || bad "missing living doc: $f"
done

if [ "$fail" -ne 0 ]; then say "guidance check failed"; exit 1; fi
say "guidance check passed"
