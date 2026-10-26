import type { Session } from "electron";
import { appOrigin } from "./protocol";
import { readSiteJson } from "./site-files";
import { parseVoltHid, type IVoltHid } from "./volt-hid";

/*
 * WebHID in the app. The page's own code (src/scripts/transport-webhid.ts) talks to the Volt as it
 * does in a browser; these handlers stand in for Chrome's permission prompts. The Volt is allowed
 * without asking, so it connects at startup. Main can't see HID collections, so the page still
 * checks for the Volt's control interface itself. Which Volts are allowed comes from src/data,
 * through the site (volt-hid.ts).
 */

let hid: IVoltHid | null | undefined;

/** The supported Volts, or null when the build left them out (then none is allowed). */
export const voltHid = (): IVoltHid | null => {
    if (hid === undefined) hid = parseVoltHid(readSiteJson("desktop-hid.json"));
    return hid;
};

/* Serial devices report their IDs as strings; only HID devices (numbers) can be the Volt. */
const isVolt = (device: {
    vendorId?: number | string | undefined;
    productId?: number | string | undefined;
}): boolean => {
    const volts = voltHid();
    if (!volts || device.vendorId !== volts.vendorId || typeof device.productId !== "number") return false;
    return volts.dimReports.has(device.productId);
};

const isAppOrigin = (origin: string | undefined): boolean => origin === appOrigin;

/** Only HID (for the Volt) and writing to the clipboard (Copy link) are allowed, and only for the app. */
const allowedPermissions = new Set(["hid", "clipboard-sanitized-write"]);

export const allowVolt = (session: Session): void => {
    session.setPermissionCheckHandler(
        (_contents, permission, origin) => isAppOrigin(origin) && allowedPermissions.has(permission),
    );
    session.setPermissionRequestHandler((contents, permission, callback) =>
        // Not new URL(…).origin: for a custom scheme like app:// that's "null".
        callback(contents.getURL().startsWith(`${appOrigin}/`) && allowedPermissions.has(permission)),
    );
    session.setDevicePermissionHandler(
        (details) => details.deviceType === "hid" && isAppOrigin(details.origin) && isVolt(details.device),
    );
    // Connect Volt after a Disconnect: pick the Volt instead of showing a chooser.
    session.on("select-hid-device", (event, details, callback) => {
        event.preventDefault();
        callback(details.deviceList.find(isVolt)?.deviceId ?? "");
    });
};
