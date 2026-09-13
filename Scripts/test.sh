#!/bin/bash
# The one verification command. CI, /run, and humans all call this, so the
# local check is the CI check (ADR 0006, Update).
#
# The two overrides exist because Xcode compiles local package targets with
# -suppress-warnings and rejects treatAllWarnings(as:) in Package.swift;
# passing them on the command line is the only way that reaches every target.
#
# The destination names arm64 because both the development machine and the
# macos-26 runner are Apple silicon; without it xcodebuild warns about
# multiple matching destinations.
#
# Usage: Scripts/test.sh [result-bundle-path]
set -euo pipefail

result_bundle="${1:-build/Vitrine.xcresult}"
rm -rf "$result_bundle"

xcodebuild test \
    -scheme Vitrine \
    -destination 'platform=macOS,arch=arm64' \
    -enableCodeCoverage YES \
    -resultBundlePath "$result_bundle" \
    SWIFT_SUPPRESS_WARNINGS=NO \
    SWIFT_TREAT_WARNINGS_AS_ERRORS=YES
