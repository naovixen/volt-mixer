import { desktopApp } from "./desktop.ts";

/*
 * Whether anyone can see the mixer page. In a browser the Page Visibility API says. In the desktop
 * app it can't: background throttling is off (so the hidden window keeps answering the tray and
 * the Volt), and that also makes a hidden window count as visible, so the app says instead
 * (desktop/src/windows.ts). The meters and views draw only while the page is seen, and catch up
 * when it's shown again; in the tray, the app idles.
 */

let isWindowShown = true;
const listeners = new Set<(isShown: boolean) => void>();

export const isPageShown = (): boolean => (desktopApp() ? isWindowShown : document.visibilityState === "visible");

/** `listen` runs each time the page is shown or hidden. */
export const onPageVisibility = (listen: (isShown: boolean) => void): void => void listeners.add(listen);

const tell = (isShown: boolean): void => listeners.forEach((listen) => listen(isShown));

export const wirePageVisibility = (): void => {
    const desktop = desktopApp();
    if (!desktop) {
        document.addEventListener("visibilitychange", () => tell(document.visibilityState === "visible"));
        return;
    }
    desktop.onWindowVisible((isVisible) => {
        const wasShown = isWindowShown;
        isWindowShown = isVisible;
        if (isVisible !== wasShown) tell(isVisible);
    });
};
