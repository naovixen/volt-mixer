import { createVoltEngine, type IVoltEngine } from "../lib/engine/engine.ts";
import { site } from "../lib/site.ts";
import { holdControlLock } from "./control-lock.ts";
import { desktopApp } from "./desktop.ts";
import { useEngine } from "./engine-client.ts";
import { notice } from "./notices.ts";
import { engineStore, loadTrayHidden, loadView } from "./store.ts";
import * as volt from "./transport-webhid.ts";

/*
 * The engine in this page, driving the Volt over WebHID with this browser's storage: the website,
 * and (until the engine moves to the app's main process) the desktop app's main window.
 */

/** Where a mix link points: the website, wherever this page is served from. */
const linkBase = (): string =>
    desktopApp() ? site.websiteUrl : new URL(import.meta.env.BASE_URL, location.origin).href;

export const startEngine = (): IVoltEngine => {
    const engine = createVoltEngine({
        transport: { send: volt.send },
        store: engineStore,
        options: { isWebsite: desktopApp() === null, linkBase: linkBase() },
        view: { ...loadView(), trayHidden: loadTrayHidden() },
    });
    useEngine(engine);
    return engine;
};

/**
 * Connects the engine to the Volt: the device events, catching up when the page comes back (a
 * page in the background may be well behind, as browsers slow its timers), and saving on leaving.
 * Only once this tab holds the control lock does it drive the Volt; `onDecided` runs when that's known.
 */
export const driveVolt = (engine: IVoltEngine, onDecided: () => void): void => {
    volt.watchDevices({
        connected: engine.connected,
        disconnected: engine.disconnected,
        report: engine.report,
        error: (message) => notice(message, { kind: "error" }),
    });
    window.addEventListener("focus", engine.reread);
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && engine.reread());
    window.addEventListener("pagehide", engine.saveNow);
    void holdControlLock().then(onDecided);
    void volt.reconnect();
};
