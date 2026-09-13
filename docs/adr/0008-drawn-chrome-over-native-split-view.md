# 0008: Drawn title bar and tab strip over a native split view

**Status:** Proposed — becomes Accepted when the `prototype/window-chrome`
branch confirms the sidebar takes an opaque token fill on macOS 26.

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
