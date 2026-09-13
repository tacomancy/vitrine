#!/bin/bash
# Fails when line coverage of the VitrineCore package is below the floor
# (ADR 0006). Reads the .xcresult that Scripts/test.sh writes.
#
# "The package" is every target in the report that is neither the app bundle
# nor a test bundle — one target per seam, aggregated, so the floor applies to
# the package as a whole and not per file. A package with no executable lines
# has nothing to cover and passes.
#
# Usage: Scripts/coverage-gate.sh <path/to/Vitrine.xcresult> [report.json]
set -euo pipefail

MINIMUM_LINE_COVERAGE_PERCENT=90

result_bundle="${1:?usage: coverage-gate.sh <result-bundle> [report.json]}"
report="${2:-${result_bundle%.xcresult}-coverage.json}"

xcrun xccov view --report --json "$result_bundle" > "$report"

read -r covered executable < <(
    jq -r '
        [.targets[]
         | select((.name | endswith(".app") | not) and (.name | endswith("Tests") | not))]
        | "\(map(.coveredLines) | add // 0) \(map(.executableLines) | add // 0)"
    ' "$report"
)

if [[ "$executable" -eq 0 ]]; then
    echo "coverage-gate: package has no executable lines; nothing to cover."
    exit 0
fi

percent=$(( covered * 100 / executable ))
echo "coverage-gate: package line coverage ${percent}% (${covered}/${executable}); floor ${MINIMUM_LINE_COVERAGE_PERCENT}%."

if [[ "$percent" -lt "$MINIMUM_LINE_COVERAGE_PERCENT" ]]; then
    echo "coverage-gate: FAIL — below the floor." >&2
    exit 1
fi
echo "coverage-gate: PASS"
