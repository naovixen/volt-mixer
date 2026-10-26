import { app, ipcMain, nativeTheme } from "electron";
import type { ConditionCommand } from "../../src/lib/engine/core.ts";
import type { IEngineView } from "../../src/lib/engine/core.ts";
import type { IEngineHost } from "./engine-host.ts";
import { applyLoginItem, loginItemStatus } from "./login.ts";
import { phoneInfo, reconcilePhoneRemote, rotatePhoneToken, setUpAddress } from "./phone.ts";
import { loadSettings, saveSettings } from "./settings.ts";
import {
    closeHiddenMainWindow,
    fitTrayWindow,
    hideTrayWindow,
    isFromMainWindow,
    isFromTrayWindow,
    showMainWindow,
} from "./windows.ts";
import { refreshTrayMenu } from "./tray.ts";
import { checkForUpdate } from "./update.ts";

/*
 * What each window can ask of the app (through preload.cts and tray-preload.cts). Each request is
 * answered only for the window whose preload offers it: the tray can change levels and mutes, and
 * size and hide itself; only the main window reaches the rest.
 */

const desktopState = () => ({
    settings: loadSettings(),
    version: app.getVersion(),
    platform: process.platform,
    loginStatus: loginItemStatus(),
});

const setSettings = (change: unknown) => {
    const before = loadSettings();
    let settings = saveSettings(change);
    if (settings.phoneRemote && !before.phoneRemote)
        settings = saveSettings({ phoneAddress: setUpAddress(settings.phoneAddress) });
    if (settings.startAtLogin !== before.startAtLogin) applyLoginItem(settings.startAtLogin);
    void reconcilePhoneRemote();
    refreshTrayMenu();
    return desktopState();
};

const themes = new Set(["system", "light", "dark"]);
const conditionCommands = new Set<string>(["allow-sending", "clear-hidden-solo"]);

const answerDesktop = (): void => {
    ipcMain.handle("desktop:get", (event) => (isFromMainWindow(event) ? desktopState() : null));
    ipcMain.handle("desktop:set", (event, change: unknown) => (isFromMainWindow(event) ? setSettings(change) : null));
    ipcMain.handle("desktop:check-update", (event) => (isFromMainWindow(event) ? checkForUpdate() : null));
    ipcMain.on("desktop:theme", (event, theme: unknown) => {
        if (isFromMainWindow(event) && typeof theme === "string" && themes.has(theme))
            nativeTheme.themeSource = theme as "system" | "light" | "dark";
    });
    ipcMain.handle("desktop:phone-info", (event) => (isFromMainWindow(event) ? phoneInfo() : null));
    ipcMain.handle("desktop:phone-rotate", (event) => {
        if (!isFromMainWindow(event)) return null;
        rotatePhoneToken();
        return phoneInfo();
    });
};

/** The view settings the page may change (Settings › View, the tray's rows). */
const viewChange = (value: unknown): Partial<IEngineView> => {
    const change = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
    const view: Partial<IEngineView> = {};
    if (typeof change["isDigitalShown"] === "boolean") view.isDigitalShown = change["isDigitalShown"];
    if (typeof change["isLoopbackShown"] === "boolean") view.isLoopbackShown = change["isLoopbackShown"];
    if (Array.isArray(change["trayHidden"]))
        view.trayHidden = change["trayHidden"].filter((id): id is string => typeof id === "string");
    return view;
};

/** The engine's actions, by name, with the page's arguments checked. */
const engineCommands = (host: IEngineHost): Record<string, (...args: unknown[]) => unknown> => {
    const { engine, transport, store } = host;
    return {
        connect: () => transport.connect(),
        disconnect: () => transport.disconnect(),
        pushMix: engine.pushMix,
        forgetMix: engine.forgetMix,
        resetMix: engine.resetMix,
        identify: engine.identify,
        reread: engine.reread,
        runCondition: (command) =>
            conditionCommands.has(String(command)) && engine.runCondition(command as ConditionCommand),
        startAutoGain: (mask, seconds) =>
            Number.isInteger(mask) && Number.isFinite(seconds) && engine.startAutoGain(Number(mask), Number(seconds)),
        receiveMixLink: (link) => (typeof link === "string" ? engine.receiveMixLink(link, "app://volt/") : null),
        setView: (change) => {
            const view = viewChange(change);
            engine.setView(view);
            store.saveView(view);
        },
        importLegacy: (legacy) => {
            const isTaken = store.importLegacy(typeof legacy === "object" && legacy !== null ? legacy : {});
            if (isTaken && !engine.snapshot().state.isMixOwned) engine.takeSavedMix();
            closeHiddenMainWindow();
            return isTaken;
        },
    };
};

const answerEngine = (host: IEngineHost): void => {
    const commands = engineCommands(host);
    ipcMain.on("engine:intent", (event, seq: unknown, intent: unknown) => {
        if (isFromMainWindow(event) && Number.isSafeInteger(seq)) host.runPageIntent(Number(seq), intent);
    });
    ipcMain.handle("engine:command", (event, name: unknown, ...args: unknown[]) =>
        isFromMainWindow(event) && typeof name === "string" && Object.hasOwn(commands, name)
            ? commands[name]!(...args)
            : null,
    );
    ipcMain.on("engine:meters-wanted", (event, isWanted: unknown) => {
        if (isFromMainWindow(event)) host.setMetersWanted(isWanted === true);
    });
    ipcMain.on("engine:hello", (event) => isFromMainWindow(event) && host.greetMain());
};

const answerTrayWindow = (host: IEngineHost): void => {
    ipcMain.on("tray:open-main", (event) => isFromTrayWindow(event) && showMainWindow());
    ipcMain.on("tray:hide", (event) => isFromTrayWindow(event) && hideTrayWindow());
    ipcMain.on("tray:fit", (event, height: unknown) => {
        if (isFromTrayWindow(event) && typeof height === "number") fitTrayWindow(height);
    });
    ipcMain.handle("tray:intent", (event, intent: unknown) =>
        isFromTrayWindow(event) ? host.runRemoteIntent(intent) : "ignored",
    );
    ipcMain.on("tray:hello", (event) => isFromTrayWindow(event) && host.greetTray());
};

export const answerPages = (host: IEngineHost): void => {
    answerDesktop();
    answerEngine(host);
    answerTrayWindow(host);
};
