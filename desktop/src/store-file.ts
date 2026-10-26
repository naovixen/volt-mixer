import fs from "fs";
import path from "path";
import type { IEngineView } from "../../src/lib/engine/core.ts";
import type { IEngineStore } from "../../src/lib/engine/ports.ts";

/*
 * What the app's engine keeps: this computer's mix and display brightness per Volt, a mix link
 * waiting for the Volt, and what the viewer chose to see. One JSON file in the user data folder,
 * written a moment after a change (a drag changes it many times a second) and at once on quitting,
 * sleeping or shutting down; through a temporary file, so a crash mid-write can't leave half of it.
 *
 * The page used to keep all this in its own storage; the main window hands it over once
 * (importLegacy), and only what this file doesn't have yet is taken.
 */

const writeDelayMs = 1000;

interface IStoreData {
    mixes: Record<string, unknown>;
    brightness: Record<string, number>;
    pendingMix: unknown;
    view: { isDigitalShown: boolean; isLoopbackShown: boolean };
    trayHidden: string[];
}

/** What the page used to keep, as it sends it: each part as its storage held it. */
export interface ILegacyStore {
    mixes?: unknown;
    brightness?: unknown;
    pendingMix?: unknown;
    view?: unknown;
    trayHidden?: unknown;
}

const record = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const isRaw = (value: unknown): value is number =>
    Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 255;
const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** Digital inputs start hidden and the loopback channel shown, as in Console. */
const readView = (value: unknown): IStoreData["view"] => {
    const view = record(value);
    return { isDigitalShown: view["isDigitalShown"] === true, isLoopbackShown: view["isLoopbackShown"] !== false };
};

const brightnessOf = (value: unknown): Record<string, number> =>
    Object.fromEntries(Object.entries(record(value)).filter((entry): entry is [string, number] => isRaw(entry[1])));

/** The file's contents, checked; anything missing or wrong is left out. */
export const readStoreData = (value: unknown): IStoreData => {
    const data = record(value);
    return {
        mixes: record(data["mixes"]),
        brightness: brightnessOf(data["brightness"]),
        pendingMix: data["pendingMix"] ?? null,
        view: readView(data["view"]),
        trayHidden: strings(data["trayHidden"]),
    };
};

/** Takes from the page's old storage only what `data` doesn't have yet; true if anything was taken. */
export const mergeLegacy = (data: IStoreData, legacy: ILegacyStore, isFresh: boolean): boolean => {
    let isTaken = false;
    for (const [serial, mix] of Object.entries(record(legacy.mixes))) {
        if (data.mixes[serial] !== undefined || mix === null) continue;
        data.mixes[serial] = mix;
        isTaken = true;
    }
    for (const [serial, raw] of Object.entries(brightnessOf(legacy.brightness))) {
        if (data.brightness[serial] === undefined) data.brightness[serial] = raw;
    }
    if (data.pendingMix === null && legacy.pendingMix) data.pendingMix = legacy.pendingMix;
    // The view and the tray's rows are taken only by a file that's new: they have defaults of their own.
    if (isFresh && legacy.view !== undefined) data.view = readView(legacy.view);
    if (isFresh && legacy.trayHidden !== undefined) data.trayHidden = strings(legacy.trayHidden);
    return isTaken;
};

export interface IFileStore {
    engineStore: IEngineStore;
    view: () => IEngineView;
    saveView: (view: Partial<IEngineView>) => void;
    /** True until the file is first written: the page's old storage may still hold the mix. */
    isFresh: () => boolean;
    importLegacy: (legacy: ILegacyStore) => boolean;
    /** Writes now if anything is waiting (quitting, sleeping, shutting down). */
    flush: () => void;
}

const load = (file: string): { data: IStoreData; isFresh: boolean } => {
    try {
        return { data: readStoreData(JSON.parse(fs.readFileSync(file, "utf8"))), isFresh: false };
    } catch {
        return { data: readStoreData({}), isFresh: !fs.existsSync(file) };
    }
};

export const createFileStore = (file: string): IFileStore => {
    const loaded = load(file);
    const data = loaded.data;
    let isFresh = loaded.isFresh;
    let timer: NodeJS.Timeout | undefined;
    const flush = (): void => {
        clearTimeout(timer);
        timer = undefined;
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
            fs.renameSync(`${file}.tmp`, file);
            isFresh = false;
        } catch {
            /* Not writable: what's kept holds until the app quits. */
        }
    };
    const changed = (): void => void (timer ??= setTimeout(flush, writeDelayMs));
    const engineStore: IEngineStore = {
        loadMix: (serial) => data.mixes[serial] ?? null,
        saveMix: (serial, mix) => {
            if (mix === null) delete data.mixes[serial];
            else data.mixes[serial] = mix;
            changed();
        },
        loadPendingMix: () => data.pendingMix,
        savePendingMix: (mix) => {
            data.pendingMix = mix;
            changed();
        },
        loadBrightness: (serial) => data.brightness[serial] ?? null,
        saveBrightness: (serial, raw) => {
            data.brightness[serial] = raw;
            changed();
        },
    };
    return {
        engineStore,
        view: () => ({ ...data.view, trayHidden: [...data.trayHidden] }),
        saveView: ({ trayHidden, ...view }) => {
            data.view = readView({ ...data.view, ...view });
            if (trayHidden) data.trayHidden = strings(trayHidden);
            changed();
        },
        isFresh: () => isFresh,
        importLegacy: (legacy) => {
            const isTaken = mergeLegacy(data, legacy, isFresh);
            flush();
            return isTaken;
        },
        flush: () => timer !== undefined && flush(),
    };
};
