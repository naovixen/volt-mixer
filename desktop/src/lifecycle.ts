import { app, powerMonitor, session, type BaseWindow } from "electron";
import { dimDisplay, undimDisplay } from "./display-fade.ts";
import type { IEngineHost } from "./engine-host.ts";
import { reconcilePhoneRemote, stopPhoneRemote } from "./phone.ts";
import { markQuitting, showMainWindow } from "./windows.ts";

/*
 * Everything the app does as it goes away, for a while (sleep) or for good (Quit, shutdown,
 * signing out), and as it comes back. Each system says so differently: Quit sends before-quit,
 * macOS and Linux shutdowns send powerMonitor's shutdown, and Windows tells only windows
 * (query-session-end, then session-end), which the session window hears (windows.ts), and
 * doesn't send before-quit at all.
 */

/** The mix and the display's brightness, written out now: the store waits a moment otherwise. */
const saveStorage = (host: IEngineHost): void => {
    host.engine.saveNow();
    host.store.flush();
    // The theme is still the page's (localStorage), which Chromium writes out only now and then.
    session.defaultSession.flushStorageData();
};

export const watchLifecycle = (host: IEngineHost, sessionWindow: BaseWindow): void => {
    /** Sleeping, or a Windows shutdown asked about (which another program may yet refuse). */
    const pausing = (): void => {
        dimDisplay();
        saveStorage(host);
    };
    /** For good: windows that hide to the tray close instead. */
    const quitting = (): void => {
        markQuitting();
        saveStorage(host);
    };
    app.on("before-quit", () => {
        quitting();
        stopPhoneRemote();
        void host.stop();
    });
    powerMonitor.on("shutdown", () => {
        dimDisplay();
        quitting();
    });
    powerMonitor.on("suspend", pausing);
    sessionWindow.on("query-session-end", pausing);
    sessionWindow.on("session-end", quitting);
    powerMonitor.on("resume", () => {
        undimDisplay();
        void reconcilePhoneRemote();
    });
    // macOS: the Dock icon clicked (or the app opened again) while its window is in the tray.
    app.on("activate", showMainWindow);
};
