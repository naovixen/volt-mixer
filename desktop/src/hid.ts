import type { Session } from "electron";
import { appOrigin } from "./protocol.ts";

/*
 * What the app's pages may use. The Volt is driven from main (engine-host.ts, through node-hid),
 * so no page gets WebHID or any other device: only writing to the clipboard (Copy link), and only
 * the app's own pages.
 */

const isAppOrigin = (origin: string | undefined): boolean => origin === appOrigin;
const allowedPermissions = new Set(["clipboard-sanitized-write"]);

export const limitPermissions = (session: Session): void => {
    session.setPermissionCheckHandler(
        (_contents, permission, origin) => isAppOrigin(origin) && allowedPermissions.has(permission),
    );
    session.setPermissionRequestHandler((contents, permission, callback) =>
        // Not new URL(…).origin: for a custom scheme like app:// that's "null".
        callback(contents.getURL().startsWith(`${appOrigin}/`) && allowedPermissions.has(permission)),
    );
    session.setDevicePermissionHandler(() => false);
    session.on("select-hid-device", (event, _details, callback) => {
        event.preventDefault();
        callback("");
    });
};
