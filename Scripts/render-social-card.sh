#!/usr/bin/env bash
# Renders the Open Graph images (1200×630): website/social.png from
# Scripts/social-card.html for Vitrine's pages, and website/social-tacomancy.png
# from Scripts/social-card-tacomancy.html for the studio's. Both draw on the
# brand tokens and marks in place. The PNGs are committed because the Pages
# build has no browser; re-run this when a card's copy or the brand changes.
set -euo pipefail
cd "$(dirname "$0")/.."
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
render() { # $1 = source html, $2 = output png
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --force-color-profile=srgb \
    --window-size=1200,630 --virtual-time-budget=8000 \
    --screenshot="$PWD/$2" "file://$PWD/$1" 2>/dev/null
  printf 'rendered %s (%s)\n' "$2" "$(du -h "$2" | cut -f1)"
}
render Scripts/social-card.html website/social.png
render Scripts/social-card-tacomancy.html website/social-tacomancy.png
