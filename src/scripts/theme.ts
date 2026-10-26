import { site } from "../lib/site.ts";
import { desktopApp } from "./desktop.ts";

/* System, Light or Dark. Every colour is a light-dark() pair, so the theme is just color-scheme. */

export type Theme = "system" | "light" | "dark";

export const isTheme = (value: unknown): value is Theme => value === "system" || value === "light" || value === "dark";

let shownTheme: Theme = "system";

/** The theme the page shows now. */
export const currentTheme = (): Theme => shownTheme;

/** Sets the page's colour scheme, the browser bar colour and (in the desktop app) its windows. */
export const applyTheme = (theme: Theme): void => {
    shownTheme = theme;
    desktopApp()?.setTheme(theme);
    if (theme === "system") delete document.documentElement.dataset["theme"];
    else document.documentElement.dataset["theme"] = theme;
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
        const scheme = theme === "system" ? (meta.media.includes("dark") ? "dark" : "light") : theme;
        meta.content = site.themeColor[scheme];
    }
};
