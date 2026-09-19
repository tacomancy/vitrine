#!/usr/bin/env bash
# Assembles the public site into build/site. CI (.github/workflows/pages.yml)
# runs this and deploys the result; run it locally to preview the same thing.
#
# The site is website/ plus a few files copied out of the frozen reference
# tier — the brand tokens and marks, and the pinned prototypes — so the site
# can show them without a second, drifting copy being committed anywhere.
#
# Usage: Scripts/build-site.sh [out-dir]   (default: build/site)
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:-build/site}"

rm -rf "$out"
mkdir -p "$out"
cp -R website/. "$out/"

mkdir -p "$out/brand"
cp docs/reference/branding/tokens.css "$out/brand/tokens.css"
cp docs/reference/branding/assets/*.svg "$out/brand/"

# Each prototype needs support.js beside it; the copy keeps that layout.
cp -R docs/reference/prototypes "$out/prototypes"

# Pages serves this file on unknown paths; without it the default is GitHub's.
[ -e "$out/404.html" ] || cp "$out/index.html" "$out/404.html"

printf 'built %s (%s)\n' "$out" "$(du -sh "$out" | cut -f1)"
