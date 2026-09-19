// Entry for the Electron utilityProcess the shell spawns. Everything Electron
// specific is confined to this file so the rest of the core is plain Node.
import type { Host } from "./host.js";
import { startCore } from "./start.js";

/** The first message the core sends its parent: where it is and how to talk to it. */
export type CoreReadyMessage = { type: "ready"; port: number; token: string };
/** Everything the core sends the shell. */
export type CoreMessage = CoreReadyMessage | { type: "pickFolder"; id: number };
/** Everything the shell sends the core. */
export type ShellMessage = { type: "pickedFolder"; id: number; path: string | null };

type ParentPort = {
  postMessage: (message: CoreMessage) => void;
  on: (event: "message", listener: (event: { data: ShellMessage }) => void) => void;
};

// `process.parentPort` is Electron's channel to the spawning process; the core
// has no dependency on Electron, so its shape is declared here.
const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;

/**
 * The host, over the process channel: each chooser request carries an id so
 * the reply can be matched even if two arrive close together.
 */
function hostOver(port: ParentPort): Host {
  let nextId = 1;
  const pending = new Map<number, (path: string | null) => void>();
  port.on("message", ({ data }) => {
    if (data.type === "pickedFolder") {
      pending.get(data.id)?.(data.path);
      pending.delete(data.id);
    }
  });
  return {
    pickFolder: () =>
      new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        port.postMessage({ type: "pickFolder", id });
      }),
  };
}

const staticDir = process.env["VITRINE_STATIC_DIR"];
const running = await startCore({
  ...(staticDir === undefined ? {} : { staticDir }),
  ...(parentPort ? { host: hostOver(parentPort) } : {}),
});

const ready: CoreReadyMessage = {
  type: "ready",
  port: running.port,
  token: running.token,
};
if (parentPort) {
  parentPort.postMessage(ready);
} else {
  // Started by hand (`node dist/main.js`): say where we are.
  console.log(`core listening on http://127.0.0.1:${ready.port}`);
}
