#!/bin/bash
# Mutation-tests the VitrineCore package with Muter (ADR 0015). Non-gating:
# the exit status says whether Muter ran, never how many mutants survived —
# a survivor is a finding to triage, not a red build. Run by hand and by the
# weekly workflow, never per PR (ADR 0006's runner budget).
#
# The pin is a commit, not a release, and not one on master (ADR 0015,
# Update): no release reads Swift Testing's failure line, and master applies
# no mutants at all — its per-mutant runs replay the unmutated build and
# report every mutant survived (muter#307). The pinned commit is the head of
# the pull request that fixes both, fetched by SHA from the upstream
# repository, built from source into build/muter/ on first use and reused
# after. Move the pin when upstream merges a fix.
#
# Muter mutates a full copy of the directory it runs in, placed beside that
# directory. Run from the repo root that would put .git, build/, and the
# local libraries into a sibling folder, so the repo is first staged —
# tracked and unignored files only — under build/, where the mutated copy
# then lands too. The test command itself is in Scripts/muter.conf.yml.
#
# Usage: Scripts/mutate.sh [report.json]
set -euo pipefail

MUTER_REPOSITORY="https://github.com/muter-mutation-testing/muter.git"
# Head of muter#309 (2026-08-21), on master at 7f1f258 (muter#306, Swift
# Testing failure detection).
MUTER_COMMIT="5be334dda0caef6fedfb1a4ea46b4072da3a7dc1"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
build_dir="$repo_root/build"
muter="$build_dir/muter/bin/muter-$MUTER_COMMIT"
staged_repo="$build_dir/mutation/vitrine"
mutated_repo="${staged_repo}_mutated"
report="${1:-$build_dir/mutation/report.json}"

mkdir -p "$(dirname "$report")"
report="$(cd "$(dirname "$report")" && pwd)/$(basename "$report")"

if [[ ! -x "$muter" ]]; then
    source_dir="$build_dir/muter/source"
    if [[ ! -d "$source_dir/.git" ]]; then
        git clone --quiet "$MUTER_REPOSITORY" "$source_dir"
    fi
    git -C "$source_dir" fetch --quiet origin "$MUTER_COMMIT"
    git -C "$source_dir" checkout --quiet "$MUTER_COMMIT"
    swift build --package-path "$source_dir" -c release --product muter --disable-sandbox
    mkdir -p "$(dirname "$muter")"
    cp "$source_dir/.build/release/muter" "$muter"
fi

mkdir -p "$staged_repo"
rsync -a --delete --filter=':- .gitignore' --exclude=/.git --exclude=/.claude \
    "$repo_root/" "$staged_repo/"

(
    cd "$staged_repo"
    "$muter" run \
        --configuration Scripts/muter.conf.yml \
        --skip-coverage \
        --skip-update-check \
        --format json \
        --output "$report"
)

echo "mutate: report at $report"
jq -r --arg mutated "$mutated_repo/" '
    "mutate: score \(.globalMutationScore)% — \(.numberOfKilledMutants) killed of \(.totalAppliedMutationOperators) mutants in \(.timeElapsed).",
    (.fileReports[].appliedOperators[]
        | select(.testSuiteOutcome != "failed" and .testSuiteOutcome != "runtimeError")
        | "mutate: \(.testSuiteOutcome) \(.mutationPoint.filePath | ltrimstr($mutated)):\(.mutationPoint.position.line) \(.mutationPoint.mutationOperatorId) — \(.mutationSnapshot.description)")
' "$report"
