import { contextBridge, ipcRenderer } from "electron";

/*
 * The main window's window.voltDesktop: the only way the mixer page reaches the app. Its presence
 * is also how the page knows it's in the desktop app (Settings › Desktop app appears, and the page
 * shows the engine in main rather than running its own). The tray window has its own, smaller one
 * (tray-preload.cts).
 */

const listen = (channel: string, handler: (...args: unknown[]) => void): void => {
    ipcRenderer.on(channel, (_event, ...args: unknown[]) => handler(...args));
};

contextBridge.exposeInMainWorld("voltDesktop", {
    getState: (): Promise<unknown> => ipcRenderer.invoke("desktop:get"),
    setSettings: (change: unknown): Promise<unknown> => ipcRenderer.invoke("desktop:set", change),
    checkForUpdate: (): Promise<unknown> => ipcRenderer.invoke("desktop:check-update"),
    setTheme: (theme: string): void => ipcRenderer.send("desktop:theme", theme),
    /** The phone remote: its address and link, a new pairing code, and its state as it changes. */
    phoneInfo: (): Promise<unknown> => ipcRenderer.invoke("desktop:phone-info"),
    rotatePhone: (): Promise<unknown> => ipcRenderer.invoke("desktop:phone-rotate"),
    onPhoneStatus: (handler: (info: unknown) => void): void => listen("phone:status", handler),
    /** The engine in main (desktop/src/engine-host.ts): what it holds, and the page's changes for it. */
    engine: {
        hello: (): void => ipcRenderer.send("engine:hello"),
        sendIntent: (seq: number, intent: unknown): void => ipcRenderer.send("engine:intent", seq, intent),
        command: (name: string, ...args: unknown[]): Promise<unknown> =>
            ipcRenderer.invoke("engine:command", name, ...args),
        setMetersWanted: (isWanted: boolean): void => ipcRenderer.send("engine:meters-wanted", isWanted),
        onPatch: (handler: (patch: unknown) => void): void => listen("engine:patch", handler),
        onMessage: (handler: (text: unknown, kind: unknown) => void): void =>
            listen("engine:message", (text, kind) => handler(text, kind)),
        onMeters: (handler: (frame: unknown) => void): void => listen("engine:meters", handler),
    },
});
