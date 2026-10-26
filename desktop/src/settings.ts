import { app } from "electron";
import fs from "fs";
import path from "path";
import { clean, defaults, type IDesktopSettings } from "./settings-rules.ts";

export type { IDesktopSettings };

/*
 * The desktop app's own settings, in a JSON file in the user data folder. Main reads them before
 * any window exists (whether to start in the tray); the page edits them through the preload.
 */

const file = (): string => path.join(app.getPath("userData"), "settings.json");
let current: IDesktopSettings | null = null;

export const loadSettings = (): IDesktopSettings => {
    if (current) return current;
    try {
        current = clean(JSON.parse(fs.readFileSync(file(), "utf8")), defaults);
    } catch {
        current = { ...defaults };
    }
    return current;
};

/** Merges a change into the settings and saves them; returns the result. */
export const saveSettings = (change: unknown): IDesktopSettings => {
    current = clean(change, loadSettings());
    try {
        fs.mkdirSync(path.dirname(file()), { recursive: true });
        fs.writeFileSync(file(), JSON.stringify(current, null, 4));
    } catch {
        /* Not writable: the change holds until the app quits. */
    }
    return current;
};
