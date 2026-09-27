import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const script = join(dirname(fileURLToPath(import.meta.url)), "run-hidden.mjs");

let base;
let running;

afterEach(() => {
  // The script is still polling the debug port it will never see answered;
  // nothing is left to learn from it once the assertions have run.
  running?.kill("SIGKILL");
  running = undefined;
  if (base) rmSync(base, { recursive: true, force: true });
  base = undefined;
});

// A bundle whose executable exits at once. What is under test happens before
// the launch, but a launch that starts and exits keeps the script on its
// ordinary path: the test reads what run-hidden writes, never what a failed
// spawn left half-done.
function workspace() {
  base = mkdtempSync(join(tmpdir(), "vitrine-run-hidden-"));
  const executable = join(base, "Fake.app/Contents/MacOS/Vitrine");
  mkdirSync(dirname(executable), { recursive: true });
  writeFileSync(executable, "#!/bin/sh\nexit 0\n");
  chmodSync(executable, 0o755);
  const vault = join(base, "vault");
  mkdirSync(vault);
  return {
    app: join(base, "Fake.app"),
    vault,
    // Two levels of it missing: a name the caller just picked.
    support: join(base, "fresh/support"),
    snapshot: join(base, "out.png"),
  };
}

// Returns the child's stderr so far, for a failure message worth reading.
// Any port but run-hidden's own default: the fake bundle never listens, so a
// real hidden run holding 9333 would hand the test its page.
function launch(flags) {
  running = spawn(process.execPath, [script, ...flags, "--port", "9399"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  running.stderr.setEncoding("utf8");
  running.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return () => stderr;
}

// Two seconds, well inside the 5s test timeout, so a miss fails on the
// assertion — with the child's stderr — rather than on the timeout, which
// says nothing about why.
async function within(seen) {
  for (let i = 0; i < 80; i++) {
    if (seen()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

// writeFile creates the file before it fills it, so existing is not being
// there to read: the JSON is what the test is waiting for.
const vaultRemembered = (support) => {
  try {
    return JSON.parse(readFileSync(join(support, "last-vault.json"), "utf8"));
  } catch {
    return null;
  }
};

describe("run-hidden --support", () => {
  it("makes a folder that is not there yet, and remembers the vault in it", async () => {
    const { app, vault, support, snapshot } = workspace();
    const stderr = launch([
      "--snapshot",
      snapshot,
      "--vault",
      vault,
      "--support",
      support,
      "--app",
      app,
    ]);
    expect(await within(() => vaultRemembered(support)), stderr()).toBe(true);
    expect(vaultRemembered(support)).toEqual({ path: vault });
  });

  it("makes it without a --vault to write into it", async () => {
    const { app, support, snapshot } = workspace();
    const stderr = launch([
      "--snapshot",
      snapshot,
      "--support",
      support,
      "--app",
      app,
    ]);
    expect(await within(() => existsSync(support)), stderr()).toBe(true);
  });
});
