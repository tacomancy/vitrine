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

# 2. Every skill CLAUDE.md names in backticks resolves to a vendored skill.
#    Only the Development loop and Review cadence sections name skills.
skills_dir=.agents/skills
sections="$(awk '/^## Development loop/,/^## Code standard/' CLAUDE.md; awk '/^## Review cadence/,/^## Parallel work/' CLAUDE.md)"
for name in $(printf '%s' "$sections" | grep -o '`[a-z][a-z0-9-]*`' | tr -d '`' | sort -u); do
  # Not every backticked word is a skill: a word that is also a path in the
  # repo (a file, a directory) is left alone.
  [ -e "$name" ] && continue
  [ -f "$skills_dir/$name/SKILL.md" ] || bad "CLAUDE.md names \`$name\` but $skills_dir/$name/SKILL.md does not exist"
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
for f in CONTEXT.md docs/architecture.md CLAUDE.md CONTRIBUTING.md; do
  [ -e "$f" ] || bad "missing living doc: $f"
done

if [ "$fail" -ne 0 ]; then say "guidance check failed"; exit 1; fi
say "guidance check passed"
