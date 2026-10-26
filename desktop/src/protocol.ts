import { protocol, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { csp, readSiteFile } from "./site-files.ts";

/*
 * The site is served from app://volt/, a secure origin (WebHID needs one) where the build's
 * root-absolute URLs (/_astro/...) resolve. Every response carries the strict CSP.
 */

export const appOrigin = "app://volt";

/**
 * IPC is answered only for the window it's meant for (windows.ts: isFromMainWindow,
 * isFromTrayWindow), and only while that window shows the app's own page.
 */
export const isFromWindow = (event: IpcMainEvent | IpcMainInvokeEvent, window: BrowserWindow | null): boolean =>
    window !== null &&
    event.sender === window.webContents &&
    event.senderFrame?.url.startsWith(`${appOrigin}/`) === true;

/** Before the app is ready: makes app:// a standard, secure scheme. */
export const registerAppScheme = (): void =>
    protocol.registerSchemesAsPrivileged([
        { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
    ]);

/** Serves the built site (site-files.ts) from app://volt/. */
export const serveSite = (): void =>
    protocol.handle("app", async (request) => {
        const url = new URL(request.url);
        const file = url.host === "volt" ? await readSiteFile(url.pathname) : null;
        if (!file) return new Response("Not found", { status: 404 });
        return new Response(file.body, { headers: { "Content-Type": file.type, "Content-Security-Policy": csp } });
    });
