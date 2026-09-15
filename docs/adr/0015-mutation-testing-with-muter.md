# 0015: Mutation testing with Muter, as the substitute for MC/DC

**Status:** Accepted — with the pin and the build configuration qualified
in the Update below.

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

## Update (2026-09-15, from the chore ticket, issue #43)

The acceptance condition holds, with two qualifications the ticket found
the hard way. `Scripts/mutate.sh`, `Scripts/muter.conf.yml`, and the
weekly `Mutation` workflow embody them.

- **The pin is a pull-request head, not a release or master.** No Muter
  release reads Swift Testing's failure output; master does (`7f1f258`,
  muter#306). But master also applies no mutants at all: muter#302 made
  the apply step re-parse each file, and the schemata mapping is keyed by
  SwiftSyntax node identity, so no lookup ever matches. The mutated copy
  differs from the source by a three-line header, every per-mutant run
  replays the unmutated build, and Muter reports 176 of 176 survived with
  a green exit — upstream issue muter#307, open. The head of muter#309
  (`5be334d`, on master's tip) fixes that and the nested-block and ternary
  defects behind it; it is pinned by SHA and fetched from the upstream
  repository, where GitHub keeps pull-request commits reachable. Move the
  pin to master when a fix merges; until then the fork's diff was read
  before it was trusted.
- **Warnings stay warnings in the schemata build.** The ticket asked for
  `Scripts/test.sh`'s warning-free configuration, and it cannot hold: a
  mutant is code with something removed, and the compiler warns about what
  is left — a `var` never mutated once its only mutating call is gone —
  so `SWIFT_TREAT_WARNINGS_AS_ERRORS=YES` fails the one build every run
  depends on. The mutation config drops both of `test.sh`'s warning
  overrides (unhidden warnings that are not errors would only lengthen
  the log) and keeps the scheme and destination; the code under mutation
  already passed the bar on its own PR.
- **Kills are read from the exit status.** Under `test-without-building`
  xcodebuild ends a failed run with `** TEST EXECUTE FAILED **`, which
  Muter's regex does not know, so every kill is labelled "runtime error"
  rather than "test failure". The count is right; the label is not.
- **A hung mutant costs the timeout.** A relational mutant in a scanner
  loop runs forever. The timeout is 90 s — four times the slowest
  finishing mutant here — and a timeout is listed separately in the
  summary, since Muter's score does not count it as killed.
- **The copy is staged.** Muter copies the whole directory it runs in to a
  sibling folder. From the repo root that would put `.git`, `build/`, and
  the local libraries beside the repo, so the script first stages tracked
  and unignored files under `build/mutation/` and runs there.

**First run** (`e7fa6e4`, 2026-09-15, 52 minutes on the development
machine): 176 mutants in 19 files; 154 killed, 14 survived, 8 timed out;
Muter's score 87 %.

| Target         | Mutants | Killed | Survived | Timed out |
|----------------|--------:|-------:|---------:|----------:|
| Library        |      14 |     14 |        0 |         0 |
| NoteParsing    |     100 |     88 |        4 |         8 |
| Index          |      43 |     37 |        6 |         0 |
| LibraryWatcher |      19 |     15 |        4 |         0 |

Thirteen survivors are test gaps, filed as #56–#63; one is declined
(`FileEventStream.swift:81`, a guard against paths FSEvents never reports
for a stream on that root — unobservable through the seam). Two are worth
naming: the depth tie-break in link resolution (ADR 0016) has a test that
passes for another reason (#57), and `ChangeTranslator`'s memory across
batches — the reason the class exists — is never consulted twice (#60).

**Budget.** A run is about fifty minutes of macOS runner time, weekly.
The repository is public, so those minutes are free — ADR 0006's budget
arithmetic was for a private one — and the constraint is a runner
occupied, not minutes spent. The workflow caches the Muter binary, caps
the job at 150 minutes so a hung run cannot hold a runner for hours, and
runs only on schedule and by hand; the schedule is the first knob if the
repository ever goes private again.
