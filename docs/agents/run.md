# Running the app

How an agent launches Vitrine to see a change working, without a window appearing beside the owner's work. This is the launch path the `run` skill should take for this project; `pnpm dev` and the browser preview both open a visible window and are for the owner, not for verification.

## The path

1. **Build both packages.** The shell spawns `packages/core/dist/main.js` as a file, so a stale `dist` is stale behaviour:

   ```bash
   pnpm --filter core build && pnpm --filter shell build
   ```

2. **Launch hidden, drive, capture.** `Scripts/run-hidden.mjs` starts the Electron binary with `VITRINE_SNAPSHOT` (the window is never shown; the page is captured to a PNG and the app quits), `VITRINE_SNAPSHOT_AFTER` (how long the page gets first) and `--remote-debugging-port`, then drives the page over the Chrome DevTools Protocol:

   ```bash
   node Scripts/run-hidden.mjs --snapshot out.png --vault /path/to/scratch-vault --drive drive.mjs
   ```

   - `--vault` writes `last-vault.json` into the app-support folder so the window opens on that vault; leave it out to see First run.
   - `--support` names the app-support folder; by default a fresh temp folder, so `~/Library/Application Support/Vitrine` — the owner's remembered vault — is never touched. Reuse one folder across launches to test "relaunch and it is still there".
   - `--drive` is a module whose default export is `async (page) => {}`, run once the page has painted. `page.eval(js)` reads anything (text, `aria-selected`, `getComputedStyle` against the tokens); `page.key`, `page.type` and `page.wait` press, type and poll. `⌘'` is `page.key("'", { code: "Quote", vk: 222, modifiers: 4 })`; `↵` is `page.key("Enter", { vk: 13, text: "\r" })`.
   - One launch per state you want a picture of; `--after` must be long enough for the drive to finish (the capture happens at that mark regardless).

3. **Read the PNG, and record computed styles.** Colours are checked by reading `getComputedStyle(...)` against `--color-*` from `tokens.css` in the drive script and quoting the result in the PR, not by eye from the screenshot.

## What to use as a vault

Copy `packages/core/fixtures/obsidian-vault` into the scratchpad: it has `.obsidian/`, a note, and one Question outside `questions/`, so an open shows a row before anything is captured. Never point a run at the owner's real vault. A failing write is simulated with `chmod 500` on `questions/`; restore it after.

## What cannot be driven this way

Native dialogs and the menu: the folder chooser (`vault.pick`, `File ▸ Open Vault…`) needs a visible window and a human. Those stories are covered by the core's router tests with a fake host, and were verified by hand once in #104. The Obsidian round-trip (open the written file, see editable Properties) was checked once in #106 by registering the scratch vault in `~/Library/Application Support/obsidian/obsidian.json` — ask before doing that again; it adds a vault to the owner's switcher.
