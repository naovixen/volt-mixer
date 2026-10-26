import { devices, HID } from "node-hid";
import { brightness } from "../../src/lib/commands.ts";
import { dimmedBrightness } from "../../src/lib/display-fade.ts";
import { protocol, specFor } from "../../src/lib/spec.ts";
import type { IEngineHost } from "./engine-host.ts";
import { loadSettings } from "./settings.ts";

/*
 * Turns the Volt's display off as this computer sleeps or shuts down, if chosen in Settings, so it
 * isn't lit all night (src/lib/engine/fade.ts). Windows reports a shutdown only to windows
 * (query-session-end), and goes on as soon as the handler returns: too soon for a write that
 * waits its turn. So the report is also written here synchronously, before returning, on a handle
 * of its own. Only while the engine drives the Volt: a Volt with firmware it doesn't know waits
 * for the user's go-ahead, and so does this. Waking fades the display back up.
 */

let host: IEngineHost | null = null;

export const useEngineHost = (next: IEngineHost): void => {
    host = next;
};

/** The dimming report for the connected Volt's firmware, written now and in full. */
const writeDimReport = (): void => {
    const connection = host?.engine.snapshot().connection;
    if (!connection) return;
    const report = brightness(specFor(connection.specVersion).spec, dimmedBrightness);
    const info = devices(protocol.vendorId, protocol.productId).find(
        (device) => device.usagePage === protocol.controlUsagePage,
    );
    if (!info?.path) return;
    try {
        const volt = new HID(info.path, { nonExclusive: true });
        volt.write([report.reportId, ...report.data]);
        volt.close();
    } catch {
        /* Gone already (the KVM switched away): nothing to dim. */
    }
};

/** Before sleep, shutdown or signing out (lifecycle.ts). */
export const dimDisplay = (): void => {
    if (!host || !loadSettings().dimOnSleep || !host.engine.snapshot().isLive) return;
    if (!host.isBench) writeDimReport();
    host.engine.dim();
};

/** On waking. */
export const undimDisplay = (): void => host?.engine.undim();
