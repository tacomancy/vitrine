# 0015: Mutation testing with Muter, as the substitute for MC/DC

**Status:** Proposed — becomes Accepted when the chore ticket shows Muter
running against Swift Testing on Xcode 26; otherwise superseded by a note
that no mutation tool fits.

## Context

ADR 0006 wanted MC/DC coverage and could not have it: `swiftc` emits no
branch coverage regions. `BACKLOG.md` parked mutation testing as the nearest
substitute "once there is core code to mutate". The core package now holds
`Library`, `NoteParsing`, and `Index` (issues #10, #19, #20), with the
watcher and incremental index (ADR 0014) coming — seams where a test that
passes by accident is exactly the failure mode MC/DC was meant to catch.

## Decision

Adopt **Muter** (muter-mutation-testing/muter) against the core package,
run as a separate, non-gating job: `Scripts/mutate.sh`, invoked by hand and
by a weekly CI schedule, never on every PR (mutation runs are minutes to
hours, and the macOS runner budget is finite — ADR 0006). The report is
uploaded as a workflow artifact; a survived mutant is a finding to triage,
not a red build. The acceptance condition for this ADR is that Muter drives
`xcodebuild test` with Swift Testing (`@Test`) tests and reports killed and
survived mutants correctly — verified by the chore ticket before this ADR
is marked Accepted.

## Consequences

- **+** Decision-level rigor the line-coverage gate cannot give, on the seams
  that matter, without touching the PR loop.
- **−** A tool dependency in `Scripts/`, not in the package — outside ADR
  0011's policy scope, but pinned the same way.
- **−** If Muter cannot see Swift Testing results, this ADR is superseded
  and the MC/DC intent stays parked; the chore ticket says which.
