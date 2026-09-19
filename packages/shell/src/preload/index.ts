import { contextBridge, ipcRenderer } from "electron";

// The renderer is a browser client of the core (ADR 0005). The only thing it
// needs from the shell is where the core is and the session token, fetched
// once, synchronously, so the page never renders without it.
const session = ipcRenderer.sendSync("vitrine:session") as {
  port: number;
  token: string;
};

contextBridge.exposeInMainWorld("vitrine", session);
