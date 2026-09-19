#!/usr/bin/env python3
"""Rebrand the pinned prototypes for the public site.

The exports in docs/reference/prototypes/ are frozen and use Claude Design's
own palette and type. The site shows them in Vitrine's brand instead
(docs/reference/branding/BRAND.md), so this rewrites copies: every colour
the exports use maps to a brand hex, the interface font maps to Inter (the serif
for questions and quotations is kept), and the Google Fonts link becomes the brand's. The interactivity
(support.js, the tab and state switches) is untouched.

The mapping is total on purpose. A colour with no entry fails the build
with the list, so a re-pinned prototype can't ship half-branded.

Usage: rebrand-prototypes.py <src-dir> <out-dir>
"""
import re
import sys
from pathlib import Path

# Brand ramps, by name, so the mapping below reads as intent rather than hex.
INK = {50: "#EAEFF5", 100: "#D0D8E4", 200: "#B2BBC9", 300: "#9099A7", 400: "#707885",
       500: "#545B66", 600: "#3F4550", 700: "#2C333E", 800: "#1C232F", 850: "#121A25",
       900: "#09111D", 950: "#020713"}
PAPER = {"base": "#F7F1E6", "raised": "#FDFAF3", "sunken": "#EEE7D9"}
BRASS = {100: "#FEEBC4", 200: "#FCD37D", 300: "#E5B64A", 400: "#C49726", 500: "#A17B1D",
         600: "#836202", 700: "#634A0D", 800: "#463406", 900: "#2B1E01"}
SAPPHIRE = {200: "#C5DBFC", 300: "#9ABFFA", 600: "#2062C7", 700: "#0C49A0", 900: "#011D4B"}
EMERALD = {100: "#BEFEDE", 300: "#48DBA2", 400: "#2CB985", 700: "#105D41", 900: "#022819"}
GARNET = {300: "#FAA0B0", 400: "#F5688A", 700: "#8F133E", 800: "#67092A", 900: "#410318"}

# Export colour -> brand colour. Grouped by the role the export used it for.
COLOURS = {
    # Page and app-frame grounds (dark).
    "#08090a": INK[950], "#0a0b0c": INK[950], "#0c0e10": INK[950],
    "#0f1113": INK[900], "#101315": INK[900],
    "#121518": INK[850], "#131619": INK[850], "#15181b": INK[850], "#15181c": INK[850],
    "#171b20": INK[800], "#181c21": INK[800], "#191d22": INK[800], "#1b1f24": INK[800],
    "#1d2126": INK[800],
    # Hairlines and stronger lines (dark).
    "#212730": INK[700], "#23272d": INK[700], "#262c33": INK[700], "#272d34": INK[700],
    "#2b3036": INK[700], "#2f3942": INK[700],
    "#394048": INK[600], "#3a424b": INK[600], "#4b525a": INK[500],
    # Text (dark), brightest first.
    "#e7e9eb": INK[100], "#d3d7db": INK[200], "#bac0c6": INK[200],
    "#98a2ab": INK[300], "#8c939a": INK[300],
    "#7d858d": INK[400], "#6b737b": INK[400],
    # Amber accent -> brass. Links are re-pointed at sapphire separately below.
    "#f3e2c8": BRASS[100], "#e8b673": BRASS[200], "#d99b4a": BRASS[300],
    "#8a6f36": BRASS[500], "#8f5f2c": BRASS[600], "#6a4a1e": BRASS[700],
    "#4a3a1c": BRASS[800], "#3a2c18": BRASS[800],
    "#1e1810": BRASS[900], "#1a1611": BRASS[900],
    # Teal (positive) -> emerald.
    "#4fb3a4": EMERALD[300], "#2f6560": EMERALD[700],
    # Red (negative, broken) -> garnet.
    "#e59289": GARNET[300], "#d4685c": GARNET[400], "#9a4b3f": GARNET[700],
    "#5a3f3a": GARNET[800], "#3c2b28": GARNET[900], "#3a2c2a": GARNET[900],
    "#1a1413": GARNET[900],
    # Reader highlight -> sapphire.
    "#22343f": SAPPHIRE[900], "#3d5c6b": SAPPHIRE[700],
    # Paper grounds (the Reader page and light mode).
    "#fdfcf9": PAPER["raised"], "#faf9f6": PAPER["raised"],
    "#f4f2ec": PAPER["base"], "#f1eee7": PAPER["base"], "#efece5": PAPER["base"],
    "#eeebe3": PAPER["base"],
    "#e6e2d9": PAPER["sunken"], "#e4e0d7": PAPER["sunken"], "#e0dcd3": PAPER["sunken"],
    "#e2dcd0": PAPER["sunken"],
    # Lines on paper.
    "#ddd9d0": INK[200], "#d8d2c6": INK[200], "#d6d1c7": INK[200], "#cdc8bd": INK[200],
    "#b6b1a6": INK[300],
    # Text on paper, darkest first.
    "#1c1b18": INK[900], "#2b2a26": INK[900], "#3b3831": INK[700],
    "#56534c": INK[500], "#8a867d": INK[400], "#a8a49a": INK[300],
    # Per-surface variants of the above: grounds and lines.
    "#111417": INK[850], "#14171b": INK[850], "#151312": INK[850], "#171512": INK[850],
    "#141821": INK[800], "#1a1d21": INK[800], "#1a1e23": INK[800], "#1b2027": INK[800],
    "#1b2129": INK[800],
    "#252c33": INK[700], "#272c32": INK[700],
    "#2f3a44": INK[600], "#31373d": INK[600], "#3a444d": INK[600],
    "#3f464d": INK[500], "#414b55": INK[500], "#46586a": INK[500], "#4b5560": INK[500],
    "#5b6771": INK[400], "#626e79": INK[400],
    "#a4aeb6": INK[300], "#d5d9dd": INK[200],
    # Per-surface variants: paper.
    "#fdfcfa": PAPER["raised"], "#f7f5f0": PAPER["raised"],
    "#f7efe4": PAPER["base"], "#eae7df": PAPER["base"], "#e6e3dc": PAPER["base"],
    "#e6e0d3": PAPER["base"],
    "#d9d2c4": PAPER["sunken"], "#cfc8b9": INK[200],
    # Per-surface variants: amber on paper and in cards -> brass.
    "#f3e6d4": BRASS[100], "#e3cfae": BRASS[100], "#e8c98f": BRASS[200],
    "#d8b57e": BRASS[300], "#c9a762": BRASS[400], "#a98b4a": BRASS[500],
    "#2b2117": BRASS[900],
    # Per-surface variants: teal -> emerald, including its light-mode tints.
    "#eef4f2": EMERALD[100], "#cfe0dc": EMERALD[100], "#cfdedb": EMERALD[100],
    "#9fc3bc": EMERALD[300], "#8fb3ac": EMERALD[400],
    "#3d6a63": EMERALD[700], "#4a5a45": EMERALD[700], "#1f3b37": EMERALD[700],
    "#17332f": EMERALD[900], "#11211f": EMERALD[900],
    # Per-surface variants: red -> garnet.
    "#5a4a52": GARNET[800], "#4a3835": GARNET[800],
    "#3a2c28": GARNET[900], "#241a19": GARNET[900], "#191413": GARNET[900],
    "#171313": GARNET[900],
}

# Anything already a brand colour, or plain white, passes through untouched.
PASS_THROUGH = {v.upper() for ramp in (INK, PAPER, BRASS, SAPPHIRE, EMERALD, GARNET)
                for v in ramp.values()} | {"#FFFFFF"}

# rgba() values: the export's text and shadow colours with an alpha.
RGBA = {
    "231,233,235": "208,216,228",   # fg with alpha -> ink-100
    "40,34,22": "9,17,29",          # warm shadow -> ink-900
    "15,17,19": "9,17,29",          # frame ground fade -> ink-900
    "0,0,0": "2,7,19",              # overlays -> ink-950
}

# The brand has no serif role, but the exports set questions and quotations
# in Source Serif 4 on purpose: the only humane thing on the screen, and the
# mark of a thing a person wondered. That distinction is kept (ADR 0004).
FONTS = [
    ("'IBM Plex Sans'", "'Inter'"),
]

FONT_LINK = re.compile(r'<link href="https://fonts\.googleapis\.com/css2\?[^"]*" rel="stylesheet">')
BRAND_FONT_LINK = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@200;300;400'
                   # Inter as a variable axis: the exports use 450 as well as the brand's
                   # 400–700. Plex Mono 600 is used throughout the exports' labels.
                   '&family=Inter:wght@400..700&family=IBM+Plex+Mono:wght@400;500;600'
                   '&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">')

# BRAND.md law 2: sapphire is every action. The exports colour <a> amber; the
# rule is the same in every file, so it is re-pointed here rather than mapped.
LINK_RULE = re.compile(r"a\{color:#d99b4a\}a:hover\{color:#e8b673\}")
BRAND_LINK_RULE = "a{color:%s}a:hover{color:%s}" % (SAPPHIRE[300], SAPPHIRE[200])

# BRAND.md law 2 again, for buttons and selected states. The exports fill a
# primary action amber with dark text on it; carets, dots, and swatches are
# filled amber with no text colour at all. That pairing in one declaration
# list is the tell, so those become the brand's primary (sapphire) with white
# on it, and every other amber stays brass as punctuation.
AMBER_FILL = "background:#d99b4a"
DARK_TEXT = re.compile(r"(?<![\w-])color:#(?:0f1113|15181c)")
# A style attribute, or a rule body in a <style> block: the shape document
# styles its selected section chip in a rule, not an attribute.
STYLE_ATTR = re.compile(r'style="([^"]*)"')
RULE_BODY = re.compile(r"\{([^{}]*)\}")


def is_button(decls: str) -> bool:
    return AMBER_FILL in decls and DARK_TEXT.search(decls) is not None


def to_primary(decls: str) -> str:
    decls = (decls
             .replace(AMBER_FILL, "background:" + SAPPHIRE[600])
             .replace("border:1px solid #d99b4a", "border:1px solid " + SAPPHIRE[600]))
    return DARK_TEXT.sub("color:#FFFFFF", decls)


def button_attr_sub(m):
    decls = m.group(1)
    return f'style="{to_primary(decls)}"' if is_button(decls) else m.group(0)


def button_rule_sub(m):
    decls = m.group(1)
    return "{" + to_primary(decls) + "}" if is_button(decls) else m.group(0)


# Any #hex run, whatever its length. Six digits map; anything else (3, 4, or
# 8 digits) has no mapping and must fail rather than slip through. The
# lookbehind keeps ids and anchors like href="#1a" out of it.
HEX = re.compile(r"(?<![\w-])#([0-9a-fA-F]{3,8})(?![0-9a-fA-F])")
RGBA_RE = re.compile(r"rgba?\((\d+),\s*(\d+),\s*(\d+)(,[^)]*)?\)")


def rebrand(html: str) -> tuple[str, set[str]]:
    unmapped: set[str] = set()
    html = LINK_RULE.sub(BRAND_LINK_RULE, html)
    # Order matters: the link and button passes key on the export's amber,
    # so they run before the colour map turns it into brass.
    html = STYLE_ATTR.sub(button_attr_sub, html)
    html = RULE_BODY.sub(button_rule_sub, html)

    def hex_sub(m):
        key = "#" + m.group(1).lower()
        if len(m.group(1)) != 6:
            unmapped.add(key)
            return m.group(0)
        if key in COLOURS:
            return COLOURS[key]
        if key.upper() in PASS_THROUGH:
            return m.group(0)
        unmapped.add(key)
        return m.group(0)

    html = HEX.sub(hex_sub, html)

    def rgba_sub(m):
        key = f"{m.group(1)},{m.group(2)},{m.group(3)}"
        if key in RGBA:
            tail = m.group(4) or ""
            return f"rgba({RGBA[key]}{tail})"
        if key in ("255,255,255",):
            return m.group(0)
        unmapped.add(m.group(0))
        return m.group(0)

    html = RGBA_RE.sub(rgba_sub, html)
    for old, new in FONTS:
        html = html.replace(old, new)
    html = FONT_LINK.sub(BRAND_FONT_LINK, html)
    return html, unmapped


def main(src: Path, out: Path) -> int:
    out.mkdir(parents=True, exist_ok=True)
    problems: dict[str, set[str]] = {}
    for path in sorted(src.glob("*.html")):
        html, unmapped = rebrand(path.read_text(encoding="utf-8"))
        if unmapped:
            problems[path.name] = unmapped
        (out / path.name).write_text(html, encoding="utf-8")
    (out / "support.js").write_bytes((src / "support.js").read_bytes())
    if problems:
        for name, colours in problems.items():
            print(f"FAIL: {name} uses colours with no brand mapping: {', '.join(sorted(colours))}")
        return 1
    print(f"rebranded {len(list(src.glob('*.html')))} prototypes into {out}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    sys.exit(main(Path(sys.argv[1]), Path(sys.argv[2])))
