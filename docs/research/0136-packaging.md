# Packaging an electron-vite app for daily local use

Research input to the beat-13 grill (#136, part of #131). Primary sources only:
electron-builder's docs and source, Electron Forge's docs, `@electron/packager` and
`@electron/osx-sign` source, electron-vite's distribution guide, Electron's own docs
and source, pnpm's docs, and Apple's documentation plus Apple DTS answers on the
Developer Forums where Apple's documentation is silent. Ends with a comparison and
one recommendation; decides nothing — that is the grill's job.

Checked 2026-09-20 against electron-builder 26.16.1 (docs site labels v27 "next"),
Electron Forge 7.x, Electron ^44 (`packages/shell/package.json`), pnpm 12.4.2.

## The question

Beat 13 makes the app installable for one user, daily. Compare electron-builder and
Electron Forge against the existing layout — core spawned as a file from
`packages/core/dist`, never bundled (ADR 0005; `docs/architecture.md` § Build and dev) —
on: carrying an unbundled sibling package, ad-hoc vs Developer ID signing, whether
Gatekeeper blocks an unsigned local build, whether notarization is needed for a
self-installed app, and the cheapest auto-update path (or none). Recommend the minimum
that gives a dock icon and survives a reboot.

## What the shell needs at runtime (from the code, not the docs)

`packages/shell/src/main/index.ts`:

- `CORE_ENTRY = join(__dirname, "../../../core/dist/main.js")` — from `out/main/`, that is
  `packages/core/dist/main.js`. The comment says it is "the shell's only runtime tie to the
  core"; the `core` entry in `devDependencies` is type-only. **A packaged app has no
  `packages/core` three directories up**, so this path must become conditional on
  `app.isPackaged` whatever tool is chosen.
- `utilityProcess.fork(CORE_ENTRY, [], { env: { VITRINE_STATIC_DIR: RENDERER_DIR } })` —
  the core is an ESM package (`"type": "module"` in `packages/core/package.json`) with six
  runtime `dependencies` (hono, `@hono/node-server`, `@hono/trpc-server`, `@trpc/server`,
  yaml, zod). So the thing to carry is not one file: it is `dist/` plus a resolvable
  `node_modules` beside it.
- `RENDERER_DIR = join(__dirname, "../renderer")` — the core, not the shell, serves the
  renderer bundle, so the core process must be able to read the shell's `out/renderer`.
- The shell itself has **no production dependencies**; everything is `devDependencies`.
  Its `main` is `./out/main/index.js`.

Two consequences frame everything below: the core needs a self-contained directory
(dist + deps) somewhere the packaged shell can find, and the core has to read files the
packager put next to the shell.

## electron-vite's own guidance

electron-vite documents both tools ([Distribution](https://electron-vite.org/guide/distribution)):

- For electron-builder: an `electron-builder.yml` with `files` excluding `src`, the vite
  config and dotfiles; `asarUnpack: [resources/**]`; and `main` left at electron-vite's
  output.
- For Forge: the same via `packagerConfig.ignore`, **plus** a warning that matters here:
  "Electron Forge's default output directory is `out` and forbids to override, which
  conflicts with electron-vite. So we can set `outDir` to `dist`." Forge's own docs
  confirm: "You can not override the `dir`, `arch`, `platform`, `out` or
  `electronVersion` options as they are set by Electron Forge internally"
  ([Configuration](https://www.electronforge.io/config/configuration.md)). Our
  `electron.vite.config.ts` writes to `out/`; picking Forge means moving it.
- ASAR: "There are some Node APIs that do not support executing binaries in ASAR
  archives, such as `child_process.exec`, `child_process.spawn`", and referenced binaries
  or native modules should be kept out of the archive. The core is a JS entry run by
  `utilityProcess.fork`, not a spawned binary, so this is a caution, not a blocker (see
  "Does the core need to be outside the asar?" below).

## electron-builder

### Carrying the core

Two mechanisms, both documented on [App Contents](https://www.electron.build/docs/contents):

- `extraResources` — "copy the file or directory with matching names directly into the
  app's resources directory (`Contents/Resources` for MacOS)". `from` is "relative to
  project dir for `extraResources` / `extraFiles`", `to` is relative to the resources dir,
  and the app reads them "via `process.resourcesPath`". A FileSet `from: ../something`
  is legal — the same page shows `from: ../shared/assets` under "Copying from Outside the
  App Directory" (for `files`, whose base is the app dir; `extraResources` uses the project
  dir but the same FileSet type).
- `files` FileSets can also pull from outside the app directory into the asar, but the
  core would then live inside `app.asar`, which is the case to avoid (below).

Production dependencies: electron-builder only copies production `dependencies` of the
app's `package.json` — "Development dependencies are never copied in any case" — and it
resolves them with a package-manager-aware collector. The pnpm collector
(`packages/app-builder-lib/src/node-module-collector/pnpmNodeModulesCollector.ts`) runs
`pnpm list --prod --json --depth Infinity`, detects the isolated `.pnpm` store by
`realpath`, follows `link:` workspace packages to their real directory ("Resolving the
link is what Node itself does"), and recovers dependencies that `pnpm list --prod` omits
for `link:` packages. So promoting `core` from `devDependencies` to `dependencies` in the
shell *would* make electron-builder pack it (into the asar, as `node_modules/core`) with
its dependencies — but that puts the core inside `app.asar` and ties the shell's
`package.json` to a runtime it deliberately does not import. It is the mechanism to know
about, not the one to use.

### Signing

[macOS signing](https://www.electron.build/docs/features/code-signing/code-signing-mac):

- Default: "a valid and appropriate identity from your keychain will be automatically
  used. If no valid certificate is found, signing is skipped for all architectures —
  electron-builder does not apply an ad-hoc signature automatically."
- `mac.sign.identity` table: not set → keychain search, skipped if none; `null` → skipped
  entirely; `"-"` → ad-hoc; a name → that certificate. (In v26 the key is `mac.identity`;
  the notarization page notes "the signing options ... moved under `mac.sign` in v27".)
- Ad-hoc caveat, verbatim: "Because Electron's pre-built frameworks carry Apple's Team ID,
  ad-hoc signing requires one of the following to prevent an app launch failure: Add the
  `com.apple.security.cs.disable-library-validation` entitlement to your entitlements file
  — preferred, keeps hardened runtime active. Set `mac.sign.hardenedRuntime: false`."
  Also "Electron Framework crash: add the `com.apple.security.cs.allow-jit` entitlement,
  which Electron requires."
- Their own recommendation table: "Local dev, no certificate → leave identity unconfigured
  or set `mac.sign.identity: null`"; "Local dev, want a runnable ad-hoc build →
  `mac.sign.identity: "-"` + `com.apple.security.cs.disable-library-validation`
  entitlement"; "CI/production distribution → Developer ID certificate".
- `forceCodeSigning: true` turns a missing identity into a build failure instead of a
  silently unsigned build.

### Notarization

[Notarization](https://www.electron.build/docs/features/code-signing/notarization):
`mac.notarize: true` plus `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` (or an
App Store Connect API key, or a keychain profile). Prerequisites: "An active Apple
Developer Program membership ($99/year)", "A Developer ID Application certificate",
Hardened Runtime, and at minimum the `allow-jit` and `allow-unsigned-executable-memory`
entitlements. Stapling is automatic. None of this is reachable without the paid program.

### Updates

[Auto Update](https://www.electron.build/docs/features/auto-update): "Code signing is
required on macOS — macOS application must be signed in order for auto updating to work."
Default mac targets are "dmg + zip" because "zip target for macOS is required for
Squirrel.Mac, otherwise `latest-mac.yml` cannot be created". Providers: GitHub Releases,
S3, generic HTTP, and others. Two lines of `electron-updater` in the main process.

### Output and icon

- `electron-builder --dir` — "Build unpacked dir. Useful to test." — produces the `.app`
  without a DMG or ZIP. For one self-installing user, dragging that `.app` to
  `/Applications` is the install.
- Icon ([Icons & Images](https://www.electron.build/docs/features/icons-and-images)):
  "A single `icon.svg` or `icon.png` in your `build/` directory is enough"; macOS accepts
  `.svg`, `.png`, `.icns`, minimum 512×512, recommended 1024×1024 or SVG; "SVG icons are
  rasterized at 1024px before conversion". `docs/reference/branding/assets/mark-*.svg` is
  the source (frozen tier: copy, never edit).
- `asar` is on by default with `smartUnpack: true`; `asar: false` "places all files in
  the app directory directly".

## Electron Forge

### Carrying the core

`@electron/packager`'s `extraResource` (`src/types.ts`): "One or more files to be copied
directly into the app's `Contents/Resources` directory for macOS target platforms ...
referenced in the packaged app via `process.resourcesPath`". Equivalent to
electron-builder's `extraResources`, string paths only (no `from`/`to`/`filter` FileSet).

Production dependencies: Forge's [Getting Started](https://www.electronforge.io/readme.md)
warns, verbatim: "When packaging your Electron app, Forge crawls your project's
`node_modules` folder to collect dependencies to bundle. Its module resolution algorithm
is naive and doesn't take into account symlinked dependencies ... If you are using pnpm,
please set `node-linker=hoisted` in your project's `.npmrc` configuration." pnpm support
itself dates from Forge 7.7.0. Our workspace uses pnpm's default isolated layout (there is
no `.npmrc`; `pnpm-workspace.yaml` only sets `allowBuilds`). Hoisting is a
workspace-wide switch that changes how every package resolves modules, to satisfy a
tool whose job here is to copy one directory.

### Signing and notarization

[Signing a macOS app](https://www.electronforge.io/guides/code-signing/code-signing-macos.md):
signing happens "at the Package step by the `electron-packager` library" through
`packagerConfig.osxSign`, which must exist "even if empty"; `osxNotarize` takes the
same three credential shapes as electron-builder and "Requires the `osxSign` option to be
set" (`@electron/packager` `src/types.ts`).

`@electron/osx-sign` (`src/sign.ts`): with no `identity`, it searches the keychain for
`Developer ID Application:` and **throws** "No identity found for signing." — there is no
silent skip; leaving `osxSign` out is how you skip. With an explicit identity it
validates it against the keychain unless `identityValidation: false`; ad-hoc is therefore
`osxSign: { identity: "-", identityValidation: false }` plus the same entitlements
electron-builder documents. Forge's docs do not describe an ad-hoc path; it is a
composition of packager and osx-sign options.

### Updates

[Auto Update](https://www.electronforge.io/advanced/auto-update.md): "having a signed
application is a pre-requisite for using auto updates on macOS." Cheapest path for
open-source repos on GitHub is `update.electronjs.org` via the GitHub publisher and
`update-electron-app` — "around 2 lines of code and a few lines of configuration" — but
still behind Developer ID signing.

### Forge via electron-builder makers

electron-builder ships Forge makers, but its own page says
([Electron Forge](https://www.electron.build/docs/features/electron-forge)): "Publishing,
Auto Update, and Code Signing are only available when using electron-builder as your
primary build tool. If you need any of those features, migrate fully to electron-builder
rather than using these makers." Not a middle path worth taking.

## The no-tool baseline: Electron's manual packaging

Electron's own [Application Packaging](https://github.com/electron/electron/blob/main/docs/tutorial/application-distribution.md)
documents packaging by hand: download the prebuilt `Electron.app`, put the app folder at
`Electron.app/Contents/Resources/app/` (with `package.json`, entry, assets), rename the
bundle, and edit `CFBundleDisplayName`, `CFBundleIdentifier`, `CFBundleName` in
`Contents/Info.plist` and the helper's `Info.plist`. Electron recommends Forge instead,
but this is the floor: a dock icon is an `.icns` in `Contents/Resources` plus a
`CFBundleIconFile` key, and a `.app` in `/Applications` survives a reboot because it is a
directory on disk. Anything a tool adds beyond this is convenience (icon conversion,
plist editing, signing, DMG) — useful to know when weighing the two tools' setup cost.

## Staging the core: pnpm deploy

Whichever tool copies the directory, pnpm can produce it.
[`pnpm deploy`](https://pnpm.io/cli/deploy): "the files of the deployed package are
copied to the target directory. All dependencies of the deployed package, including
dependencies from the workspace, are installed inside an isolated `node_modules` directory
at the target directory. The target directory will contain a portable package that can be
copied to a server and executed without additional steps." `--prod` skips
`devDependencies`. Since pnpm 12.2.0 it no longer needs `injectWorkspacePackages`.

`pnpm --filter core --prod deploy packages/shell/stage/core` yields exactly the
"dist plus resolvable node_modules" the shell needs, and turns the "unbundled sibling
package" problem into "copy one directory into `Contents/Resources`" for either tool.
Two details: `pnpm deploy` copies the package's publishable files, so `packages/core`
wants a `"files": ["dist"]` entry (it has none today, so `src/` would ride along); and
the deploy needs to run after `pnpm --filter core build`, as `pnpm dev` already does.

## Does the core need to be outside the asar?

Electron's `OnNodePreload` (`shell/common/node_bindings.cc`) runs `lib/node/init.ts` —
"init bundle (asar, child_process hooks)" — for every Node environment Electron creates,
and `lib/node/init.ts` begins with `wrapFsWithAsar(require('fs'))`. So a utility process
*can* `fs.read` inside `app.asar` (the core reading `out/renderer` from the archive would
work), and `utilityProcess.fork` of an entry inside the asar is the same kind of read.
That is a source-level inference, not a documented guarantee; Electron's
[ASAR limitations](https://github.com/electron/electron/blob/main/docs/tutorial/asar-archives.md)
page only names `child_process.exec`/`spawn` as unsupported and `execFile` as needing a
temp-file unpack.

The simpler position for a one-user build: keep the core in `Contents/Resources/core`
(outside the asar by construction) and either set `asar: false` so `out/renderer` is
plain files too, or leave asar on and accept the inference. `asar: false` removes the
question entirely and costs nothing the brief cares about — asar exists for "faster
loading" and "to prevent casual file inspection" (electron-builder, App Contents), neither
a goal for a local-first tool the user built herself.

## Signing, Gatekeeper, notarization — what Apple actually requires

Three different mechanisms get conflated. Separating them is what makes "minimum"
answerable.

**1. Apple silicon will not execute unsigned native code — but ad-hoc counts.** Apple's
DTS engineer (Quinn "The Eskimo!", Apple staff) on the Developer Forums: "By default Macs
will run ad hoc signed code. This is equivalent to Sign to Run Locally in Xcode"
([thread 737571](https://developer.apple.com/forums/thread/737571)); elsewhere the same
author: Apple silicon Macs require that all code be signed in some way, and the linker's
ad-hoc signature satisfies it. Electron's prebuilt binaries arrive already signed (the
"different Team IDs" failure electron-builder documents is precisely because Electron's
frameworks carry Apple's Team ID), so an electron-builder build with signing skipped
still has signed executables — only the bundle seal no longer matches its edited
resources, which the kernel does not enforce for execution. Both electron-builder ("On
Apple Silicon, unsigned apps can still be run locally") and Electron ("an unsigned or
ad-hoc signed app may behave inconsistently" — for specific APIs, below) treat unsigned
local builds as runnable.

**2. Gatekeeper evaluates quarantined items.** Apple Platform Security Guide,
[Gatekeeper and runtime protection](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web):
"By default, Gatekeeper helps ensure that all *downloaded* software has been signed by the
App Store or signed by a registered developer and notarized by Apple" and "When a user
downloads and opens an app ... from outside the App Store, Gatekeeper verifies that the
software is from an identified developer, is notarized ..." (emphasis added). Apple DTS,
[thread 666452](https://developer.apple.com/forums/thread/666452): "Gatekeeper usually
only kicks in [when] the app is quarantined, and thus you can either use a download
mechanism that doesn't quarantine the download or unquarantine the app before running
it"; "Most Unix-y tools don't quarantine their downloads, including curl and scp." A
`.app` produced by a build on this Mac and moved to `/Applications` with Finder or `mv`
never acquires `com.apple.quarantine`. **So Gatekeeper does not block an unsigned local
build — it never evaluates it.** electron-builder's "user must override in System
Preferences" row on its Code Signing page describes a *downloaded* unsigned app.

**3. Notarization is a Developer ID distribution requirement.** Apple,
[Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution):
"Beginning in macOS 10.15, all software built after June 1, 2019, and distributed with
Developer ID must be notarized." The prerequisites include "Use a 'Developer ID'
application ... certificate for your code-signing signature. (Don't use a Mac
Distribution, ad hoc, Apple Developer, or local development certificate.)" Notarization
is thus not merely unnecessary for an ad-hoc local build; it is *unavailable* to one. It
becomes relevant exactly when a build is signed with Developer ID and downloaded by
someone — neither of which is beat 13.

**Where signing does bite locally** — Electron,
[macOS APIs that require code signing](https://github.com/electron/electron/blob/main/docs/tutorial/code-signing.md):
"A number of macOS APIs exposed by Electron rely on system frameworks (like Keychain
Access and `Squirrel.Mac`) that only behave correctly once your app is code signed":

- `safeStorage` — "Without a valid, consistent code signature, macOS may be unable to tell
  that two builds of your unsigned app are 'the same app', which can cause the Keychain to
  prompt the user for permission again after every update." An ad-hoc signature has no
  Team ID; its identity is per-build, so it does not give the Keychain a stable identity
  either. **This is the hook to #135 (BYOK key storage):** the moment a provider key
  lives in the Keychain, "consistent signature" stops being cosmetic. Recorded here for
  that ticket, not resolved here.
- `app.setLoginItemSettings()` — "Login items can behave incorrectly (e.g. silently
  failing to register) when the app is not packaged, code signed, and notarized." ADR 0005
  already declines a launch agent unless daily Scouts prove they want one, so "survives a
  reboot" for beat 13 means *the install persists and relaunches from the Dock*, not
  *auto-launches*. An unsigned build satisfies that; opening at login is a later,
  signing-gated upgrade.
- `autoUpdater` — "Your application must be signed for automatic updates on macOS. This
  is a requirement of Squirrel.Mac" ([auto-updater API](https://github.com/electron/electron/blob/main/docs/api/auto-updater.md)).

## Comparison

| | electron-builder | Electron Forge | Manual (Electron docs) |
|---|---|---|---|
| Fits `electron.vite.config.ts` as is | Yes — `main: ./out/main/index.js`, `files: out/**` | No — Forge owns `out`; electron-vite `outDir` must move to `dist` | Yes |
| pnpm isolated layout | Supported: dedicated pnpm collector follows `link:` and `.pnpm` | Docs require `node-linker=hoisted` in `.npmrc` (workspace-wide change) | N/A |
| Carry the core (dist + deps) | `extraResources: [{from, to, filter}]` → `Contents/Resources/<to>` | `packagerConfig.extraResource: [path]` → `Contents/Resources` | copy into `Contents/Resources` |
| Skip signing | Default when no identity (or `identity: null`) | Omit `osxSign` (osx-sign throws if present and nothing found) | nothing to skip |
| Ad-hoc signing | Documented: `identity: "-"` + `disable-library-validation` entitlement | Composable: `osxSign: { identity: "-", identityValidation: false }` + entitlements; undocumented as a recipe | `codesign -s -` by hand |
| Developer ID + notarize | `mac.notarize: true` + env; staples automatically | `osxSign: {}` + `osxNotarize: {...}` | `notarytool` by hand |
| Dock icon | `build/icon.svg` or `.png`, auto-converted to `.icns` | `packagerConfig.icon` (needs a prebuilt `.icns`) | `.icns` + `CFBundleIconFile` |
| Unpacked `.app` only | `--dir` | `electron-forge package` | it *is* the output |
| Auto-update | `electron-updater`, GitHub/S3/generic; **signed only** | `update-electron-app`; **signed only** | none |
| Setup churn for this repo | one yml, one script, one `isPackaged` branch | move `out`→`dist`, add `.npmrc` hoisting, one config, one branch | plist edits, icon, scripts written by us |

## Recommendation — the minimum for a dock icon that survives a reboot

**electron-builder, `--dir`, no signing identity (or ad-hoc), no notarization, no
updater.** Concretely:

1. `pnpm --filter core build && pnpm --filter core --prod deploy packages/shell/stage/core`
   (add `"files": ["dist"]` to `packages/core/package.json`). Gitignore `stage/`.
2. `packages/shell/electron-builder.yml`: `appId`, `productName: Vitrine`,
   `directories.buildResources: build` with the brand mark as `build/icon.svg`;
   `files: ["out/**", "package.json"]`; `extraResources: [{ from: stage/core, to: core }]`;
   `asar: false`; `mac.target: dir`. Leave signing unconfigured — electron-builder skips it
   when the keychain has no Developer ID, and the build runs locally because it is never
   quarantined. If a build fails to launch on Apple silicon for a Team-ID reason, switch
   to the documented ad-hoc recipe (`identity: "-"` plus the two entitlements) rather than
   `hardenedRuntime: false`.
3. One conditional in `packages/shell/src/main/index.ts`:
   `CORE_ENTRY = app.isPackaged ? join(process.resourcesPath, "core/dist/main.js") : join(__dirname, "../../../core/dist/main.js")`.
   `RENDERER_DIR` stays as is — with `asar: false` it resolves to real files inside
   `Contents/Resources/app/out/renderer`.
4. `pnpm package` at the root chains build → deploy → `electron-builder --mac --dir`;
   install is dragging `packages/shell/dist/mac-arm64/Vitrine.app` to `/Applications`.
   No DMG, no ZIP, nothing to host.
5. No `openAtLogin`, no updater: both are signing-gated on macOS and #131 rules
   "Signing and notarization beyond what daily local use needs" out of scope.

Why not Forge: two unrelated changes to the repo (electron-vite's `outDir`, pnpm's
linker) before it does the one thing needed, and it is Electron's recommended tool for
the *distribution* case this beat is not. Why not manual: the tool's marginal cost is
one YAML file and it does the icon conversion and plist editing for us; the manual path is
the fallback if electron-builder's pnpm collector misbehaves.

Reversibility, ranked (standing preference from #131): the `isPackaged` branch and the
yml are trivially reversible and tool-agnostic in shape (`extraResources` ↔
`extraResource`). `pnpm deploy` staging is reversible and useful under any tool.
`asar: false` is a one-line flip. The choice of electron-builder itself is the least
reversible piece, and only because Forge would also demand the `out`→`dist` move —
still an afternoon, not an architecture.

## What the grill should still ask

- Does `pnpm deploy`'s isolated `node_modules` under `Contents/Resources/core` resolve
  correctly when the entry is an ESM `main.js` forked by `utilityProcess`? Expected yes
  (Node resolution from the file's own directory); worth a smoke test in the
  implementing ticket, not a research answer.
- Universal vs arm64-only: `--dir` builds for the host arch; a single user on Apple
  silicon needs only arm64. Universal doubles size and needs `@electron/universal`.
- Where the `.app` lands: `/Applications` (survives reboot, appears in Spotlight) vs
  `~/Applications`. Either works; the former is the convention.
- Whether beat 13 should set the `CFBundleIdentifier` (`appId`) with intent — it is the
  Keychain and login-item identity later (#135), and changing it after a key is stored
  orphans the key.
- When (if) the $99 Developer Program becomes worth it: the trigger is the first of
  Keychain storage (#135), `openAtLogin`, auto-update, or a second machine — not this
  beat.

## Sources

- electron-vite — [Distribution](https://electron-vite.org/guide/distribution)
- electron-builder — [App Contents](https://www.electron.build/docs/contents),
  [Code Signing](https://www.electron.build/docs/features/code-signing/),
  [macOS Signing](https://www.electron.build/docs/features/code-signing/code-signing-mac),
  [Notarization](https://www.electron.build/docs/features/code-signing/notarization),
  [Auto Update](https://www.electron.build/docs/features/auto-update),
  [Icons & Images](https://www.electron.build/docs/features/icons-and-images),
  [CLI](https://www.electron.build/docs/cli),
  [Electron Forge makers](https://www.electron.build/docs/features/electron-forge),
  [Two package.json structure](https://www.electron.build/docs/tutorials/two-package-structure);
  source `packages/app-builder-lib/src/node-module-collector/pnpmNodeModulesCollector.ts`
  (electron-userland/electron-builder, main, read 2026-09-20)
- Electron Forge — [Getting Started](https://www.electronforge.io/readme.md),
  [Configuration](https://www.electronforge.io/config/configuration.md),
  [Signing a macOS app](https://www.electronforge.io/guides/code-signing/code-signing-macos.md),
  [Auto Update](https://www.electronforge.io/advanced/auto-update.md)
- `@electron/packager` — `src/types.ts` (`extraResource`, `osxSign`, `osxNotarize`)
- `@electron/osx-sign` — `src/sign.ts` (identity selection), `src/types.ts`
- Electron — [Application Packaging](https://github.com/electron/electron/blob/main/docs/tutorial/application-distribution.md),
  [ASAR Archives](https://github.com/electron/electron/blob/main/docs/tutorial/asar-archives.md),
  [Code Signing → macOS APIs that require code signing](https://github.com/electron/electron/blob/main/docs/tutorial/code-signing.md),
  [autoUpdater](https://github.com/electron/electron/blob/main/docs/api/auto-updater.md),
  [app.setLoginItemSettings](https://github.com/electron/electron/blob/main/docs/api/app.md),
  [utilityProcess](https://github.com/electron/electron/blob/main/docs/api/utility-process.md);
  source `shell/common/node_bindings.cc` (`OnNodePreload`), `lib/node/init.ts`
- pnpm — [pnpm deploy](https://pnpm.io/cli/deploy)
- Apple — [Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution);
  Apple Platform Security Guide, [Gatekeeper and runtime protection in macOS](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web);
  Apple DTS on the Developer Forums: [666452](https://developer.apple.com/forums/thread/666452)
  (Gatekeeper and quarantine), [737571](https://developer.apple.com/forums/thread/737571)
  (ad-hoc code runs by default), [130560](https://developer.apple.com/forums/thread/130560)
  (Testing a Notarised Product)
