# 0021: The hash is where, the Global command is how, the Sidebar is a map

**Status:** Accepted

Beat 2 built a navigation model in #208 — the URL hash and a Sidebar — that no prototype drew and no ADR explained (#254). Decided: the hash is where the window is, the Global command (⌘K) is how anything is reached, and the Sidebar is a map whose contents are layout. The shape prototype already chose this, and story CAP-9 gives the command its reach.

## Where it comes from

- **`00-shape`** weighs three main windows over six surfaces, with no Hypothesis or Experiment, and settles the role of each piece rather than the layout. Its assumptions panel: *⌘K is the real navigation; the sidebar is the map you consult until you stop needing it*. Weighing its icon rail: *six icons is six things to learn; needs tooltips + ⌘K as the real nav*. `06-scout-queue` draws no rail at all.
- **Story CAP-9** ([tacomancy.com/vitrine_stories](https://tacomancy.com/vitrine_stories/)): one global command that captures, or jumps to any object — a question, a hypothesis, a run, a source — from anywhere, so no object is more than one command away whatever the rail shows.
- **ADR 0020 decision 8** made the hash the window's location; **ADR 0010** made the keyboard follow a landing, and its router test ties the selection to a path.
- **`CONTEXT.md` § Picker** already said the command palette is a different thing from the Picker.

## Decisions

1. **The hash is where.** Every surface a user can stand on, and every object that has a page, has an Address — a hash route the router parses (`packages/renderer/src/router.ts`). No surface is on screen without one. A Kind that gains a page gains its route in the same ticket.
2. **The Global command is how.** ⌘K, from any surface, reaches any object with an Address; a jump is a `pushRoute` to it, so back returns to where the user was. It is what guarantees reachability. A jump is a landing in ADR 0010's sense, so the surface it lands on decides where the keyboard goes, as it does after a capture. What else the command reaches, its matching, its look, and whether capture moves into it are for #246's slot and prototype, not this ADR.
3. **The Sidebar is a map.** It shows the product's shape and where the user is (`aria-current`), and it is the only way around until the Global command lands. Its contents are layout — the prototype's call, not a guarantee (`CLAUDE.md`, Reference material, Precedence) — so no object depends on a Sidebar entry to be reachable, and an entry may come or go without an ADR. It stands in for Home until beat 12.

The Global command is not the Picker: the Picker is a list of vault files that one slot opens, narrowed to the Kinds that slot accepts; the Global command is window-wide and goes somewhere. Whether one list serves both is for the second use to decide, when #246 draws it.

## Considered options

- **The Sidebar as the navigation, the command as a shortcut.** Rejected: a Sidebar that must list every destination grows with every Kind — `00-shape`'s six icons are now eight surfaces and three dashboards — and puts Hypotheses and Experiments one entry, or one drill-down from a Question, away. The shape named this cost and chose the command instead.
- **Pin the Sidebar's contents now** (which surfaces, in which order, rail or list). Rejected: that is layout, which the prototypes win on, and none of them agree — `00-shape` draws a list, a rail, and a question column; `06-scout-queue` draws nothing. Pinning it would turn a layout choice into a decision every later surface must re-litigate.
- **A router library or a store holding "where".** #208 built the router with no library; ADR 0005 and ADR 0020 decision 8 keep the renderer store-free. Recorded here so the command is not taken as the second use that justifies either: a jump is one `pushRoute`.

## Consequences

- **+** Reachability is one rule — has an Address, reached by the command — instead of a Sidebar audit per beat. A Hypothesis just promoted from the Inbox (story PROM-1) and one whose criteria are being written before evidence (TEST-1) are one command away whatever the Sidebar holds.
- **+** The command needs nothing from the router it does not already have: `pushRoute` exists, and back already works.
- **+** The Sidebar can be redesigned, collapsed to a rail, or hidden on the iPad without a navigation decision.
- **−** Until #246 lands, the Sidebar is the only navigation, so every live surface still needs a live entry, and an object reached only by drilling down (a Research Question from the Inbox today) is a click chain, not one command. This ADR states the target; it does not deliver it.
- **−** CAP-9's reach is only partly met, and will stay so for a while. An object with no page — a Source before the Reader beat, a Note before the Vault editor — has no Address, so the command cannot reach it. The reach grows with the surfaces, one route at a time.
- **−** Capture has its own key today (`⌘'`, the capture line). CAP-9 puts capture inside the command too; which key survives, or whether both do, is #246's to settle.
