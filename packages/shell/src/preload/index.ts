import { contextBridge, ipcRenderer, webUtils } from "electron";

// The renderer is a browser client of the core (ADR 0005). What it needs from
// the shell is where the core is and the session token, fetched once,
// synchronously, so the page never renders without it…
const session = ipcRenderer.sendSync("vitrine:session") as {
  port: number;
  token: string;
};

// …and one function: where on disk a file dropped on an Experiment page is
// (ADR 0035). A page is not given a dropped file's path — only the preload
// can ask Electron for it — and the core copies from a path, so this is the
// one thing the drop needs. Nothing else of `webUtils` crosses the bridge.
contextBridge.exposeInMainWorld("vitrine", {
  ...session,
  pathOf: (file: File) => webUtils.getPathForFile(file),
});

// App ▸ Settings…, as the page event the window's own ⌘, raises. An event
// and not a bridged function: nothing crosses into the page but the name,
// and whether Settings opens stays the window's call — it is not listening
// on First run (ADR 0025 decision 5).
ipcRenderer.on("vitrine:settings", () => {
  window.dispatchEvent(new Event("vitrine:settings"));
});
