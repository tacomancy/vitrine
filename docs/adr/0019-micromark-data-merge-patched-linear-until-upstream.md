# 0019: micromark's data merge is patched linear until upstream carries it

**Status:** Accepted

`outline()` runs synchronously inside the index build (ADR 0014), and #195/#196 found it quadratic in the lines of one paragraph: GFM's autolink literal registers its email construct on every letter, so micromark ends a `data` token at each word start, and micromark's own text resolver (`lib/initialize/text.js`, `resolveAllText`) merges the fragments with one `events.splice` per run — 32,000 unbroken lines took ~8 s. No extension can run a resolver before the initializer's, so the fix is to micromark itself: **a pnpm patch (`patches/micromark@4.0.2.patch`) rewrites the merge as a single pass** that copies kept events down and folds each fragment into the run before it. Same events, same offsets — checked against every Markdown file in the repo and the fixture corpus snapshots — and the 32,000-line paragraph outlines in ~0.4 s.

## Considered options

- **A worker for `outline()`.** Rejected for now: it bounds the freeze without removing the cost, and it is a § Index change — the build's transaction and the watcher's run would both have to cross a thread — for what a realistic vault never triggers. It stays the answer if some other per-file cost turns out to be unavoidable.
- **Dropping `gfmAutolinkLiteral`.** Rejected: a bare `https://example.com/bare` is a link (`outline.structure.test.ts`), and the locator should read Markdown as Obsidian does. (T3g, a `#` inside a bare URL's fragment, does not depend on it — the tag construct's `previous` rule already refuses a `#` after `/`.)
- **An email construct of our own that does not split words.** Rejected: micromark's authors already note (`micromark-extension-gfm-autolink-literal`) that the right shape is a pass over events afterwards, as `cmark-gfm` does; that is a rewrite of the extension, not of the resolver, and the resolver's cost is the whole problem.

## Consequences

- **+** Every micromark consumer in the app is linear per paragraph, gfm included, and `packages/markdown` needs no knowledge of the fix.
- **−** The patch pins to micromark 4.0.2 (`pnpm-workspace.yaml` `patchedDependencies`): a bump must re-derive it with `pnpm patch` — both `lib/` and `dev/` builds, since vitest resolves the `development` export condition — or drop it once the same change lands upstream (proposed as [micromark/micromark#233](https://github.com/micromark/micromark/pull/233)). The performance tests fail loudly if it silently stops applying.
