# 0047: The Vault graph view is a local graph on fixed Rings, drawn as plain SVG with no graph library

**Status:** Accepted

ADR 0015 left the Vault graph view as fog and its #244 update ruled out any simulated layout. Beat 11b (#184) settled the rest in a `grilling` pass; the mechanics live in `docs/architecture.md` § Vault surface, *Graph view*.

## Decisions

1. **Local only.** The graph shows the open file's neighbourhood, 1 or 2 hops, never the whole vault. A fixed-position layout of a whole vault is a hairball with a different rule, which is the failure mode the brief names; a local graph has a natural centre.
2. **Positions are a pure function of the neighbourhood.** Concentric Rings by hop, a sector per Kind, name order inside it. The same vault and file draw the same picture, and nothing moves toward rest.
3. **Plain SVG, no graph library.** The layout is arithmetic, so a library would only add a simulator that this repository has promised never to use, and could be switched to it by accident. SVG nodes are elements: focusable, named, testable.
4. **Ambiguous and unresolved links are Not drawn, and said so.** They are counted and listed with their file and target as written, never drawn as ghost nodes, never dropped silently.
5. **Rings are capped and the overflow is listed**, not shrunk into an unreadable ring.
6. **A view, not a place.** It adds no Loose Ends row and no Home item, and writes nothing.

## Considered options

- *Whole-vault graph, or a switch between it and the local one.* Rejected: see 1.
- *A layout library with the simulation disabled.* Rejected: see 3.
- *Ghost nodes for unresolved links, as Obsidian draws them.* Rejected: see 4; the file's own links are already listed as a Loose End or an editor squiggle's business.

## Consequences

- **+** One new query and one component; nothing else in the Vault surface changes.
- **+** The layout is testable as a pure function.
- **−** No exploration: a user who wants to wander the vault has the Question Map, backlinks and search, by design (the prototype's caption: *present, not promoted*).
- **−** A hub file's graph shows only its strongest neighbours; the rest are a list.
