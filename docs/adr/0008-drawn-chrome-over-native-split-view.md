# 0008: Drawn title bar and tab strip over a native split view

**Status:** Accepted (see Update — the fallback was built, not the hybrid)

## Context

The first real screen (ADR 0004: screens 01 and 11) has to reconcile two
authorities that disagree. The brief fixes a 38 px `bg-raised` title bar, a
31 px tab strip, and an opaque `bg` sidebar; ADR 0006 notes that building
against the macOS 26 SDK makes system title bars, toolbars, and sidebars
Liquid Glass — translucent, with the user's accent color for focus. Either
the app draws its own chrome and rebuilds what the system gives for free, or
it takes native chrome and demotes the brief.

## Decision

**Hybrid.** The window uses `.windowStyle(.hiddenTitleBar)`. Above the body,
Vitrine **draws** the title bar (traffic lights left in place; app mark,
"Vitrine", library name; per-tab actions) and the tab strip (ADR 0005),
exactly per the brief. The body is a native `NavigationSplitView`, so column
resizing, collapse, the sidebar toggle, and window restoration come from the
system, with the sidebar's background overridden to the opaque `bg` token
(`scrollContentBackground(.hidden)` plus a token fill). File dialogs, menus,
the window shadow, and text controls stay native.

Rejected: fully native chrome (system toolbar + glass sidebar), because it
contradicts the brief on first sight and would need an ADR superseding part
of 0004; and fully drawn chrome (`HSplitView` and hand-rolled column
behavior), because it pays for pane mechanics the system already provides.
The latter is the **fallback** if the prototype shows glass bleeding through
the split view's sidebar; this ADR's Update will say which was built.

## Consequences

- **+** The brand-carrying chrome matches the brief pixel for pixel; the
  pane mechanics and their accessibility come from AppKit.
- **+** The light "playbill" appearance later is a token swap, not a
  renegotiation with system materials.
- **−** The drawn tab strip has no native accessibility role; it supplies
  tab traits, keyboard navigation, and the brass focus ring itself, and
  honors Reduce Transparency / Increase Contrast by hand.
- **−** Window dragging from the drawn title bar and traffic-light alignment
  in full screen are ours to get right and can only be UI-tested.
- **−** More code in the app target than a native shell; it stays view code
  with no logic (ADR 0001).
- `docs/visual-implementation.md` (ADR 0004) records the SwiftUI translation
  once built. A later ADR that adopts a native toolbar or window tabs
  supersedes this one.

## Update (2026-09-13, from `prototype/window-chrome`)

The prototype settled it against the hybrid. On macOS 26, a
`NavigationSplitView` inside a `.hiddenTitleBar` window **swallows the drawn
title bar**: the top 38 pt renders as bare background with no mark, name, or
search field, whether the split view's toolbar is hidden or kept and whether
or not the safe area is respected. Its sidebar also renders as an inset card
with a corner radius well past the brief's 5 px maximum. The fallback named
above is therefore what gets built:

- **Drawn title bar and tab strip** exactly as decided; unchanged.
- **Panes are an `NSSplitView` subclass** (bridged with `NSViewRepresentable`)
  whose divider is an **8 px transparent gutter** — `dividerThickness`
  overridden, `drawDivider` a no-op. Dragging the gutter resizes; nothing is
  drawn. `HSplitView` cannot hide its divider, and `NavigationSplitView` is
  ruled out above. Initial column widths are applied on the split view's first
  real layout, not from `updateNSView`.
- **Panes are floating surfaces.** Note list and editor are `bg-surface`
  with `radius-lg` (5 px) on a `bg` ground, 8 px gutters all round; the
  sidebar sits directly on `bg`. **Decorative `line` hairlines are not drawn**
  between panes or under the title bar and tab strip — contrast between
  `bg`, `bg-surface`, and `bg-raised` does that work. Selected rows are
  `bg-raised` pills at `radius-md` (3 px) with the 2 px sapphire left rule.
  This is a deliberate softening of screen 01's hard-edged panes, chosen by
  the owner from six prototyped variants; it stays inside the brief (rule 4:
  radii ≤ 5 px; `line` is decorative and exempt) and changes no token.

The prototype and its six variants are the primary source, kept on
`prototype/window-chrome`; nothing from it is ported without being rewritten
under `/tdd`.
