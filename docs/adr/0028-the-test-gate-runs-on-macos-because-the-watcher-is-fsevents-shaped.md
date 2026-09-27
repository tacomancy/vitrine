# 0028: The test gate runs on macOS, because the Watcher is FSEvents-shaped

**Status:** Accepted

CI ran the `test` job on `ubuntu-latest`, which is not a platform Vitrine has. The app ships macOS-only (`electron-builder --mac --dir`, arm64) and its Watcher is built on recursive `fs.watch` — chosen precisely because on macOS that is libuv's FSEvents backend — ADR 0013 decision 2. On Linux the same call is a different mechanism: Node's non-native JS watcher (`internal/fs/recursive_watch`), which walks the tree and holds one inotify watch per file. Every app write to a page is temp file + `rename` (`writeAtomically`, the single write path in `vault-files.ts`), which on Linux **replaces the inode and orphans that file's watch**; Node re-attaches only through a race between its delete branch and the parent directory's re-walk, and when that race is lost the path goes permanently and totally deaf. Measured on `ubuntu-latest`: after one atomic replace, 0/20 for each of three further in-place writes *and* 0/20 for a further atomic replace, while the directory watcher emits nothing for a child it already knows. A test that then edits that page from outside and waits on the event stream waits forever and dies at Vitest's 5 s default — which is how #284, a test-only change touching nothing in the area, went red on `position-history.pending.test.ts`. So: **the `test` job moves to `macos-latest`** (#292, #293). The `guidance` job stays on `ubuntu-latest`.

This is a CI defect, not a product bug. On macOS FSEvents loses nothing — 0/40 in the same probe. What Linux was buying was a gate whose Watcher coverage was partly fictional and whose failures were timeouts that named nothing.

## Decisions

1. **The `test` job runs on `macos-latest`.** The gate runs the only platform the product ships on, and the one ADR 0013 designed the Watcher for. The alternative is a gate that cannot observe the behaviour it asserts.
2. **The job keeps its name and its steps.** Branch protection on `main` names the required check by job name, so keeping `test` means no protection edit and no window in which the gate is absent. Checkout, `pnpm/action-setup`, `setup-node` with Node 24 and `cache: pnpm`, `pnpm install --frozen-lockfile --ignore-scripts`, then `pnpm lint`, `pnpm typecheck`, `pnpm test` — unchanged. `--ignore-scripts` still keeps Electron's binary out of the install.
3. **`guidance` stays on `ubuntu-latest`.** It runs a shell script over the repo's own text and has nothing to gain from a Mac.
4. **No production and no test code changes.** `PROBE_TIMEOUT_MS` stays 5000, `watchVault` is untouched, `writeAtomically` stays temp file + rename, and the three at-risk tests in `position-history.pending.test.ts` — an app write to a page, an external edit to the same page, a wait on the event stream — stay exactly as written. They are the regression test: they were the ones failing, and the gate is that they pass unmodified on the new runner — seen green twice before this merges, since a single green run on a change whose whole subject is a race proves little.
5. **The reason lives in the workflow as well as here.** `ci.yml`'s header comment names FSEvents, ADR 0013 and the macOS-only packaging, because the next reader's first instinct on seeing a macOS runner is the 10x minutes.

## Considered options

- **Raise `testTimeout`,** per project or globally. Rejected, and worth remembering why: the wait is on an event that never arrives, so a longer timeout hangs longer and still fails, while making every genuine hang slower to surface. No `testTimeout` is added to either Vitest config.
- **Change `PROBE_TIMEOUT_MS`.** Rejected — and this is not the collision #269 fixed for two tests in `vault-watcher.test.ts`. That one was real (the probe's bound and Vitest's default really are both 5000), but the probe proves the vault *root* live and never touches a page's per-file watch; this failure is a page going deaf long after the root is up. #272 pinned the constant out of scope for test-timing work, and it stays 5000.
- **Skip, quarantine or loosen the at-risk tests.** Rejected: it buys a green check by deleting the coverage the green check is supposed to mean. Decision 4.
- **Make `watchVault` re-watch after an own write.** Rejected: production code bent around a platform the app does not ship on.
- **Audit the eighteen core test files that open a vault and write to it for the same shape.** Not needed — moving the runner removes the hazard for all of them at once. `position-history.pending.test.ts` is the most exposed file because its `obsidian()` helper makes the shape easy to write, not the only one that could hold it.
- **Support Linux as a platform.** Not implied by anything here. If it is ever wanted, the Watcher needs its own design for inotify and this stops being a CI question.

## Consequences

- **+** A green `test` check comes to mean the code works on the platform Vitrine ships on, and the Watcher coverage ADR 0013's design depends on becomes real rather than nominal.
- **+** A CI failure is reproducible from a developer's machine, because CI and local now run the same `fs.watch` implementation. The reason this never reproduced locally was that local and CI were running entirely different watchers.
- **−** macOS runners bill at 10x Linux minutes. On a suite well under a minute with one required test job per PR, that is a small absolute cost, taken deliberately.
- **−** The evidence for all of this lives in this ADR and in #292 rather than in the repository: the probes ran on a throwaway branch (`test/recursive-watch-repro`, deleted). The most useful of them instrumented the watcher during a *passing* Linux run and found the external edit producing no event at all — the test passed only because the settled batch the app's own write had already opened read the file late enough to see the new content. That accident is what stood between the suite and a red build, and it was load-dependent.
- A bounded `EventStream.next()` in `test-core.ts`, so a lost event fails as "no `vaultChanged` arrived" rather than a bare Vitest timeout, is the honest follow-up on the no-silent-failures invariant. It makes such a failure legible rather than preventing it, so it is a separate concern from which platform the gate runs on.
