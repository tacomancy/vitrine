import { createTRPCClient, httpLink } from "@trpc/client";
import type {
  AppRouter,
  CoreMessage,
  CoreReadyMessage,
  ShellMessage,
} from "core";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  utilityProcess,
  type UtilityProcess,
} from "electron";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { pickFile, pickFolder, type ShowOpenDialog } from "./chooser.js";
import { closeCore, type CorePort } from "./close.js";
import { authorName, coreEntry, machineName, stateFolder } from "./launch.js";
import { routeLink, type LinkRoute } from "./navigation.js";

type Session = Pick<CoreReadyMessage, "port" | "token">;

// The shell's only runtime tie to the core is this path to its built entry;
// the `core` dependency above is type-only, for the message contract.
const CORE_ENTRY = coreEntry({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  mainDir: __dirname,
});
const RENDERER_DIR = join(__dirname, "../renderer");
const PRELOAD = join(__dirname, "../preload/index.js");

let session: Session | undefined;
// Kept so the window can tell the core it came to the front (#243). The
// shell is the only one who can see that; nothing else may stand in for it.
let coreProcess: UtilityProcess | undefined;

/** The window a dialog should attach to, if one is open. */
function frontWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

/**
 * The dialog `pickFolder` and `pickFile` show, attached to the open window when there is
 * one. The core cannot show dialogs, so it asks the shell over the process
 * channel it already has; what the chooser is asked for is `chooser.ts`.
 */
const showOpenDialog: ShowOpenDialog = (options) => {
  const win = frontWindow();
  return win
    ? dialog.showOpenDialog(win, options)
    : dialog.showOpenDialog(options);
};

/** Spawn the core out of process, so a crash there never takes the window down. */
function spawnCore(): Promise<Session> {
  // The shell always says which state folder to use, so the core's own
  // default is only ever reached by a core started by hand.
  const appSupportDir = stateFolder({
    explicit: process.env.VITRINE_APP_SUPPORT_DIR,
    isPackaged: app.isPackaged,
    appData: app.getPath("appData"),
  });
  const author = authorName({
    fullName: () => execFileSync("id", ["-F"], { encoding: "utf8" }),
  });
  return new Promise((resolve) => {
    const core: UtilityProcess = utilityProcess.fork(CORE_ENTRY, [], {
      serviceName: "vitrine-core",
      env: {
        ...process.env,
        VITRINE_STATIC_DIR: RENDERER_DIR,
        VITRINE_APP_SUPPORT_DIR: appSupportDir,
        ...(author === undefined ? {} : { VITRINE_AUTHOR: author }),
        VITRINE_MACHINE: machineName({
          computerName: () =>
            execFileSync("scutil", ["--get", "ComputerName"], {
              encoding: "utf8",
            }),
          hostname: hostname(),
        }),
      },
    });
    coreProcess = core;
    const reply = (message: ShellMessage) => core.postMessage(message);
    core.on("message", (message: CoreMessage) => {
      switch (message.type) {
        case "ready":
          resolve({ port: message.port, token: message.token });
          break;
        case "pickFolder":
          void pickFolder(showOpenDialog).then((path) =>
            reply({ type: "pickedFolder", id: message.id, path })
          );
          break;
        case "pickFile":
          void pickFile(showOpenDialog).then((path) =>
            reply({ type: "pickedFile", id: message.id, path })
          );
          break;
        case "reveal":
          shell.showItemInFolder(message.path);
          break;
        case "trash":
          void shell.trashItem(message.path).then(
            () => reply({ type: "trashed", id: message.id, error: null }),
            (cause: unknown) =>
              reply({
                type: "trashed",
                id: message.id,
                error: cause instanceof Error ? cause.message : String(cause),
              })
          );
          break;
      }
    });
    core.on("exit", (code) => {
      // Cleared so a window that comes to the front after a core crash does
      // not post `focused` into a dead process.
      if (coreProcess === core) coreProcess = undefined;
      console.error(`vitrine-core exited with code ${code}`);
    });
  });
}

type CoreClient = ReturnType<typeof coreClient>;

/** The shell as one more client of the core, for what the menu drives. */
function coreClient({ port, token }: Session) {
  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `http://127.0.0.1:${port}/trpc`,
        headers: { authorization: `Bearer ${token}` },
      }),
    ],
  });
}

/**
 * File ▸ Open Vault… goes through the core exactly as Settings' *Open a
 * different folder…* does, and nothing more: the core raises
 * `vaultSwitched` on the event stream and the window resets itself in
 * place (#377), so the two ways in cannot differ. No reload. A refused
 * folder is stated in a plain message, since the menu has no line of its
 * own in the window to say it on.
 */
async function openVaultFromMenu(client: CoreClient) {
  try {
    await client.vault.pick.mutate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const win = frontWindow();
    const box = { type: "none" as const, message, buttons: ["OK"] };
    await (win ? dialog.showMessageBox(win, box) : dialog.showMessageBox(box));
  }
}

/**
 * App ▸ Settings… (⌘,; ADR 0025 decision 5). The shell cannot tell First run
 * from a vault on screen, so it only says the item was chosen; the window
 * decides, and listens only while a vault is open (`Settings.tsx`). The
 * preload turns this into the page event the renderer's own ⌘, uses.
 */
function openSettingsFromMenu() {
  frontWindow()?.webContents.send("vitrine:settings");
}

function installMenu(client: CoreClient) {
  const menu = Menu.buildFromTemplate([
    {
      role: "appMenu",
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: openSettingsFromMenu,
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "Open Vault…",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => void openVaultFromMenu(client),
        },
      ],
    },
    { role: "editMenu" },
    { role: "windowMenu" },
  ]);
  Menu.setApplicationMenu(menu);
}

/**
 * A link out of the window, once `routeLink` has said where it goes. Only
 * `route.url` of a browser route — the parsed URL whose scheme was checked —
 * ever reaches `shell.openExternal`, never the text the page asked for.
 *
 * A refused link is said in a message box, and so is one the OS could not
 * open (a `mailto:` with no mail app set): either way the click did nothing,
 * and a link that does nothing without saying so is the silent failure #392
 * exists to end. Under VITRINE_SNAPSHOT both go to the log instead, since a
 * browser tab or a dialog appearing is the interruption a hidden run exists
 * to avoid, and the log is what the drive checks.
 */
function leaveWindow(
  win: BrowserWindow,
  route: Exclude<LinkRoute, { to: "window" }>
) {
  const hidden = Boolean(process.env.VITRINE_SNAPSHOT);
  if (route.to === "browser") {
    if (hidden) {
      console.log(`vitrine: open externally ${route.url}`);
      return;
    }
    shell.openExternal(route.url).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      sayNotOpened(win, "Vitrine could not open this link.", reason, route.url);
    });
    return;
  }
  if (hidden) {
    console.log(`vitrine: refused link ${route.url}`);
    return;
  }
  const kind = route.scheme ? `a ${route.scheme} link` : "this link";
  sayNotOpened(
    win,
    `Vitrine does not open ${kind}.`,
    "Only web and mail links open, in your default browser.",
    route.url
  );
}

// One box at a time: `will-navigate` also fires for a script's navigation,
// which nobody clicked, and a loop of them must not stack a dialog per turn.
let saying = false;

function sayNotOpened(
  win: BrowserWindow,
  message: string,
  why: string,
  url: string
) {
  if (saying) return;
  saying = true;
  void dialog
    .showMessageBox(win, {
      type: "none",
      message,
      detail: `${why}\n\n${clip(url)}`,
      buttons: ["OK"],
    })
    .finally(() => {
      saying = false;
    });
}

/** A URL short enough to read in a dialog; a `data:` one can be megabytes. */
function clip(url: string): string {
  return url.length > 200 ? `${url.slice(0, 200)}…` : url;
}

function createWindow({ port }: Session) {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: "hiddenInset",
    // --color-bg (dark), so nothing lighter flashes before first paint. The
    // main process has no stylesheet to bind a class from, so this is the one
    // literal that cannot live in tokens.css.
    // eslint-disable-next-line brand/no-color-literals-in-strings
    backgroundColor: "#09111D",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      preload: PRELOAD,
    },
  });
  // An agent verifying a change runs the app beside someone's work, where a
  // window appearing is an interruption. With VITRINE_SNAPSHOT set the window
  // is never shown: the page renders hidden, is captured to that path, and
  // the app quits. VITRINE_SNAPSHOT_AFTER (ms) stretches the wait so a
  // driver on --remote-debugging-port can act on the page first.
  const snapshot = process.env.VITRINE_SNAPSHOT;
  if (snapshot) {
    const after = Number(process.env.VITRINE_SNAPSHOT_AFTER) || 1500;
    win.webContents.once("did-finish-load", () => {
      // Give the renderer a moment to ask the core for the vault and paint.
      setTimeout(() => {
        void win.webContents
          .capturePage(undefined, { stayHidden: true })
          .then((image) => writeFile(snapshot, image.toPNG()))
          .finally(() => app.quit());
      }, after);
    });
  } else {
    win.once("ready-to-show", () => win.show());
  }

  // Coming to the front is what makes today a day at the vault (#243): a
  // running app is not the same as a day spent at it, so this is the one
  // signal, and there is deliberately no request the core counts instead.
  win.on("focus", () => coreProcess?.postMessage({ type: "focused" }));

  // Development loads from Vite for HMR; otherwise the core serves the bundle.
  const appUrl =
    process.env.ELECTRON_RENDERER_URL ?? `http://127.0.0.1:${port}/`;

  // The window is the app and nothing else: leaving its origin (a link, a
  // script, a dropped file) replaces the app until a reload, so it never
  // does, and no new window opens. A web or mail link goes to the default
  // browser instead; anything else is refused aloud (`navigation.ts`).
  win.webContents.on("will-navigate", (event, url) => {
    const route = routeLink(url, appUrl);
    if (route.to === "window") return;
    event.preventDefault();
    leaveWindow(win, route);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    const route = routeLink(url, appUrl);
    if (route.to === "window") {
      // Only the app's own code can ask for a second window on its own
      // page, and the app has one window; this is a bug to hear about.
      console.error(`vitrine: refused a second window on ${url}`);
    } else {
      leaveWindow(win, route);
    }
    return { action: "deny" };
  });

  void win.loadURL(appUrl);
}

void app.whenReady().then(async () => {
  session = await spawnCore();

  // Answered synchronously for the preload; only our own window may ask.
  ipcMain.on("vitrine:session", (event) => {
    const fromOurWindow = BrowserWindow.getAllWindows().some(
      (w) => w.webContents.id === event.sender.id
    );
    event.returnValue = fromOurWindow ? session : null;
  });

  installMenu(coreClient(session));
  createWindow(session);

  app.on("activate", () => {
    if (session && BrowserWindow.getAllWindows().length === 0) {
      createWindow(session);
    }
  });
});

// On macOS closing the window does not quit; the core lives as long as the app
// (ADR 0005).
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/** The `utilityProcess` as the narrow channel `closeCore` asks for. */
function portOf(core: UtilityProcess): CorePort {
  return {
    postMessage: (message) => core.postMessage(message),
    onMessage: (listener) => {
      core.on("message", listener);
      return () => core.off("message", listener);
    },
    onExit: (listener) => {
      core.on("exit", listener);
      return () => core.off("exit", listener);
    },
  };
}

// Whether the close has already been asked for, so the second `app.quit()`
// below is the one that goes through — and so is a second ⌘Q from someone
// who will not wait. That one takes the core with it mid-splice, which is
// safe to let happen: a page write is whole-then-rename (`atomic-write.ts`),
// so what is on disk is either the old file or the new one, and a Revision
// whose entry did not land is still parked for the next open.
let closing = false;

/**
 * Quitting is what closes the vault, and only the shell knows it is
 * happening: `app.quit()` kills the `utilityProcess`, leaving the core the
 * `process.on("exit")` last resort, which cannot await and so splices
 * nothing (#276). So the quit is deferred — not cancelled — while the core
 * is asked to close and answers, and then asked for again.
 */
app.on("before-quit", (event) => {
  const core = coreProcess;
  if (closing || core === undefined) return;
  event.preventDefault();
  closing = true;
  void closeCore(portOf(core)).then((outcome) => {
    if (outcome !== "closed") {
      // Nothing is lost: a Revision that could not be spliced stays in
      // `queue.sqlite` and is owed again at the next open. There is no
      // window left to say it in, so it goes to the shell's log.
      console.error(
        `vitrine: the core did not close cleanly (${outcome}); quitting anyway`
      );
    }
    app.quit();
  });
});
