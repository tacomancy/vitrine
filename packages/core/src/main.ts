// Entry for the Electron utilityProcess the shell spawns. Everything Electron
// specific is confined to this file so the rest of the core is plain Node.
import { startCore } from "./start.js";

/** The one message the core sends its parent: where it is and how to talk to it. */
export type CoreReadyMessage = { type: "ready"; port: number; token: string };

// `process.parentPort` is Electron's channel to the spawning process; the core
// has no dependency on Electron, so its shape is declared here.
const parentPort = (
  process as unknown as {
    parentPort?: { postMessage: (message: CoreReadyMessage) => void };
  }
).parentPort;

const staticDir = process.env["VITRINE_STATIC_DIR"];
const running = await startCore(staticDir === undefined ? {} : { staticDir });

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
