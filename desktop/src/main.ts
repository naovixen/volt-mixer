import { app, session } from "electron";
import { useEngineHost } from "./display-fade.ts";
import { createEngineHost, type IEngineHost, type IViews } from "./engine-host.ts";
import { limitPermissions } from "./hid.ts";
import { answerPages } from "./ipc.ts";
import { watchLifecycle } from "./lifecycle.ts";
import { applyLoginItem, isStartedInTray } from "./login.ts";
import { reconcilePhoneRemote, tellPhoneStatus, whenPhoneJoins } from "./phone.ts";
import { answerPhoneIntents } from "./phone-server.ts";
import { registerAppScheme, serveSite } from "./protocol.ts";
import { loadSettings } from "./settings.ts";
import { createTray } from "./tray.ts";
import {
    createMainWindow,
    createSessionWindow,
    getMainWindow,
    getTrayWindow,
    showMainWindow,
    whenMainLoaded,
    whenTrayShown,
} from "./windows.ts";

/*
 * Volt Mixer's desktop app: the engine (src/lib/engine) in this process, driving the Volt, and the
 * website (built into ./site) in a window to show it, plus a tray icon, tray mixer and phone
 * remote. One instance at a time: a second launch shows the first.
 */

/** Where the engine's changes go: the main window's page, and the tray window's. */
const views = (): IViews => {
    const tray = getTrayWindow();
    return {
        // A page still loading may miss what's sent; it says hello once it listens, and gets everything then.
        sendToMain: (channel, ...args) => {
            const window = getMainWindow();
            if (window && !window.isDestroyed()) window.webContents.send(channel, ...args);
        },
        sendToTray: (channel, ...args) => tray?.webContents.send(channel, ...args),
        isTrayShown: tray?.isVisible() ?? false,
    };
};

/**
 * The page used to keep this computer's mix; on the first start without the engine's own file,
 * the main window opens (hidden, if the app starts in the tray) so its page can hand it over.
 */
const openWindows = (host: IEngineHost): void => {
    const isShown = !isStartedInTray(loadSettings());
    if (isShown || host.store.isFresh()) createMainWindow(isShown);
};

const start = (): void => {
    const settings = loadSettings();
    serveSite();
    limitPermissions(session.defaultSession);
    const host = createEngineHost(views);
    useEngineHost(host);
    answerPages(host);
    answerPhoneIntents(host.runRemoteIntent);
    whenPhoneJoins(() => host.engine.reread());
    whenMainLoaded(() => tellPhoneStatus());
    whenTrayShown(host.greetTray);
    applyLoginItem(settings.startAtLogin);
    createTray();
    watchLifecycle(host, createSessionWindow());
    openWindows(host);
    void reconcilePhoneRemote();
};

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    // Drawing in software: a mixer page needs no GPU, and without a GPU process the app takes about
    // 40% less memory in the tray and less CPU in a drag, the same idle (docs/performance.md).
    app.disableHardwareAcceleration();
    registerAppScheme();
    app.on("second-instance", showMainWindow);
    // The app lives in the tray with no window open; closing the last one doesn't quit it (windows.ts).
    app.on("window-all-closed", () => {});
    // A start that fails says why and ends, rather than leaving an app with nothing running.
    void app
        .whenReady()
        .then(start)
        .catch((error: unknown) => {
            console.error(error);
            app.exit(1);
        });
}
