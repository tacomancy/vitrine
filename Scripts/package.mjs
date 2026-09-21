#!/usr/bin/env node
// `pnpm package`: the checkout becomes the installed Vitrine.app and is
// relaunched (docs/architecture.md § Packaging). This is how a branch is
// tried, so nothing gates it — red tests included — and the previous bundle
// is not kept: rollback is a checkout and another `pnpm package`.
//
//   pnpm package                 build, stage, bundle, install, relaunch
//   pnpm package --no-install    stop after the bundle, for driving it with
//                                Scripts/run-hidden.mjs --app before it is installed
//   pnpm package --install-only  install an already-built bundle; the retry
//                                after a refused quit
//
// The install asks a running Vitrine to quit and waits up to ~10 s. If it
// will not — a dialog is open, say — the script says so and stops, with the
// fresh bundle left in packages/shell/dist/mac-arm64/ for a manual drag.
// Nothing is ever force-quit.
//
// Runs under the system Node (24+, which strips the types from launch.ts
// so the build-version resolver is shared with the shell, not copied).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const shell = join(repo, "packages/shell");
const stage = join(shell, "stage/core");
const bundle = join(shell, "dist/mac-arm64/Vitrine.app");
const installed = "/Applications/Vitrine.app";
const bundleId = "com.tacomancy.vitrine";

const flags = new Set(process.argv.slice(2));
const known = new Set(["--no-install", "--install-only"]);
for (const flag of flags) {
  if (!known.has(flag)) {
    console.error(`package: unknown flag ${flag}`);
    process.exit(2);
  }
}
if (flags.has("--no-install") && flags.has("--install-only")) {
  console.error("package: --no-install and --install-only exclude each other");
  process.exit(2);
}

/** Run a command in the foreground; a non-zero exit ends the script. */
function run(command, args, cwd = repo) {
  console.log(`package: ${command} ${args.join(" ")}`);
  const { status } = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (status !== 0) process.exit(status ?? 1);
}

const osascript = (script) =>
  execFileSync("osascript", ["-e", script], { encoding: "utf8" }).trim();

/** Whether a Vitrine — the installed one, by bundle id — is running. */
const vitrineRunning = () =>
  osascript(
    `tell application "System Events" to (count of (processes whose bundle identifier is "${bundleId}")) > 0`
  ) === "true";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- build --------------------------------------------------------------

if (!flags.has("--install-only")) {
  run("pnpm", ["--filter", "core...", "build"]);
  // pnpm deploy wants a fresh target; the stage is a build product.
  await rm(stage, { recursive: true, force: true });
  run("pnpm", ["--filter", "core", "--prod", "deploy", stage]);
  run("pnpm", ["--filter", "shell", "build"]);

  const { buildVersion } = await import(
    pathToFileURL(join(shell, "src/main/launch.ts")).href
  );
  const git = (args) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  const version = buildVersion({
    sha: git(["rev-parse", "--short", "HEAD"]),
    status: git(["status", "--porcelain"]),
  });
  run(
    "pnpm",
    [
      "exec",
      "electron-builder",
      "--mac",
      "--dir",
      `--config.buildVersion=${version}`,
    ],
    shell
  );
  console.log(`package: built ${bundle} (build ${version})`);
}

if (flags.has("--no-install")) process.exit(0);

// --- install ------------------------------------------------------------

if (!existsSync(bundle)) {
  console.error(`package: nothing to install — ${bundle} does not exist`);
  process.exit(1);
}

if (vitrineRunning()) {
  console.log("package: asking the running Vitrine to quit…");
  try {
    // The Apple event's own timeout is minutes; ours is the poll below.
    osascript(
      `with timeout of 10 seconds\n tell application id "${bundleId}" to quit\nend timeout`
    );
  } catch {
    // A refused or unanswered quit lands in the check below.
  }
  const until = Date.now() + 10_000;
  while (vitrineRunning() && Date.now() < until) await sleep(250);
  if (vitrineRunning()) {
    console.error(
      `package: Vitrine did not quit (a dialog may be open). Nothing was installed.\n` +
        `  Quit it yourself, then: pnpm package --install-only\n` +
        `  or drag ${bundle} to /Applications.`
    );
    process.exit(1);
  }
}

// Remove, then copy whole: a bundle mid-overwrite is not a bundle.
await rm(installed, { recursive: true, force: true });
run("ditto", [bundle, installed]);
run("open", [installed]);
console.log(`package: installed ${installed} and launched it`);
