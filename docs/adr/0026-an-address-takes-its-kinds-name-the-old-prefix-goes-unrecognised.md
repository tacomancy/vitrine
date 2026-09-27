# 0026: An Address takes its Kind's name, and the old prefix goes unrecognised

**Status:** Accepted

`#/questions/<path>` addresses a **Research** Question, not a Question — the prefix and the Kind say opposite things, and nothing noticed while Research Questions were the only Kind with a page (`packages/renderer/src/kinds.ts`, whose own comment states the inversion outright). Beat 2b gives a Question an Address, which is the moment the collision stops being harmless: the Global command would be offering two row kinds whose Addresses invert the vocabulary the rest of the vault uses. Decided during the beat 2b grill (#262): **every Kind-addressed object takes its Kind's own name, singular, exactly as `kind:` spells it in frontmatter** — `#/question/<path>` and `#/research-question/<path>` — and the old `#/questions/<path>` is left **unrecognised** rather than redefined.

Surfaces are unaffected and keep their own names (`#/inbox`, `#/loose-ends`, `#/settings`): the rule binds objects, which have a Kind, not screens, which do not.

## Considered options

- **`#/research-questions/` for the Research Question, `#/questions/` for the Question.** Rejected, and this is the whole reason the ADR exists: it keeps the old prefix working while giving it a *new referent*, so an Address saved yesterday lands silently on a different object. An Address is copyable — that is the point of ADR 0021 decision 1 — so it leaks into notes, issues and links, and a redefined prefix turns every one of them into a quiet lie. § Invariants asks for no silent failures; `parseHash` falling through to the Inbox on an unrecognised hash is the loud version of the same event.
- **Keep `#/questions/` for the Research Question and give the Question a different word** (`#/captures/`). Rejected: it preserves old links, but "capture" is the act and not the object (`CONTEXT.md` § Capture), so it buys compatibility by making the vocabulary permanently wrong.
- **Do nothing and let the Question be reached as `#/inbox` with no row named.** Rejected by the beat: a command whose whole promise is that no object is more than one command away cannot reach the app's primary object.
- **Keep a redirect from the old prefix.** Rejected: a redirect is the silent landing again, with a moving part added. Nothing outside this repository links to a vault Address, and the set of people holding one is one person.

## Consequences

- **+** One vocabulary for a file and its Address: what `kind:` says in the frontmatter is what the hash says.
- **+** The rename is cheap exactly once. Today `router.ts` is the only writer or reader of a hash, with seven call sites all going through `hashOf`, and `#/settings` has not landed yet. Every later beat that gives a Kind a page adds a route under the rule instead of re-litigating it.
- **−** Any `#/questions/<path>` Address saved before this lands on the Inbox instead of the page. That is the chosen failure: visible, not wrong.
- **−** `parseHash`'s fall-through now absorbs two different things — a hash nothing ever wrote, and a hash that used to mean something. The second deserves to say so on arrival, which is a question the beat 2b spec answers, not this ADR.
