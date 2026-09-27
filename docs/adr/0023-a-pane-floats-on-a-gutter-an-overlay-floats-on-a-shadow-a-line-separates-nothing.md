# 0023: A pane floats on a gutter, an overlay floats on a shadow; a line separates nothing

**Status:** Accepted

`Picker.module.css` and `AttachSource.module.css` cited "ADR 0008" for a rule about floating surfaces that the current ADR 0008 — Markdown located and spliced — does not carry, and `ResearchQuestion.module.css` cited `BRAND.md` law 5 for "no hairline" when law 5 lists hairline rules *among* the Deco geometry it endorses. The rule behind all three is real and was decided by the owner from six prototyped variants, in the pre-reset `docs/adr/0008-drawn-chrome-over-native-split-view.md` — "**Panes are floating surfaces.** … **Decorative `line` hairlines are not drawn**" — which `467b9fb` ("chore: clear the tree for a blue-sky reimagining") deleted along with the rest of the Swift-era set, reassigning the number. Read it at `git show 8c58ce2:docs/adr/0008-drawn-chrome-over-native-split-view.md`. This ADR re-homes that decision in the web-tech codebase and scopes it, so the citations have a correct target and the deliberate exceptions stop reading as violations. A `grilling` + `domain-modeling` pass on 2026-09-26 settled it.

## Decisions

1. **A pane is distinguished by its own background and the gutter around it — never a border, never a shadow.** `--color-bg-surface` (or `--color-bg-raised`) on the `--color-bg` ground, at `--radius-lg`, with a `--space-2` gutter all round. `App.module.css`'s `.panes` is the statement of it: panes float side by side with a gap and nothing drawn between them. Contrast between the ground and the surface does the work a border or a divider would.

2. **An overlay floats above content still visible beneath it, and takes `--shadow-3`.** The Picker over the list it was opened from and the attach form over the page are overlays, not panes: they are `--color-bg-raised` at `--radius-lg` like a pane, and the shadow is what says they are *above* rather than *beside*. `--shadow-3` is the only sanctioned shadow. This is the reading of law 5's "no fake gilding via drop shadow" that this codebase works to: the ban is on shadow as ornament applied to a flat surface, not on shadow as the signal that one surface genuinely sits above another — which is why `tokens.css` ships `--shadow-1/2/3` at all. `--shadow-1` and `--shadow-2` are unused; a use for either needs its own reason.

3. **The no-line rule holds between surfaces, not inside one.** A hairline separating two panes is refused. A hairline *within* a surface is ordinary Deco geometry under law 5 and is untouched: `Inbox.module.css`'s 36px rows carry a hairline on the seam over a 4-point step of surface, and `PositionHistory.module.css`'s short rule running into a collapsed trail is that run's own mark. Neither is a divergence, and neither needs to argue for itself.

4. **This is a divergence from law 5, not an application of it.** Law 5 — "Deco is geometry, not ornament. Stepped corners, hairline rules, wide letterspaced caps, symmetry" — *permits* a hairline rule. The house narrows that: a hairline is a divider, and separation between surfaces is expressed as a gutter instead. `docs/reference/branding/` is frozen and cannot be amended to say so, and `CLAUDE.md` § Precedence asks any divergence to trace to an ADR rather than sit as unnoticed drift. This ADR is that trace, and it is what the five CSS comments now cite.

## Considered options

- **Cite `BRAND.md` law 5 and write no ADR.** The original reading of this problem, and the reason it took a grill to settle. Rejected on the text: law 5 endorses hairline rules, so citing it for "no hairline" attributes to the frozen tier the opposite of what it says. `PositionHistory.module.css` already read law 5 correctly — as *permission* for the one rule it keeps — which is the tell that the other citations were reaching for something else.

- **Drop the citations and inline the substance.** What the `code-review` pass in #223 did to `LooseEnds.module.css`, with the note "dropped an ADR 0008 citation from the CSS that ADR does not carry." Correct as far as it went, and the right call *then*, because there was nothing to repoint to. Rejected as the settled answer: it leaves a decision the owner made from six variants living only in CSS comments, where § Precedence cannot see it, and it gives the next surface no way to know whether the rule binds.

- **Amend `BRAND.md` to carry the narrowed rule.** Rejected outright: the branding tier is frozen, and the rule is Vitrine's reading of the brand rather than the brand's own law. The divergence is the thing worth recording.

- **A wide ADR covering the renderer's visual language.** A standing home that future departures from `BRAND.md` would amend rather than join. Rejected: § Code standard says no abstraction until a second real use case needs it, and a document that invites later editors to widen its scope invites them not to think. A second visual divergence gets its own ADR.

- **One rule: elevation is never a shadow.** Proposed during the grill and withdrawn, because it is false of the code — `Picker.module.css:15` and `AttachSource.module.css:16` both set `box-shadow: var(--shadow-3)`. Recording it would have put a rule in the ADR set that the two files citing it break on line 15. The two tiers in decisions 1 and 2 are what the renderer actually does.

## Consequences

- **+** The three miscitations have a correct target, and `App.module.css`'s origin statement has something behind it instead of standing as a bare assertion.
- **+** The exceptions are named, so `Inbox`'s seam and `PositionHistory`'s run mark stop looking like violations of a rule nobody had scoped. `PositionHistory`'s comment already carves its exception out by hand; a future surface will not have to.
- **+** `--shadow-3` has a stated job, which is the difference between an overlay and a pane, rather than being a token someone reached for.
- **−** The renderer's visual rules now live in two places that must be read together: `BRAND.md`'s eight laws, and this narrowing of law 5. Anyone who reads only the frozen tier will get hairlines wrong.
- **−** "Pane" and "overlay" are load-bearing terms that are deliberately *not* in `CONTEXT.md`, which holds domain vocabulary — Question, Hypothesis, Revision, Shape problem — not presentation. They are defined here and nowhere else.
- **−** Five CSS comments now cite a number, which is a dependency on this file keeping it. The numbering check in `Scripts/check-guidance.sh` guards against a gap or duplicate but not against a rename.
