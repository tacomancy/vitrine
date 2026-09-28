# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |
| — (this repo only)         | `ready-for-implementation` | A published spec, waiting for `to-tickets` |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

**A spec is never `ready-for-agent`.** `to-spec` publishes it with `ready-for-implementation`; `ready-for-agent` is for the tickets `to-tickets` cuts from it, which are what an agent actually picks up. A spec labelled `ready-for-agent` reads as a single grabbable job, and it is the opposite — the parent of several. `Scripts/check-guidance.sh` fails if the vendored `to-spec` skill stops saying so, since a re-vendor from upstream would put `ready-for-agent` back.

Edit the right-hand column to match whatever vocabulary you actually use.
