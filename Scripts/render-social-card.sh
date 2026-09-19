#!/usr/bin/env bash
# Renders website/social.png (the Open Graph image, 1200×630) from
# Scripts/social-card.html, which draws on the brand tokens and mark in place.
# The PNG is committed because the Pages build has no browser; re-run this
# when the card's copy or the brand changes.
set -euo pipefail
cd "$(dirname "$0")/.."
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$chrome" --headless=new --disable-gpu --hide-scrollbars --force-color-profile=srgb \
  --window-size=1200,630 --virtual-time-budget=8000 \
  --screenshot="$PWD/website/social.png" "file://$PWD/Scripts/social-card.html" 2>/dev/null
printf 'rendered website/social.png (%s)\n' "$(du -h website/social.png | cut -f1)"
