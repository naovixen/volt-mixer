import { createVoltEngine, type IVoltEngine } from "../lib/engine/engine.ts";
import { holdControlLock } from "./control-lock.ts";
import { useEngine, type IEngineClient } from "./engine-client.ts";
import { notice } from "./notices.ts";
import { engineStore, loadTrayHidden, loadView, saveTrayHidden, saveView } from "./store.ts";
import * as volt from "./transport-webhid.ts";

/*
 * The website: the engine runs in this page, driving the Volt over WebHID, with this browser's
 * storage. Only one tab drives it (control-lock.ts).
 */

/** Where a mix link points: the website, wherever this page is served from. */
const linkBase = (): string => new URL(import.meta.env.BASE_URL, location.origin).href;

/** The engine as the views use it, with Connect and Disconnect going to WebHID. */
const clientOf = (engine: IVoltEngine): IEngineClient => ({
    ...engine,
    receiveMixLink: (link) => engine.receiveMixLink(link, location.href),
    setView: (change) => {
        engine.setView(change);
        const { isDigitalShown, isLoopbackShown, trayHidden } = engine.snapshot().view;
        saveView({ isDigitalShown, isLoopbackShown });
        saveTrayHidden(trayHidden);
    },
    connect: () =>
        void volt
            .pair()
            .then(
                (result) =>
                    result === "cancelled" &&
                    notice('No Volt was chosen. Click Connect Volt and pick "Volt 4 Gen 2".', { kind: "info" }),
            ),
    disconnect: () => void volt.disconnect(),
});

export const startWebEngine = (): IVoltEngine => {
    const engine = createVoltEngine({
        transport: { send: volt.send },
        store: engineStore,
        options: { isWebsite: true, linkBase: linkBase() },
        view: { ...loadView(), trayHidden: loadTrayHidden() },
    });
    useEngine(clientOf(engine));
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
    void holdControlLock(engine).then(onDecided);
    void volt.reconnect();
};
