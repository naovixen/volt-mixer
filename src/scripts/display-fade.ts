import { desktopApp } from "./desktop.ts";
import { getEngine } from "./engine-client.ts";

/*
 * The desktop app dims the Volt's display as its computer sleeps or shuts down, and the engine
 * fades it back up (src/lib/engine/fade.ts). The app asks through its preload; it also needs to
 * know whether this page drives a Volt, as it then dims it itself at shutdown.
 */

let reportedLive: boolean | null = null;

/** Tells the desktop app whether this page drives a Volt; only when that changes. */
export const reportVoltLive = (isLive: boolean): void => {
    if (isLive === reportedLive) return;
    reportedLive = isLive;
    desktopApp()?.setVoltLive(isLive);
};

/** The desktop app asks before sleep or shutdown, and again on waking (desktop/src/display-fade.ts). */
export const wireDisplayFade = (): void => {
    desktopApp()?.onDisplayFade((request) => (request === "dim" ? getEngine().dim() : (getEngine().undim(), true)));
};
