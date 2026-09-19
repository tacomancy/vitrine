#!/bin/bash
# Builds the Debug app without launching it — the typecheck /implement runs
# between edits. Same destination and warning overrides as Scripts/run.sh,
# for the same reasons; see the comments in Scripts/test.sh.
set -euo pipefail

build_dir="build/DerivedData"
xcodebuild build \
    -quiet \
    -scheme Vitrine \
    -configuration Debug \
    -destination 'platform=macOS,arch=arm64' \
    -derivedDataPath "$build_dir" \
    SWIFT_SUPPRESS_WARNINGS=NO \
    'SWIFT_TREAT_WARNINGS_AS_ERRORS=$(VITRINE_WARNINGS_AS_ERRORS_$(TARGET_NAME):default=YES)' \
    VITRINE_WARNINGS_AS_ERRORS_Markdown=NO
