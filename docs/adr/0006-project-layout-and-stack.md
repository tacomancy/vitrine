# 0006: Xcode project over a local Swift package; the stack in detail

**Status:** Accepted

## Context

ADR 0001 fixed Swift + SwiftUI and a UI-free core package but deferred the
project's physical shape, minimum OS, test framework, and tooling. Nothing can
be scaffolded until those are fixed, and `CODING_STANDARDS.md` § 6 and § 8
explicitly wait on this ADR. Facts at decision time: the development machine
runs macOS 26.6 with Xcode 26.6 (Swift 6.3, toolchain-bundled `swift format`);
GitHub's `macos-26` runner image ships the identical Xcode build; the repo is
private; the app is not destined for the App Store.

## Decision

**Shape.** `Vitrine.xcodeproj` at the repo root holds one app target whose
sources live in `App/` as an Xcode *synchronized folder* (no per-file
references in the project). All non-UI code lives in a local Swift package at
`VitrineCore/`, referenced by path. Not SwiftPM-only (no real `.app` bundle
without hand-rolled scripts) and not a generated project (a tool dependency
that solves a problem synchronized folders already solve).

```
Vitrine.xcodeproj/        project; shared scheme "Vitrine" committed
App/                      app target — VitrineApp.swift, ContentView.swift,
                          Assets.xcassets, Vitrine.entitlements
VitrineCore/              Package.swift, Sources/<Target>/, Tests/<Target>Tests/
Configs/                  Shared.xcconfig, Debug.xcconfig, Release.xcconfig
.swift-format
Scripts/coverage-gate.sh
.github/workflows/ci.yml
```

**Modules.** A Swift module is a SwiftPM target. `VitrineCore` is one package
with one target per seam (parsing, indexing, resolution, search — as
`CODING_STANDARDS.md` § 2 requires), each named in `CONTEXT.md` vocabulary and
added by the spec that needs it. The app imports each target it uses; there is
no umbrella module. The scaffold ships a single placeholder target, also named
`VitrineCore`, whose only job is proving the build and the red→green loop; the
first feature ticket deletes it.

**Platform.** Minimum macOS **26**. No `#available` gating in v1.

**Compiler.** Swift 6 language mode everywhere (complete concurrency
checking). Warnings are errors locally, not only in CI: `SWIFT_TREAT_WARNINGS_AS_ERRORS`
for the app, `.treatAllWarnings(as: .error)` in `Package.swift`. Default actor
isolation is `MainActor` in the app target and explicitly `nonisolated` in
the package. `swift-tools-version: 6.2` — the lowest version with both of the
above.

**Settings live in `.xcconfig`, not in the `pbxproj`.** `Configs/Shared.xcconfig`
carries every build setting this ADR decides — bundle id, deployment target,
language mode, warnings-as-errors, default isolation, hardened runtime,
signing — one commented line each. `Debug` and `Release` include it and add
only what differs. The `pbxproj`'s own build-settings blocks stay near-empty.

**Identity and signing.** Bundle identifier `com.tacomancy.vitrine`. Ad-hoc
("Sign to Run Locally") signing. Hardened runtime on. **App Sandbox off**: the
app's whole job is reading a folder the user pointed it at, and the
security-scoped-bookmark plumbing the sandbox demands would touch every
file-handling seam for no App Store in return. Obsidian makes the same choice.
No other entitlements.

**Tests.** Swift Testing (`@Test`, `#expect`, `@Suite`). XCTest only for UI
automation or `measure` performance tests, and only when a spec asks. Naming
and fixture conventions are in `CODING_STANDARDS.md` § 6.

**Formatting and lint.** The toolchain's `swift format` with `.swift-format`
at the repo root, 4-space indentation; `swift format lint --strict` is the
only linter. No SwiftLint.

**CI.** One GitHub Actions workflow, one job on `macos-26`, triggered by
**pull requests to `main` only** — no push trigger, so branch check-ins cost
nothing and what is verified is the PR head. Steps: format lint, then
`xcodebuild test -scheme Vitrine -enableCodeCoverage YES` (app and package
tests, warnings as errors), then the coverage gate. The check is a required
status on `main`, with direct pushes blocked — `CODING_STANDARDS.md` § 7
enforced by the remote.

**Coverage.** Line (region) coverage of the `VitrineCore` package must be at
least **90 %**, measured over the whole package per PR, not per file. The
gate is a committed script, `Scripts/coverage-gate.sh`, that reads the
`.xcresult` with `xcrun xccov view --report --json`, compares against a
named threshold constant at the top of the file, and fails the job; the
report is uploaded as a workflow artifact. No coverage service. The app
target is measured but not gated: it is thin SwiftUI, awkward to unit-test
and deliberately logic-free (ADR 0001).

**MC/DC was wanted and is not available.** `swiftc` emits no branch
coverage regions, so `llvm-cov` reports `0/0` branches for Swift and MC/DC —
which builds on branch data — cannot be computed (swiftlang/swift#81730,
#86406). Decision-level rigor comes from the TDD discipline instead
(red-first, one behavior per test). Mutation testing (Muter) is the nearest
substitute for MC/DC's purpose and may be its own ADR once there is code to
mutate. The MC/DC intent is parked in `BACKLOG.md` § Open questions so it is
revisited if the toolchain changes.

**Scaffold scope.** The scaffold is: an app that launches to an empty
`ContentView` (no copy, no styling), the placeholder package target with one
test written red then green, the xcconfigs, the formatter config, the CI
workflow with its coverage gate, and a `.claude/launch.json` for `/run`. It does **not** translate
design tokens, bundle fonts, choose an appearance, or add the tab strip —
those are the first real screen's work (ADR 0004, 0005). It names no
third-party libraries; each is its own ADR when a spec needs it.

**Small things, stated once.** No localization in v1 — plain English
literals, no String Catalog. `Info.plist` is generated from build settings,
not committed. Version `0.1.0`, build `1`, bumped by hand until v1 ships as
`1.0.0`.

**Authorship of the project file.** An agent writes `project.pbxproj` by hand;
no human wizard step. In exchange it must stay human-readable: synchronized
folders keep file references out, xcconfigs keep settings out, and what
remains is one project, one target, one group, one package reference.

## Consequences

- **+** `git clone`, open in Xcode, build — with nothing to install. `swift
  test` in `VitrineCore/` exercises all logic without Xcode at all.
- **+** Every build decision is one greppable, commented line in a text file.
- **+** CI and the local machine run the same Xcode build, so "works here" is
  "works there."
- **−** macOS 26 only. Accepted: a personal tool with no named older-Mac user.
- **−** Sandbox off means turning it on later is a migration (stored paths →
  bookmarks). Accepted for the reasons above.
- **−** Building against the 26 SDK opts the window chrome into Liquid Glass
  regardless of deployment target. Reconciling that with the brief's dark
  custom look belongs to `docs/visual-implementation.md` (ADR 0004).
- **−** A private repo pays 10× for macOS runner minutes; a free plan's
  allowance is ~200 macOS minutes/month. PR-only triggering keeps that to
  one run per push to an open PR; watch it.
- **−** The 90 % floor is on lines, which says nothing about whether each
  condition in a decision was exercised. Accepted as the best the toolchain
  offers; see BACKLOG.
- **Hygiene, `pbxproj`:** Xcode re-serializes the file when it feels like it.
  That diff is reviewed like code; a change that adds explicit file references
  or moves a setting out of an xcconfig is reverted.
- **Hygiene, verification:** `xcodebuild -list` and a green CI run are the
  machine check on the hand-written project. The scaffold ticket's definition
  of done also includes a human opening it in Xcode once and confirming it
  presents as an ordinary project — targets, scheme, package resolved, empty
  issue navigator.
- Window and scene architecture is fixed separately in ADR 0007.
- Still open in `BACKLOG.md` and untouched here: index storage, editor
  approach, external-edit handling, sidecar name, appearance, fonts.

## Update (2026-09-13, from the scaffold)

Three things the toolchain refused, found while building issue #3:

- **Package warnings-as-errors moved out of `Package.swift`.** Xcode 26
  compiles local package targets with `-suppress-warnings` — package warnings
  are invisible in Xcode builds — and rejects `.treatAllWarnings(as: .error)`
  as a conflicting option, so the project would not build at all with it.
  Enforcement is now `Scripts/test.sh`, which passes
  `SWIFT_SUPPRESS_WARNINGS=NO SWIFT_TREAT_WARNINGS_AS_ERRORS=YES` to
  `xcodebuild`; those reach every target. CI and humans call that script,
  so the local command is the CI command; `Scripts/run.sh` (what `/run`
  calls) builds with the same overrides. The app target keeps
  warnings-as-errors in its xcconfig as decided. Xcode's GUI still hides
  package warnings; `swift test` in the package shows them but does not fail.
- **The `pbxproj` holds the package twice.** An `XCLocalSwiftPackageReference`
  alone lets the app link the product, but `xcodebuild test` then cannot find
  the package's test target ("no test bundles available"). A folder reference
  to the package under a `Packages` group — what Xcode itself writes when a
  local package is added — makes its targets part of the project graph. The
  scheme also lists the test target in its build action with
  `buildForTesting`. The permitted object set is therefore, in full: the
  project; the `Vitrine` native target with empty Sources, Frameworks, and
  Resources phases; the `App/` synchronized root group; the `Packages` group
  holding the package folder reference; the `Configs` group holding the three
  xcconfig file references; the `Products` group holding the app product
  reference; the local package reference and its product dependency (plus
  the build-file entry that links it); and two configuration lists whose four
  configurations carry no settings of their own. Nothing else — no
  tool-version stamps, no per-file references.
- **Hardened runtime is declared, not active.** Xcode forces
  `ENABLE_HARDENED_RUNTIME` to `NO` while the signing identity is `-`. The
  xcconfig keeps `YES` as intent; it becomes live the day a Developer ID is
  configured. There is nothing to notarize without one, so nothing is lost.

## Update (2026-09-13, from the Library seam)

A fourth thing the toolchain does its own way, found once the package had
real sources:

- **The gate finds the package by source path, not by target name.**
  `xccov` files a package's sources under its own target on some runs and
  only under its test target on others — the module is statically linked
  into the test bundle — so a gate that picked "the package" by target
  name sometimes measured nothing and passed vacuously at `100% (0/0)`.
  `Scripts/coverage-gate.sh` now sums every file under
  `VitrineCore/Sources/` across all targets, keeping one entry per path
  (both targets report identical counts when both are present). A total
  of zero executable lines now fails the gate instead of counting as 100 %:
  the package has real sources, so zero means the report is not shaped as
  the script expects, and a gate that passes without measuring is the bug
  this fixes. The decision above — line coverage of the whole package,
  ≥ 90 %, read from the `.xcresult` — is unchanged; what changed is how
  the script identifies the package's lines and what it does when it
  finds none.

## Update (2026-09-13, from the Index seam)

- **One test-support target, `Fixtures`, holds the fixture libraries.**
  "One target per seam" governs `Sources/`; a target that exists only so
  two test targets can share the same on-disk vault is not a seam. SwiftPM
  resources belong to exactly one target, and the Obsidian fixture — the
  vault the owner blesses by opening it in Obsidian — must be one folder,
  not a copy per test target that drifts. `Fixtures` lives at
  `VitrineCore/Tests/Fixtures/` (declared with `path:`), ships the fixture
  libraries as `.copy` resources, exposes the two helpers every fixture
  test needs (locate a fixture, take a temporary copy), and is depended on
  by every test target that opens a library. Under `Tests/`, it is outside
  the coverage gate by construction (the gate sums `Sources/` only). No
  other support target is implied: the next shared test helper argues for
  itself.

## Update (2026-09-13, from the Tags screen)

- **The app links one product per seam it reads, each a product
  dependency in the `pbxproj`.** The permitted object set above names "its
  product dependency (plus the build-file entry that links it)" in the
  singular because the shell read only `Library`. The Tags screen reads
  `Index` too, so the project now carries an `XCSwiftPackageProductDependency`
  and its `PBXBuildFile` for each — the same two objects, once per product
  the app imports. Nothing else in the set changes; a seam the app does not
  read (`NoteParsing`, reached only through `Index`) is not linked.

## Update (2026-09-15, from the Rendering seam)

- **Warnings-as-errors is resolved per target, and swift-markdown is
  exempt.** The command-line override above reaches every target, and
  "every target" includes the dependencies. swift-markdown (ADR 0019)
  builds in the Swift 5 language mode and carries `Sendable` warnings of
  its own — three, in types Vitrine never touches — which the override
  turned into errors and a red build. The diagnostic belongs to no group,
  so SE-0443's `-Wwarning` cannot single it out. `Scripts/test.sh` and
  `Scripts/run.sh` now pass
  `SWIFT_TREAT_WARNINGS_AS_ERRORS=$(VITRINE_WARNINGS_AS_ERRORS_$(TARGET_NAME):default=YES)`
  with `VITRINE_WARNINGS_AS_ERRORS_Markdown=NO`: YES for every target
  unless a setting names it, and one does for swift-markdown's Swift
  target. Its warnings still print; Vitrine's own targets are in the
  Swift 6 language mode, where the same diagnostics are errors regardless.
  The decision — zero warnings in Vitrine's code, enforced by the one
  verification command — is unchanged; what changed is that a third
  party's warnings are not Vitrine's to fix.
