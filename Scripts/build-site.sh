#!/usr/bin/env bash
# Assembles the public site into build/site. CI (.github/workflows/pages.yml)
# runs this and deploys the result; run it locally to preview the same thing.
#
# The site is website/ plus what it borrows from the frozen reference tier:
# the brand tokens and marks copied as they are, and the pinned prototypes
# rewritten into the brand by Scripts/rebrand-prototypes.py. Neither is
# committed as a second copy, so neither can drift from the original.
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

# The gallery page (website/vitrine/prototypes/index.html) is already in place
# from the copy above; the rebranded exports and support.js land beside it.
Scripts/rebrand-prototypes.py docs/reference/prototypes "$out/vitrine/prototypes"

printf 'built %s (%s)\n' "$out" "$(du -sh "$out" | cut -f1)"
