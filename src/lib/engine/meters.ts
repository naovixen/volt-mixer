import type { ISpec } from "../spec.ts";

/*
 * The Volt sends a meter report 50 times a second, in silence too. Nothing is decoded while no one
 * is watching. While someone is, each report's peaks are kept (the highest since the last frame)
 * and passed on at most `intervalMs` apart, so a slower frame loses no peak.
 */

/** Peak levels in dBFS, −Infinity when silent, in the order of `names`. */
export interface IMeterFrame {
    names: readonly string[];
    levels: Float32Array;
}

export interface IMeters {
    /** The connected Volt's meters, or none. */
    useSpec: (spec: ISpec | null) => void;
    /** Whether anyone is watching; while not, reports are dropped unread. */
    setWanted: (isWanted: boolean) => void;
    /** One meter report (`data` after the report ID). */
    report: (data: Uint8Array) => void;
}

interface ILayout {
    names: string[];
    /** Where each meter's u16 starts in `data`. */
    offsets: number[];
    fullScale: number;
}

const layoutOf = (spec: ISpec): ILayout => {
    const meters = spec.reports.meters;
    const entries = Object.entries(meters.offsets);
    return {
        names: entries.map(([name]) => name),
        offsets: entries.map(([, offset]) => offset - 1),
        fullScale: meters.fullScale,
    };
};

/** dBFS from a raw peak. Bit 15 is a flag, not level (seen on Input 1's preamp meter). */
const toDb = (data: Uint8Array, offset: number, fullScale: number): number => {
    const value = ((data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8)) & 0x7fff;
    return value ? 20 * Math.log10(Math.min(value, fullScale) / fullScale) : -Infinity;
};

export const createMeters = (intervalMs: number, emit: (frame: IMeterFrame) => void): IMeters => {
    let layout: ILayout | null = null;
    let held = new Float32Array(0);
    let isWanted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let emittedAt = -Infinity;

    const flush = (): void => {
        timer = undefined;
        if (!layout || !isWanted) return;
        emittedAt = performance.now();
        emit({ names: layout.names, levels: held.slice() });
        held.fill(-Infinity);
    };

    return {
        useSpec: (spec) => {
            layout = spec ? layoutOf(spec) : null;
            held = new Float32Array(layout?.names.length ?? 0).fill(-Infinity);
        },
        setWanted: (wanted) => {
            isWanted = wanted;
            held.fill(-Infinity);
        },
        report: (data) => {
            if (!layout || !isWanted) return;
            const { offsets, fullScale } = layout;
            for (let i = 0; i < offsets.length; i++) {
                const db = toDb(data, offsets[i] ?? 0, fullScale);
                if (db > (held[i] ?? -Infinity)) held[i] = db;
            }
            timer ??= setTimeout(flush, Math.max(0, emittedAt + intervalMs - performance.now()));
        },
    };
};
