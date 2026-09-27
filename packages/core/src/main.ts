// Entry for the Electron utilityProcess the shell spawns. Everything Electron
// specific is confined to this file so the rest of the core is plain Node.
import { errorMessage } from "./errors.js";
import type { Host } from "./host.js";
import { startCore } from "./start.js";

/** The first message the core sends its parent: where it is and how to talk to it. */
export type CoreReadyMessage = { type: "ready"; port: number; token: string };
/** Everything the core sends the shell. */
export type CoreMessage =
  | CoreReadyMessage
  | { type: "pickFolder"; id: number }
  // The answer to `close`: the vault is closed and whatever the queue owed
  // has been spliced, or could not be (#276). Sent either way — the shell
  // waits for it, and a core that cannot close must not be what stops the
  // app from quitting.
  | { type: "closed" };
/** Everything the shell sends the core. */
export type ShellMessage =
  | { type: "pickedFolder"; id: number; path: string | null }
  // The window came to the front: today is a day at the open vault (#243).
  // The shell is the only one who can see this; the core never infers it
  // from a request, since the renderer re-queries on its own.
  | { type: "focused" }
  // The app is quitting. Only the shell knows that, and `app.quit()` kills
  // this process, so the orderly close has to be asked for (#276).
  | { type: "close" };

type ParentPort = {
  postMessage: (message: CoreMessage) => void;
  on: (
    event: "message",
    listener: (event: { data: ShellMessage }) => void
  ) => void;
};

// `process.parentPort` is Electron's channel to the spawning process; the core
// has no dependency on Electron, so its shape is declared here.
const parentPort = (process as unknown as { parentPort?: ParentPort })
  .parentPort;

/**
 * The host, over the process channel: each chooser request carries an id so
 * the reply can be matched even if two arrive close together. It does not
 * listen for its own replies — the one dispatcher below hands them over, so
 * a new message type is a branch there rather than another listener.
 */
function hostOver(port: ParentPort): {
  host: Host;
  picked: (message: { id: number; path: string | null }) => void;
} {
  let nextId = 1;
  const pending = new Map<number, (path: string | null) => void>();
  return {
    host: {
      pickFolder: () =>
        new Promise((resolve) => {
          const id = nextId++;
          pending.set(id, resolve);
          port.postMessage({ type: "pickFolder", id });
        }),
    },
    picked: ({ id, path }) => {
      pending.get(id)?.(path);
      pending.delete(id);
    },
  };
}

const staticDir = process.env["VITRINE_STATIC_DIR"];
// Overridable so a verification run can start from a folder of its own
// rather than the real Application Support.
const appSupportDir = process.env["VITRINE_APP_SUPPORT_DIR"];
const shell = parentPort ? hostOver(parentPort) : null;
const running = await startCore({
  ...(staticDir === undefined ? {} : { staticDir }),
  ...(appSupportDir === undefined ? {} : { appSupportDir }),
  ...(shell ? { host: shell.host } : {}),
});

const ready: CoreReadyMessage = {
  type: "ready",
  port: running.port,
  token: running.token,
};
if (parentPort && shell) {
  const port = parentPort;
  /**
   * The orderly close, asked for because the shell is quitting (#276):
   * `running.close` is what awaits the splice of everything `queue.sqlite`
   * owes, and `process.on("exit")` — all a killed process gets — cannot.
   * Answered whatever happened, because the shell is waiting on this and a
   * core that cannot close must not hold up the quit; what could not be
   * spliced stays in the queue and is owed again at the next open.
   */
  const closeForQuit = async () => {
    try {
      await running.close();
    } catch (cause) {
      console.error(
        `vitrine-core: the vault could not be closed: ${errorMessage(cause)}`
      );
    }
    port.postMessage({ type: "closed" });
  };
  // One dispatcher for everything the shell sends: a new message type is a
  // branch here, and the switch is exhaustive so adding one to
  // `ShellMessage` without handling it is a type error.
  parentPort.on("message", ({ data }) => {
    switch (data.type) {
      case "pickedFolder":
        shell.picked(data);
        break;
      case "focused":
        // A day that cannot be recorded is a day the vault was open and
        // Loose Ends will not count. There is no surface to say that on
        // from here, so it goes to the core's log rather than becoming an
        // unhandled rejection in the utilityProcess.
        void running.focused().catch((cause: unknown) => {
          console.error(
            `vitrine-core: an open day could not be recorded: ${errorMessage(cause)}`
          );
        });
        break;
      case "close":
        void closeForQuit();
        break;
    }
  });
  parentPort.postMessage(ready);
} else {
  // Started by hand (`node dist/main.js`): say where we are.
  console.log(`core listening on http://127.0.0.1:${ready.port}`);
}
