#!/bin/bash
# Builds the Debug app and launches it. What /run and .claude/launch.json call.
set -euo pipefail

build_dir="build/DerivedData"
xcodebuild build \
    -quiet \
    -scheme Vitrine \
    -configuration Debug \
    -destination 'platform=macOS,arch=arm64' \
    -derivedDataPath "$build_dir" \
    SWIFT_SUPPRESS_WARNINGS=NO \
    SWIFT_TREAT_WARNINGS_AS_ERRORS=YES

open "$build_dir/Build/Products/Debug/Vitrine.app"
