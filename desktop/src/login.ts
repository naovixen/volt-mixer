import { app } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import type { IDesktopSettings } from "./settings.ts";

/*
 * Start at login. Windows and macOS have login items; Linux uses an XDG autostart file. Windows
 * passes --hidden so the app knows it was started at login; macOS reports it instead.
 */

const hiddenFlag = "--hidden";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

const autostartFile = (): string =>
    path.join(process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config"), "autostart", "volt-mixer.desktop");

/** An AppImage runs from a temporary mount; $APPIMAGE is the file the user actually has. */
const executable = (): string => process.env["APPIMAGE"] ?? process.execPath;

const writeAutostart = (isOn: boolean): void => {
    try {
        if (!isOn) return fs.rmSync(autostartFile(), { force: true });
        fs.mkdirSync(path.dirname(autostartFile()), { recursive: true });
        const entry = [
            "[Desktop Entry]",
            "Type=Application",
            "Name=Volt Mixer",
            `Exec="${executable()}" ${hiddenFlag}`,
        ];
        fs.writeFileSync(autostartFile(), `${entry.join("\n")}\n`);
    } catch {
        /* Autostart folder not writable: the setting just won't take effect. */
    }
};

/**
 * Turns start at login on or off. Called on every launch too, so a moved AppImage is followed.
 * Not from `pnpm start`: that would register bare electron.exe, which opens Electron's own page.
 */
export const applyLoginItem = (isOn: boolean): void => {
    if (!app.isPackaged) return;
    if (isLinux) return writeAutostart(isOn);
    app.setLoginItemSettings(isMac ? { openAtLogin: isOn } : { openAtLogin: isOn, args: [hiddenFlag] });
};

/** Whether this launch came from login and the user wants it to stay in the tray. */
export const isStartedInTray = (settings: IDesktopSettings): boolean => {
    const isAtLogin = process.argv.includes(hiddenFlag) || (isMac && app.getLoginItemSettings().wasOpenedAtLogin);
    return isAtLogin && settings.loginStart === "tray";
};

/** macOS may need approval in System Settings › General › Login Items, especially unsigned. */
export const loginItemStatus = (): string => {
    if (!isMac) return "";
    const { status } = app.getLoginItemSettings();
    return status === "requires-approval" ? "Allow Volt Mixer in System Settings › General › Login Items." : "";
};
