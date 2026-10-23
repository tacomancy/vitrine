# Beat 13 record: every surface beside its prototype

Spec #782, beat #781, closing ticket #793. Produced by `node Scripts/ui-record-demo.mjs docs/records/beat-13`: hidden launches on a scratch copy of the fixture vault plus the Home demo's fleet of Scouts, one per theme, arXiv and OpenAlex on dead ports. The prototype column is the frozen PNG in `docs/reference/prototypes/` (dark, as drawn); the app is shown in both themes.

Sample content differs from the prototypes' (fixture vault, not the mockup's), so compare layout and treatment, not words.

| Surface | Prototype | App, dark | App, light |
|---|---|---|---|
| Question Inbox | [![](../../reference/prototypes/01-question-inbox.png)](../../reference/prototypes/01-question-inbox.png) | [![](01-question-inbox-dark.png)](01-question-inbox-dark.png) | [![](01-question-inbox-light.png)](01-question-inbox-light.png) |
| Reader | [![](../../reference/prototypes/02-reader.png)](../../reference/prototypes/02-reader.png) | [![](02-reader-dark.png)](02-reader-dark.png) | [![](02-reader-light.png)](02-reader-light.png) |
| Research Question view | [![](../../reference/prototypes/03-research-question-view.png)](../../reference/prototypes/03-research-question-view.png) | [![](03-research-question-view-dark.png)](03-research-question-view-dark.png) | [![](03-research-question-view-light.png)](03-research-question-view-light.png) |
| Hypothesis view | [![](../../reference/prototypes/04-hypothesis-view.png)](../../reference/prototypes/04-hypothesis-view.png) | [![](04-hypothesis-view-dark.png)](04-hypothesis-view-dark.png) | [![](04-hypothesis-view-light.png)](04-hypothesis-view-light.png) |
| Experiment view | [![](../../reference/prototypes/05-experiment-view.png)](../../reference/prototypes/05-experiment-view.png) | [![](05-experiment-view-dark.png)](05-experiment-view-dark.png) | [![](05-experiment-view-light.png)](05-experiment-view-light.png) |
| Scout Queue | [![](../../reference/prototypes/06-scout-queue.png)](../../reference/prototypes/06-scout-queue.png) | [![](06-scout-queue-dark.png)](06-scout-queue-dark.png) | [![](06-scout-queue-light.png)](06-scout-queue-light.png) |
| New Scout form (no prototype; Settings 13 is its anchor, #780) | [![](../../reference/prototypes/13-settings.png)](../../reference/prototypes/13-settings.png) | [![](06b-new-scout-form-dark.png)](06b-new-scout-form-dark.png) | [![](06b-new-scout-form-light.png)](06b-new-scout-form-light.png) |
| Vault | [![](../../reference/prototypes/07-vault.png)](../../reference/prototypes/07-vault.png) | [![](07-vault-dark.png)](07-vault-dark.png) | [![](07-vault-light.png)](07-vault-light.png) |
| Home | [![](../../reference/prototypes/08-home.png)](../../reference/prototypes/08-home.png) | [![](08-home-dark.png)](08-home-dark.png) | [![](08-home-light.png)](08-home-light.png) |
| Loose Ends | [![](../../reference/prototypes/09-loose-ends.png)](../../reference/prototypes/09-loose-ends.png) | [![](09-loose-ends-dark.png)](09-loose-ends-dark.png) | [![](09-loose-ends-light.png)](09-loose-ends-light.png) |
| Scout Activity | [![](../../reference/prototypes/10-scout-activity.png)](../../reference/prototypes/10-scout-activity.png) | [![](10-scout-activity-dark.png)](10-scout-activity-dark.png) | [![](10-scout-activity-light.png)](10-scout-activity-light.png) |
| Question Map | [![](../../reference/prototypes/11-question-map.png)](../../reference/prototypes/11-question-map.png) | [![](11-question-map-dark.png)](11-question-map-dark.png) | [![](11-question-map-light.png)](11-question-map-light.png) |
| First run (empty vault) | [![](../../reference/prototypes/12-empty-vault.png)](../../reference/prototypes/12-empty-vault.png) | [![](12-empty-vault-dark.png)](12-empty-vault-dark.png) | [![](12-empty-vault-light.png)](12-empty-vault-light.png) |
| Settings | [![](../../reference/prototypes/13-settings.png)](../../reference/prototypes/13-settings.png) | [![](13-settings-dark.png)](13-settings-dark.png) | [![](13-settings-light.png)](13-settings-light.png) |

## What the pictures showed, and what was done

The first pass of this record showed two things no ticket had promised; both are fixed in this PR and the pictures above are the second pass.

- **Scout Queue rail.** The Scout chips were native grey boxes (`.railRow` had no button reset) and *Mute by name* was drawn struck through (the toggle tier's off look, on what is a disclosure). The rows are now text, the chosen one sapphire and bold, and *Mute by name* is a secondary button carrying `aria-expanded`.
- **Vault Backlinks pane.** The empty-state sentence was squeezed to a three-line column beside its Warrant. The First slot now lets the Warrant drop under the claim when the pane is narrow.
