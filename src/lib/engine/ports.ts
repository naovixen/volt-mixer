import type { IReport } from "../commands.ts";

/*
 * What the engine needs from where it runs. The website gives it WebHID and localStorage
 * (src/scripts/host-web.ts); the desktop app gives it node-hid and a file. Nothing here touches the
 * DOM or Node, so the same engine runs in both.
 */

/** Who the connected Volt said it is, from its identify reply. */
export interface IConnectionInfo {
    version: string;
    serial: string;
    /** The firmware whose protocol data is used: the Volt's own, or the closest one recorded. */
    specVersion: string;
    isExact: boolean;
    isIdentified: boolean;
}

/** The link to the connected Volt. Opening, identifying and noticing it's gone are the transport's. */
export interface ITransport {
    /** Sends in order to the Volt connected now; resolves once written (or dropped with the link). */
    send: (reports: IReport[]) => Promise<void>;
}

/** Where this computer's mix and display brightness are kept, per Volt serial. */
export interface IEngineStore {
    loadMix: (serial: string) => unknown;
    /** Saves the mix if it differs from what's saved; null forgets it. */
    saveMix: (serial: string, mix: unknown) => void;
    /** A mix from a link, kept until it can be applied. */
    loadPendingMix: () => unknown;
    savePendingMix: (mix: unknown) => void;
    loadBrightness: (serial: string) => number | null;
    saveBrightness: (serial: string, raw: number) => void;
}

export interface IEngineOptions {
    /**
     * The website leaves the mix to another Volt Mixer on this computer (src/lib/engine/ownership.ts);
     * the desktop app keeps it.
     */
    isWebsite: boolean;
    /** Where a mix link points: the website's address. */
    linkBase: string;
}
