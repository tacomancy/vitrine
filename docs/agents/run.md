# Running the app

How an agent launches Vitrine to see a change working, without a window appearing beside the user's work. This is the launch path the `run` skill should take for this project; `pnpm dev` and the browser preview both open a visible window and are for the user, not for verification.

The installed `/Applications/Vitrine.app` is the user's daily driver, and `pnpm package` is how it is updated: build, stage the core, bundle, ask the running app to quit, replace the bundle, relaunch (`Scripts/package.mjs`; `docs/architecture.md` § Packaging). It opens a window on purpose, so it is the user's command, not a verification step — an agent runs at most `pnpm package --no-install` and drives the bundle it leaves behind, below.

## The path

1. **Build both packages.** The shell spawns `packages/core/dist/main.js` as a file, so a stale `dist` is stale behaviour:

   ```bash
   pnpm --filter core... build && pnpm --filter shell build
   ```

2. **Launch hidden, drive, capture.** `Scripts/run-hidden.mjs` starts the Electron binary with `VITRINE_SNAPSHOT` (the window is never shown; the page is captured to a PNG and the app quits), `VITRINE_SNAPSHOT_AFTER` (how long the page gets first) and `--remote-debugging-port`, then drives the page over the Chrome DevTools Protocol:

   ```bash
   node Scripts/run-hidden.mjs --snapshot out.png --vault /path/to/scratch-vault --drive drive.mjs
   ```

   - `--app <path/to/Vitrine.app>` drives a packaged bundle instead — its own executable, the core it carries under `Contents/Resources/core` — with the same `page` object. `pnpm package --no-install` leaves one in `packages/shell/dist/mac-arm64/`. The bundle is `app.isPackaged`, so this is the only way to see the packaged branches (core entry, state folder) run; the explicit app-support folder still wins there, so the remembered vault is never touched.
   - `--vault` writes `last-vault.json` into the app-support folder so the window opens on that vault; leave it out to see First run.
   - `--support` names the app-support folder, and makes it if it is not there yet; by default a fresh temp folder, so `~/Library/Application Support/Vitrine` — the user's remembered vault — is never touched. Reuse one folder across launches to test "relaunch and it is still there".
   - A launch that opens a `--vault` holding Scouts runs every *due* one, and in a fresh scratch vault that is every Scout; an arXiv Scout's default endpoint is the real arXiv. `VITRINE_ARXIV_ENDPOINT` is the only seam to it: put it on every such launch, relaunches too — `VITRINE_ARXIV_ENDPOINT=http://127.0.0.1:9 node Scripts/run-hidden.mjs …` (a dead port is a safe guard; `startStandin()` from `Scripts/scout-demo/standin.mjs`, its `endpoint` the value, when the run needs answers). A failed run is not `ok`: a dead port's `network` failure, like `http` and `interrupted`, leaves its Scout due at every check, while `parse` and `rate_limited` wait a cadence (`docs/architecture.md` § Scouts, *Scheduler*). And seed so nothing is due: `openQueue(vault)` from `packages/core/dist/queue.js` makes the schema (a launch to make it runs every Scout) and returns the `node:sqlite` handle to insert through: an `ok` `scout_runs` row per Scout, finished inside its cadence, then `proposals`, `appearances`, `triage`.
   - `--drive` is a module whose default export is `async (page) => {}`, run once the page has painted. `page.eval(js)` reads anything (text, `aria-selected`, `getComputedStyle` against the tokens); `page.key`, `page.type` and `page.wait` press, type and poll; `page.send(method, params)` is any other CDP command. `⌘'` is `page.key("'", { code: "Quote", vk: 222, modifiers: 4 })`; `↵` is `page.key("Enter", { vk: 13, text: "\r" })`.
   - One launch per state you want a picture of; `--after` must be long enough for the drive to finish (the capture happens at that mark regardless).

3. **Read the PNG, and record computed styles.** Colours are checked by reading `getComputedStyle(...)` against `--color-*` from `tokens.css` in the drive script and quoting the result in the PR, not by eye from the screenshot.

## What to use as a vault

Copy `packages/core/fixtures/obsidian-vault` into the scratchpad: it has `.obsidian/`, a note, one Question outside `questions/` (so an open shows a row before anything is captured), one freshly promoted Research Question under `questions/` for `#/research-question/…`, and under `sources/` a Source whose PDF is there, one whose `pdf:` names a file that is not, and a stub — the three states the picker's rows distinguish. Since #375 it also holds a Hypothesis sharpened from that Research Question and four Experiments under `experiments/`, one per state the Experiment surface draws; `fixture-vault.experiments.test.ts` names and pins each. Loose Ends shows neither Experiment row on a fresh copy: the stalled run needs open days recorded in `.vitrine/queue.sqlite`, and the missing link is `Lab iMac`'s, never a row on another machine. Never point a run at the user's real vault. A failing write is simulated with `chmod 500` on `questions/`; restore it after.

`node Scripts/reader-demo.mjs <out-folder>` is the Reader beat's closing run (#429): attach a PDF to a stub, re-save it with the PDFKit stand-in for Preview (`Scripts/reader-demo/preview-resave.swift`, macOS with `swift`), resolve three Unmatched rows, open the Source and make a Question from a selection — one PNG each, on a scratch copy of the fixture vault. `KEEP=1` leaves the scratch vault behind.

`node Scripts/scout-demo.mjs <out-folder>` is the Scouts beat's closing run (#454): seven hidden launches on one scratch vault, against a local stand-in for arXiv (`Scripts/scout-demo/standin.mjs`, the core's recorded fixtures plus a switchable 503) reached through `VITRINE_ARXIV_ENDPOINT` — never the real arXiv. One PNG each: the form with *try*, the Review stack, the Skim feed, the accepted stub's *Unfinished reading* row, the broken Scout on the rail and in Loose Ends, and the recovery.

`node Scripts/watched-demo.mjs <out-folder>` is the Watched sources and BYOK beat's closing run (#471): seven hidden launches on one scratch vault, against a local stand-in for a lab's website and for the model's API (`Scripts/watched-demo/standin.mjs`, the core's recorded pages) — never a real site or the real API. The SDK is pointed at it with `ANTHROPIC_BASE_URL`, and `VITRINE_CREDENTIALS=memory` keeps the key in the core's memory so the login Keychain is never touched. One PNG each: a feed Scout with no model call, a page with no key (*try* offers Settings; the Scout says *not yet*), a key stored and the waiting Scout starting by itself with the invented paper dropped, the key refused on the rail and in Loose Ends in one sentence, and the redesigned page's structure-change row. The script fails if the feed Scout calls the model, if a keyless Scout does, or if the two surfaces word a fault differently.

`node Scripts/question-map-demo.mjs <out-folder>` is the Question Map beat's closing run (#494): fourteen hidden launches over three scratch vaults — the fixture plus 28 generated Questions and 32 Sources (so the matrix has a cut to state), a 12,000-note vault caught mid-build, and an empty one. One PNG each: the matrix in dark, light and each forced against the other (`QM_THEME`; the drive logs the resolved `--color-seq-*`), every reading opened, depth 1 beside the default, and the review's accept, reject, reject remembered across a relaunch, undo, and pass. Each drive throws when the page does not show what its step claims, so a green run is the evidence.

## What cannot be driven this way

Native dialogs and the menu: the folder chooser (`vault.pick`, `File ▸ Open Vault…`) needs a visible window and a human. Those stories are covered by the core's router tests with a fake host, and were verified by hand once in #104 — and again in #267 for the panel's *New Folder* button, which `createDirectory` draws and no test can see. The Obsidian round-trip (open the written file, see editable Properties) was checked once in #106 by registering the scratch vault in `~/Library/Application Support/obsidian/obsidian.json` — ask before doing that again; it adds a vault to the user's switcher.

## The public site

Not here: the site is `tacomancy/tacomancy` (ADR 0012), and that repository's `CLAUDE.md` says how it is previewed. The `prototypes` launch configuration still serves the frozen exports from `docs/reference/prototypes/` directly, for checking a pinned prototype against the brief.
