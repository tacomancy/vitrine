import { app, BrowserWindow, ipcMain, utilityProcess } from "electron";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

type Session = { port: number; token: string };

// The shell's only runtime tie to the core is this path to its built entry.
const CORE_ENTRY = join(__dirname, "../../../core/dist/main.js");
const RENDERER_DIR = join(__dirname, "../renderer");
const PRELOAD = join(__dirname, "../preload/index.js");

let session: Session | undefined;

/** Spawn the core out of process, so a crash there never takes the window down. */
function startCore(): Promise<Session> {
  return new Promise((resolve) => {
    const core = utilityProcess.fork(CORE_ENTRY, [], {
      serviceName: "vitrine-core",
      env: { ...process.env, VITRINE_STATIC_DIR: RENDERER_DIR },
    });
    core.once("message", (message: { type: string } & Session) => {
      if (message.type === "ready") {
        resolve({ port: message.port, token: message.token });
      }
    });
    core.on("exit", (code) => {
      console.error(`vitrine-core exited with code ${code}`);
    });
  });
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
      // Give the renderer a moment to fetch health and paint the result.
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
  session = await startCore();

  // Answered synchronously for the preload; only our own window may ask.
  ipcMain.on("vitrine:session", (event) => {
    const fromOurWindow = BrowserWindow.getAllWindows().some(
      (w) => w.webContents.id === event.sender.id
    );
    event.returnValue = fromOurWindow ? session : null;
  });

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
