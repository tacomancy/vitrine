#!/usr/bin/env node
// Launch the built app with no window ever shown, drive the page over the
// Chrome DevTools Protocol, capture a PNG, quit. The way an agent sees a
// change working without a window landing on the user's screen; see
// docs/agents/run.md.
//
//   node Scripts/run-hidden.mjs --snapshot out.png [--vault <folder>]
//        [--support <folder>] [--after <ms>] [--port <n>] [--drive <file.mjs>]
//        [--app <path/to/Vitrine.app>]
//
// --app       a packaged bundle to drive (pnpm package --no-install leaves
//             one in packages/shell/dist/mac-arm64/) instead of the built
//             workspace shell under the node_modules Electron
// --vault     the folder to open at launch (written to the app-support
//             folder's last-vault.json, so the window opens on it directly;
//             without it the window shows First run)
// --support   the app-support folder to use; a fresh temp folder by default,
//             so the real ~/Library/Application Support/Vitrine is untouched
// --after     how long the page gets before the capture (default 4000)
// --drive     a module whose default export is `async (page) => {}`; it runs
//             once the page has painted, before the capture
//
// `page` offers: eval(js) → value; key(key, {code, vk, text, modifiers});
// type(text); wait(js) → polls until truthy; sleep(ms). ⌘ is modifiers 4.
//
// Without --app, needs `pnpm --filter core... build && pnpm --filter shell
// build` first: the shell spawns core/dist/main.js, so a stale dist is stale
// behaviour. Runs under the system Node (22+, for fetch and WebSocket), on
// macOS only: the Electron binary is the .app the shell package installs.

import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Every flag takes a value, so argv pairs up.
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const flag = process.argv[i];
  const value = process.argv[i + 1];
  if (!flag.startsWith("--") || value === undefined) {
    console.error(`run-hidden: expected --flag value, got ${flag}`);
    process.exit(2);
  }
  args.set(flag.slice(2), value);
}
const snapshot = args.get("snapshot");
if (!snapshot) {
  console.error("run-hidden: --snapshot <png> is required");
  process.exit(2);
}
const port = Number(args.get("port") ?? 9333);
const after = Number(args.get("after") ?? 4000);
const repo = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const support =
  args.get("support") ?? (await mkdtemp(join(tmpdir(), "vitrine-support-")));
if (args.has("vault")) {
  await writeFile(
    join(support, "last-vault.json"),
    JSON.stringify({ path: resolvePath(args.get("vault")) })
  );
}

// A packaged bundle carries its own main; the dev launch hands the shell's
// package to the bare Electron. Either way the same env reaches the same code.
const launch = args.has("app")
  ? {
      executable: join(resolvePath(args.get("app")), "Contents/MacOS/Vitrine"),
      argv: [],
    }
  : {
      executable: join(
        repo,
        "packages/shell/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
      ),
      argv: [join(repo, "packages/shell")],
    };
const child = spawn(
  launch.executable,
  [...launch.argv, `--remote-debugging-port=${port}`],
  {
    env: {
      ...process.env,
      VITRINE_APP_SUPPORT_DIR: support,
      VITRINE_SNAPSHOT: resolvePath(snapshot),
      VITRINE_SNAPSHOT_AFTER: String(after),
    },
    stdio: ["ignore", "inherit", "inherit"],
  }
);
const exited = new Promise((done) => child.once("exit", done));

// --- CDP -------------------------------------------------------------------

async function pageTarget() {
  for (let i = 0; i < 100; i++) {
    try {
      const targets = await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
      ).json();
      const page = targets.find(
        (t) => t.type === "page" && t.url.startsWith("http://127.0.0.1")
      );
      if (page) return page;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(
    "run-hidden: the renderer page never appeared on the debug port"
  );
}

function connect(url) {
  const ws = new WebSocket(url);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const reply = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reply.reject(new Error(msg.error.message));
      else reply.resolve(msg.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve({ send, ws }));
    ws.addEventListener("error", reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await pageTarget();
const { send, ws } = await connect(target.webSocketDebuggerUrl);

const page = {
  sleep,
  eval: async (js) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
      expression: js,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value;
  },
  wait: async (js, timeout = 5000) => {
    const until = Date.now() + timeout;
    for (;;) {
      const value = await page.eval(js);
      if (value) return value;
      if (Date.now() > until)
        throw new Error(`run-hidden: timed out waiting for ${js}`);
      await sleep(50);
    }
  },
  key: async (key, { code = key, vk, text, modifiers = 0 } = {}) => {
    const base = { key, code, modifiers, windowsVirtualKeyCode: vk };
    await send("Input.dispatchKeyEvent", {
      ...base,
      type: text === undefined ? "rawKeyDown" : "keyDown",
      ...(text === undefined ? {} : { text }),
    });
    await send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
  },
  type: (text) => send("Input.insertText", { text }),
};

try {
  await page.wait("document.querySelector('#root')?.children.length > 0");
  if (args.has("drive")) {
    const mod = await import(
      pathToFileURL(resolvePath(args.get("drive"))).href
    );
    await mod.default(page);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  ws.close();
}
await exited;
console.log(`run-hidden: ${snapshot} (app-support ${support})`);
