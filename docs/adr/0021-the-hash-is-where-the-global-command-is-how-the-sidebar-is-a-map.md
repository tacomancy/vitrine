# 0021: The hash is where, the global command is how, the Sidebar is a map

**Status:** Accepted

Beat 2 built a navigation model in #208 — the window's location is the URL hash (ADR 0020 decision 8), and a Sidebar lists the surfaces with the live ones as links — but no prototype drew one and no ADR said what it is *for*. The prototypes never settled it: `00-shape` weighs three main windows over six surfaces with no Hypothesis or Experiment, and `06-scout-queue` has no rail at all. What the shape does settle is the role of each piece. Its assumptions panel: *⌘K is the real navigation; the sidebar is the map you consult until you stop needing it*; and, weighing its icon rail, *six icons is six things to learn; needs tooltips + ⌘K as the real nav*. Story CAP-9 (tacomancy.com/vitrine_stories) gives that command its reach: one global command that captures, or jumps to any object — a question, a hypothesis, a run, a source — from anywhere, so no object is more than one command away whatever the rail shows.

Decided, three layers:

1. **The hash is where.** Every surface a user can stand on, and every object that has a page, is an Address — a hash route the router parses (`packages/renderer/src/router.ts`). There is no way to be somewhere that has no Address. A Kind that gains a page gains its route in the same ticket.
2. **The global command is how.** ⌘K, from any surface, reaches any object with an Address; a jump is a `pushRoute` to it, so back returns to where the user was. It is how reachability is guaranteed. What else the command reaches, its matching, its look, and whether capture moves into it are #246's slot and prototype, not this ADR.
3. **The Sidebar is a map.** It shows the product's shape and where the user is (`aria-current`), and it is the only way around until the global command lands. Its contents are layout — the prototype's call, not a guarantee — so no object depends on a Sidebar entry to be reachable, and an entry may come or go without an ADR. It stands in for Home until beat 12 (`docs/architecture.md` § Research Question view and triage, Navigation).

The global command is not the Picker (`CONTEXT.md`): the Picker is a list of vault files that one slot opens, narrowed to the Kinds that slot accepts; the global command is window-wide and goes somewhere. Whether one list serves both is for the second use to decide, when #246 draws it.

## Considered options

- **The Sidebar as the navigation, the command as a shortcut.** Rejected: a Sidebar that must list every destination grows with every Kind — `00-shape`'s six icons are now eight surfaces and three dashboards — and puts Hypotheses and Experiments one entry, or one drill-down from a Question, away. The shape named this cost and chose the command instead.
- **Pin the Sidebar's contents now** (which surfaces, in which order, rail or list). Rejected: that is layout, which the prototypes win on (`CLAUDE.md` § Precedence), and none of them agree — `00-shape` draws a list, a rail, and a question column; `06-scout-queue` draws nothing. Pinning it would turn a layout choice into a decision every later surface must re-litigate.
- **A router library or a store holding "where".** Rejected by ADR 0020 decision 8 and ADR 0005; recorded here only so the command is not taken as the second use that justifies one. A jump is one `pushRoute`.

## Consequences

- **+** Reachability is one rule — has an Address, reached by the command — instead of a Sidebar audit per beat. PROM-1 and TEST-1 have a direct entry to a Hypothesis or a run whatever the rail holds.
- **+** The command needs nothing from the router it does not already have: `pushRoute` exists, and back already works.
- **+** The Sidebar can be redesigned, collapsed to a rail, or hidden on the iPad without a navigation decision.
- **−** Until #246 lands, the Sidebar is the only navigation, so every live surface still needs a live entry, and an object reached only by drilling down (a Research Question from the Inbox today) is a click chain, not one command. This ADR states the target; it does not deliver it.
- **−** An object with no page — a Source before the Reader beat, a Note before the Vault editor — has no Address, so the command cannot reach it. The command's reach grows with the surfaces, one route at a time.
- **−** Capture has its own key today (`⌘'`, the capture line). CAP-9 puts capture inside the command too; which key survives, or whether both do, is #246's to settle.
