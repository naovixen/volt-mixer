import { app, Menu, nativeImage, Tray } from "electron";
import path from "path";
import { applyLoginItem } from "./login.ts";
import { loadSettings, saveSettings } from "./settings.ts";
import { markQuitting, showMainWindow, toggleTrayWindow } from "./windows.ts";

/*
 * The tray icon. A click opens the tray mixer (Windows and macOS); the menu has the rest. Linux
 * tray icons have no reliable click or position, so there the menu's "Mixer" opens it instead.
 */

let tray: Tray | null = null;

const iconPath = (): string => {
    const file = process.platform === "darwin" ? "trayTemplate.png" : "tray.png";
    return path.join(app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "build"), file);
};

const buildMenu = (): Menu =>
    Menu.buildFromTemplate([
        { label: "Open Volt Mixer", click: showMainWindow },
        { label: "Mixer", click: () => void toggleTrayWindow(tray?.getBounds()) },
        { type: "separator" },
        {
            label: "Start at login",
            type: "checkbox",
            checked: loadSettings().startAtLogin,
            click: (item) => {
                saveSettings({ startAtLogin: item.checked });
                applyLoginItem(item.checked);
            },
        },
        { type: "separator" },
        { label: "Quit Volt Mixer", click: () => (markQuitting(), app.quit()) },
    ]);

/**
 * Rebuilds the menu, so its Start at login tick follows a change made in Settings. On macOS a
 * context menu would take over the left click too, so there it pops up on a right click instead.
 */
export const refreshTrayMenu = (): void => {
    if (process.platform !== "darwin") tray?.setContextMenu(buildMenu());
};

export const createTray = (): void => {
    const image = nativeImage.createFromPath(iconPath());
    if (process.platform === "darwin") image.setTemplateImage(true);
    tray = new Tray(image);
    tray.setToolTip("Volt Mixer");
    refreshTrayMenu();
    if (process.platform !== "linux") tray.on("click", (_event, bounds) => void toggleTrayWindow(bounds));
    if (process.platform === "darwin") tray.on("right-click", () => tray?.popUpContextMenu(buildMenu()));
};
