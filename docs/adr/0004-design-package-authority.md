# 0004: The design-system brief is the visual authority; the mockups are reference

**Status:** Accepted

## Context

`design/` holds two things produced by a separate design pass:
`vitrine-design-system-brief.md` — tokens, type, rules, chart palette, mark,
and an accessibility contract, all Vitrine-branded — and `Galaxy Brain.dc.html`
with thirteen screenshotted screens. The mockups cover the *whole* product
(sources, anchors, ideas, dashboards, scouts, quick capture), carry a stale
product name, and use AI-safety research as sample content. v1 is far narrower
(ADR 0003). Agents need to know which of this binds them.

## Decision

- **The brief is authoritative for everything visual.** Color, typography,
  radii, the seven rules, chart colour, focus treatment, and the accessibility
  contract are not re-derived or "improved" in implementation. Translating a
  token or rule into SwiftUI/AppKit is implementation; changing its value is
  a new ADR.
- **The mockups are reference, not spec.** For v1 the relevant screens are
  01 (main window), 07 (density and light mode), 08 (command palette),
  09 (tag browser), 10 (settings — the Links section), and 11 (first run).
  Match their layout, spacing, and copy where the feature exists in v1;
  translate drawn chrome into native controls as `design/README.md` directs.
  Screens 02–06 and 12 illustrate reserved concepts (`CONTEXT.md` § Reserved)
  and are not to be built in v1.
- **Sample content is sample content.** The AI-safety notes, tags, and papers
  in the mockups say nothing about Vitrine's target domain. The product name
  is Vitrine; "Galaxy Brain" in the mockups is stale.
- **A SwiftUI translation of the brief** (fonts, color assets, native focus
  ring, density preference) is written as `docs/visual-implementation.md`
  when the first real screen is built, not before.

## Consequences

- **+** No visual bikeshedding; the brief already resolved it.
- **+** v1 screens have a concrete layout reference instead of a blank canvas.
- **−** Fonts (Inter, IBM Plex Mono, Josefin Sans) must be bundled with the
  app; the brief's Google Fonts link is web-only.
- **−** Where a v1 screen shows a reserved concept (e.g. the anchor rail on
  01), the implementation shows the v1 subset (backlinks, info) and nothing
  invented in its place.
- The brief flags one unconfirmed assumption about tone of voice ("presenting
  and curating work"). Unresolved; matters for copy, not for tokens.

## Update (2026-09-13)

The design package was re-delivered with the product name corrected at the
source: the mockup file is now `design/Vitrine.dc.html`, and the brand mark
— **The Case** — arrived as `design/icons/` (SVG masters, the macOS iconset,
menu-bar template images, web sizes). `design/README.md` § Assets documents
the three size cuts and is the reference for using the mark. The iconset is
wired into the app's `AppIcon` set; the menu-bar template images stay in the
package unused, since the menu-bar extra is Quick capture (§ Reserved). Only
the screenshot PNGs still carry the old name. The brief is unchanged.
