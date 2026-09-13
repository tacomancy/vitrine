# CODING_STANDARDS.md — Vitrine

The written bar for code in this repo. `/code-review` checks every diff
against it; a reviewer (human or agent) cites the rule by heading when they
flag something. Anything a linter or the compiler enforces is deliberately
not repeated here.

Language specifics assume Swift (ADR 0001). Everything else is
language-neutral.

## 1. Names come from the vocabulary

- A type, function, file, or test that names a domain concept uses the term
  as defined in `CONTEXT.md` — `Library`, not `Vault`; `Backlink`, not
  `IncomingLink`. If the concept isn't there, add it first (see `CLAUDE.md`).
- Reserved names (`CONTEXT.md` § Reserved) do not appear in v1 code outside
  the stub tabs (ADR 0005).
- No abbreviations that aren't already words (`config`, `id` fine; `lib`,
  `bl`, `mgr` not). No type suffixes that restate the type (`NoteStruct`,
  `TagArray`). No `Manager`, `Helper`, `Util`: name what the thing *does*.
- Booleans read as assertions: `isResolved`, `hasFrontmatter`, `canEmbed`.
- Functions that do something are verbs (`resolve(link:)`, `rebuildIndex()`);
  functions that answer something are nouns or questions (`backlinks(to:)`,
  `contains(tag:)`).

## 2. Shape: deep modules, small interfaces

Vocabulary from `.claude/skills/codebase-design/SKILL.md`.

- Each module hides a lot behind a little. The core package's public surface
  is a decision: `public` is opt-in, justified in a doc comment, and reviewed
  as an interface change. Everything else is `internal` or `private`.
- One seam per concern. Parsing, indexing, resolution, and search are
  separate modules with separate tests; a view never parses Markdown.
- No pass-through layers: a type that only forwards calls to another type is
  a smell, not a boundary.
- Prefer value types (`struct`, `enum`) for data and `final class` only where
  identity or shared mutable state is the point. No singletons; dependencies
  are passed in.
- A protocol earns its place by having two real conformers or by being a
  test seam agreed under `/tdd`. Not "in case".

## 3. Clarity over cleverness

- A function does one thing at one level of abstraction. If a name needs
  "and", split it.
- `guard` early, return early. Nesting deeper than two levels is a signal to
  extract.
- Explicit over implicit: named parameters, no default arguments that hide a
  meaningful choice, no operator overloading for domain logic.
- No force unwraps (`!`) or `try!` outside tests. No `as!`. Optionals are
  handled where they arise or converted to a typed error.
- Errors are typed: one `enum … : Error` per module, cases named for what
  went wrong from the caller's point of view, never `case unknown`.
- Concurrency is explicit: `actor` or `@MainActor` where state is shared;
  strict-concurrency warnings are errors.
- No `Any`, no stringly-typed keys, no magic numbers. A literal that means
  something gets a name.

## 4. Simplicity: build what the spec asks

- No speculative generality. No "future-proof" parameter, protocol, or
  configuration flag. If v2 needs it, v2 adds it (ADR 0003).
- Three similar lines beat a premature abstraction. Extract when the third
  real duplicate appears, not the second imagined one.
- Delete, don't disable. No commented-out code, no dead branches, no
  `#if false`.
- A `TODO` or `FIXME` must reference an issue: `// TODO(#42): …`. Without a
  number it doesn't merge.
- Dependencies are decisions: adding a package is an ADR.

## 5. Comments say why, not what

- The code says what it does. A comment explains what the code *can't*: the
  reason, the constraint, the surprise. If a comment restates the line below
  it, delete the comment or rename the code until it isn't needed.
- Every `public` symbol in the core package has a `///` doc comment: one
  sentence on what it is or does, then anything a caller must know
  (ordering guarantees, what counts as a match, what throws).
- Code that embodies a decision cites it: `// ADR 0002: the index never
  holds what the library doesn't.` One line, by number.
- Anything matching Obsidian's behavior on purpose says so, with the specific
  behavior: `// Obsidian resolves [[Title]] case-insensitively.`
- No changelog comments, author tags, or dates. Git has those.

## 6. Tests

Process rules live in `.claude/skills/tdd/SKILL.md`. These are the
conventions for what the tests look like once written.

- A test name is a sentence about behavior, in vocabulary terms:
  `backlinks_include_notes_that_link_via_alias`, not `testBacklinks2`.
- One behavior per test. Several assertions are fine when they describe one
  outcome; two setups in one test are two tests.
- Expected values are independent of the code under test: a literal, a
  worked example, a fixture file. Never recomputed with the same logic.
- Fixture libraries are real folders under the test target, including at
  least one produced by Obsidian itself. The filesystem is not mocked;
  tests use a temporary copy of a fixture.
- Tests run in any order and in parallel. No shared mutable state, no
  reliance on the working directory.
- The test framework is fixed by the project-layout ADR; until then these
  rules are framework-neutral.

## 7. Git: branches, PRs, and commits

- **Nothing is committed to `main` directly.** Every change — code, docs,
  tooling, a one-line fix — goes on a new branch, is pushed, and lands
  through a PR.
- **Branches** are `<type>/<short-kebab-slug>` — `feat/tag-tree`,
  `fix/alias-resolution`, `docs/adr-0006`. One spec issue per branch.
- **PR titles** are `<type>(<scope>): <imperative summary>` — the scope is
  optional and, when present, a module or area, not a file. The PR body
  links the spec issue and lists any `/code-review` findings declined, with
  the reason. This title becomes the merge commit, so it follows the same
  rules as a commit subject.
- **Commit subjects** follow the same `<type>(<scope>): <summary>` form,
  ≤ 72 characters, imperative mood, no trailing period.
- **Types** (the only ones):

  | Type       | Use when the change…                                        |
  |------------|-------------------------------------------------------------|
  | `feat`     | adds or changes user-visible behavior                       |
  | `fix`      | corrects behavior that was wrong against the spec           |
  | `refactor` | changes structure with no behavior change (tests unchanged) |
  | `test`     | adds or changes tests only                                  |
  | `docs`     | changes ADRs, `CONTEXT.md`, `BACKLOG.md`, comments, README  |
  | `chore`    | tooling, dependencies, CI, project settings                 |
  | `design`   | changes the design package or visual tokens                 |
  | `perf`     | improves performance with no behavior change                |

  When a change spans two types, the branch is too big: split it.

- A PR merges only after `/code-review` has run, tests pass, and the build
  has zero warnings.

## 8. Formatting and tooling

- `swift-format` with the committed configuration is the formatter; its
  output is not debated in review. (Configuration lands with the project
  scaffold.)
- Warnings are errors in CI. A warning that must be tolerated is suppressed
  at the narrowest scope with a comment saying why.
- One type per file, file named for the type. Extensions that add a
  conformance live in `Type+Protocol.swift`.
