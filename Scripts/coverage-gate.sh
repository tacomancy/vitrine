#!/bin/bash
# Fails when line coverage of the VitrineCore package is below the floor
# (ADR 0006). Reads the .xcresult that Scripts/test.sh writes.
#
# "The package" is every file under VitrineCore/Sources/, whichever target
# xccov files it under. Targets are not a reliable handle: the package is
# statically linked into its test bundle, so some runs report its sources
# only under the test target with no package target at all, and a
# target-name filter then measures nothing and passes vacuously. Matching
# on Sources/ also keeps VitrineCore/Tests/ out. When both targets are
# present each lists the same file with the same counts, so the first
# entry per path is kept and the rest dropped before summing — the floor
# applies to the package as a whole and not per file. A package with no
# executable lines has nothing left uncovered and counts as 100%.
# Whole-percent arithmetic rounds down, so the floor is conservative: 89.9%
# fails.
#
# Usage: Scripts/coverage-gate.sh <path/to/Vitrine.xcresult> [report.json]
set -euo pipefail

MINIMUM_LINE_COVERAGE_PERCENT=90
PACKAGE_SOURCES_PATH_FRAGMENT="/VitrineCore/Sources/"

result_bundle="${1:?usage: coverage-gate.sh <result-bundle> [report.json]}"
report="${2:-${result_bundle%.xcresult}-coverage.json}"

xcrun xccov view --report --json "$result_bundle" > "$report"

read -r covered executable < <(
    jq -r --arg sources "$PACKAGE_SOURCES_PATH_FRAGMENT" '
        [.targets[].files[] | select(.path | contains($sources))]
        | unique_by(.path)
        | "\(map(.coveredLines) | add // 0) \(map(.executableLines) | add // 0)"
    ' "$report"
)

if [[ "$executable" -eq 0 ]]; then
    percent=100
else
    percent=$(( covered * 100 / executable ))
fi
echo "coverage-gate: package line coverage ${percent}% (${covered}/${executable}); floor ${MINIMUM_LINE_COVERAGE_PERCENT}%."

if [[ "$percent" -lt "$MINIMUM_LINE_COVERAGE_PERCENT" ]]; then
    echo "coverage-gate: FAIL — below the floor." >&2
    exit 1
fi
echo "coverage-gate: PASS"
