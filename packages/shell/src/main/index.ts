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
  utilityProcess,
  type UtilityProcess,
} from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

type Session = Pick<CoreReadyMessage, "port" | "token">;

// The shell's only runtime tie to the core is this path to its built entry;
// the `core` dependency above is type-only, for the message contract.
const CORE_ENTRY = join(__dirname, "../../../core/dist/main.js");
const RENDERER_DIR = join(__dirname, "../renderer");
const PRELOAD = join(__dirname, "../preload/index.js");

let session: Session | undefined;

/** The window a dialog should attach to, if one is open. */
function frontWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

/**
 * The host's one duty (core `Host`): show the standard folder chooser and
 * answer with the path, or null when cancelled. The core cannot show
 * dialogs, so it asks over the process channel it already has.
 */
async function pickFolder(): Promise<string | null> {
  const options = { properties: ["openDirectory" as const] };
  const win = frontWindow();
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/** Spawn the core out of process, so a crash there never takes the window down. */
function spawnCore(): Promise<Session> {
  return new Promise((resolve) => {
    const core: UtilityProcess = utilityProcess.fork(CORE_ENTRY, [], {
      serviceName: "vitrine-core",
      env: { ...process.env, VITRINE_STATIC_DIR: RENDERER_DIR },
    });
    const reply = (message: ShellMessage) => core.postMessage(message);
    core.on("message", (message: CoreMessage) => {
      switch (message.type) {
        case "ready":
          resolve({ port: message.port, token: message.token });
          break;
        case "pickFolder":
          void pickFolder().then((path) =>
            reply({ type: "pickedFolder", id: message.id, path })
          );
          break;
      }
    });
    core.on("exit", (code) => {
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
 * File ▸ Open Vault… goes through the core exactly as the renderer's own
 * action does. The renderer has no push channel yet, and a vault switch
 * discards every piece of window state anyway, so the window is reloaded
 * to show the new vault; a refused folder is stated in a plain message.
 */
async function openVaultFromMenu(client: CoreClient) {
  try {
    const vault = await client.vault.pick.mutate();
    if (vault) frontWindow()?.reload();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const win = frontWindow();
    const box = { type: "none" as const, message, buttons: ["OK"] };
    await (win ? dialog.showMessageBox(win, box) : dialog.showMessageBox(box));
  }
}

function installMenu(client: CoreClient) {
  const menu = Menu.buildFromTemplate([
    { role: "appMenu" },
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

function createWindow({ port }: Session) {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: "hiddenInset",
    // --color-bg (dark), so nothing lighter flashes before first paint.
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
  // the app quits.
  const snapshot = process.env.VITRINE_SNAPSHOT;
  if (snapshot) {
    win.webContents.once("did-finish-load", () => {
      // Give the renderer a moment to ask the core for the vault and paint.
      setTimeout(() => {
        void win.webContents
          .capturePage(undefined, { stayHidden: true })
          .then((image) => writeFile(snapshot, image.toPNG()))
          .finally(() => app.quit());
      }, 1500);
    });
  } else {
    win.once("ready-to-show", () => win.show());
  }

  // Development loads from Vite for HMR; otherwise the core serves the bundle.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  void win.loadURL(devUrl ?? `http://127.0.0.1:${port}/`);
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
