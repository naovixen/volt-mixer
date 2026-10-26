import { contextBridge, ipcRenderer } from "electron";

/*
 * The tray window's window.voltTray: only what the tray page needs. It can change levels and
 * mutes (the engine in main checks each change), size and hide itself, and open the main window;
 * never the app's settings or the phone remote.
 */

contextBridge.exposeInMainWorld("voltTray", {
    /** The content's height in CSS px; the app sizes the window to it. */
    fitTray: (height: number): void => ipcRenderer.send("tray:fit", height),
    hideTray: (): void => ipcRenderer.send("tray:hide"),
    openMainWindow: (): void => ipcRenderer.send("tray:open-main"),
    /** Asks for what the tray shows now; it then comes each time it changes, while the window is shown. */
    hello: (): void => ipcRenderer.send("tray:hello"),
    sendIntent: (intent: unknown): Promise<unknown> => ipcRenderer.invoke("tray:intent", intent),
    onSnapshot: (handler: (snapshot: unknown) => void): void => {
        ipcRenderer.on("tray:snapshot", (_event, snapshot: unknown) => handler(snapshot));
    },
});
