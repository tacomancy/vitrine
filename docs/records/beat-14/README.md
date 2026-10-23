# Beat 14 record: the Scout Queue revamp beside prototype 14

Spec #836, beat #834, closing ticket #842. Produced by `node Scripts/scout-queue-demo.mjs docs/records/beat-14`: nine hidden launches on one scratch vault (beat 6b's six Scouts and triage history, two Retroactive batches, three Skim lines, a Scout file that does not parse), against beat 6b's arXiv stand-in. Each drive throws when the page does not show what its step claims, so these pictures are from a green run. The prototype is [`14-scout-queue-revamp.png`](../../reference/prototypes/14-scout-queue-revamp.png) (with [batch expanded](../../reference/prototypes/14-scout-queue-revamp-batch-expanded.png) and [run rejected](../../reference/prototypes/14-scout-queue-revamp-run-rejected.png)), drawn dark at a wide window.

Sample content differs from the prototype's (fixture vault, not the mockup's), so compare layout and treatment, not words. The narrow column is a 640px window.

| Step | Dark | Narrow | Light |
|---|---|---|---|
| 1. Triage by keys (J/K, reject and `U`, accept, defer; the strip still in view after six J) | [![](1-triage-dark.png)](1-triage-dark.png) | [![](1-triage-narrow.png)](1-triage-narrow.png) | [![](1-triage-light.png)](1-triage-light.png) |
| 2. A tile filters; its Scout header (Cap, Run now, Assigned Questions) | [![](2-filter-dark.png)](2-filter-dark.png) | [![](2-filter-narrow.png)](2-filter-narrow.png) | [![](2-filter-light.png)](2-filter-light.png) |
| 3. A Retroactive batch expanded, a title selected | [![](3-batch-expanded-dark.png)](3-batch-expanded-dark.png) | [![](3-batch-expanded-narrow.png)](3-batch-expanded-narrow.png) | [![](3-batch-expanded-light.png)](3-batch-expanded-light.png) |
| 3b. The other batch rejected as a run (*not counted toward accept rate*), before its undo | [![](3-batch-run-rejected.png)](3-batch-run-rejected.png) | | |
| 4. Skim | [![](4-skim-dark.png)](4-skim-dark.png) | [![](4-skim-narrow.png)](4-skim-narrow.png) | [![](4-skim-light.png)](4-skim-light.png) |
| 5. Muted, from *Mute rules* | [![](5-muted-dark.png)](5-muted-dark.png) | [![](5-muted-narrow.png)](5-muted-narrow.png) | [![](5-muted-light.png)](5-muted-light.png) |
| 6. Grouped by Question | [![](6-by-question-dark.png)](6-by-question-dark.png) | [![](6-by-question-narrow.png)](6-by-question-narrow.png) | [![](6-by-question-light.png)](6-by-question-light.png) |
| 7. An unreadable Scout file's tile; an unreadable rules file named in the footer | [![](7-broken-dark.png)](7-broken-dark.png) | [![](7-broken-narrow.png)](7-broken-narrow.png) | [![](7-broken-light.png)](7-broken-light.png) |

## What the pictures showed, and what was done

- **The surface scrolled as one page.** Moving through a long list with J scrolled the header and the strip out of view, and the detail went with them. In a window wide enough for two panes, each pane now scrolls on its own under a strip drawn as one row (scrolling sideways when the fleet is wider than the window), as the prototype draws it; stacked, the surface still scrolls as one. Step 1's drive asserts the strip is still in view after six J.
- **Dead CSS.** The old rail's `.scouts` / `.scout` rules had no reader left; removed.

## Divergences left open

These are visible beside the prototype and none breaks a behaviour the spec states; they are listed on the beat's `Shipped:` comment.

- No `NEW FINDS · N` heading over the new finds, and `RETROACTIVE` carries no count.
- The Scout header sits above both panes, not at the top of the list pane (ADR 0052 decision 2), and its *Run now · Edit · Pause* run together with no separator.
- The selected row is a raised background with no accent bar; a batch row has no disclosure glyph.
- The detail is a raised card, its actions the inline tier (`Defer D`) rather than the prototype's bordered buttons.
