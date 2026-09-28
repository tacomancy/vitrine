import { contextBridge, ipcRenderer } from "electron";

// The renderer is a browser client of the core (ADR 0005). The only thing it
// needs from the shell is where the core is and the session token, fetched
// once, synchronously, so the page never renders without it.
const session = ipcRenderer.sendSync("vitrine:session") as {
  port: number;
  token: string;
};

contextBridge.exposeInMainWorld("vitrine", session);

// App ▸ Settings…, as the page event the window's own ⌘, raises. An event
// and not a bridged function: nothing crosses into the page but the name,
// and whether Settings opens stays the window's call — it is not listening
// on First run (ADR 0025 decision 5).
ipcRenderer.on("vitrine:settings", () => {
  window.dispatchEvent(new Event("vitrine:settings"));
});
