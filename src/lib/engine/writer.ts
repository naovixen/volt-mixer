import type { IReport } from "../commands.ts";
import type { ChannelId } from "../mixer.ts";
import { toSavedMix } from "../saved-mix.ts";
import type { ISpec } from "../spec.ts";
import type { IChanges } from "./changes.ts";
import type { ICore } from "./core.ts";
import { createSendPump } from "./send-pump.ts";
import type { ISyncScope } from "./sync.ts";

/*
 * Sends what changed (send-pump.ts) and saves this computer's mix. Only the crosspoints of the
 * channels a change touched are worked out again; anything that could move others (a solo, a
 * link, a new mix, a new connection) marks them all.
 *
 * The Volt's display eases to a new brightness, and a change that arrives mid-way can leave it
 * stuck short of the value the Volt stored (seen dragging the slider on a 240 Hz screen, changes
 * 4 ms apart; rarer 50 ms apart). Sending the same value again unsticks it. So brightness goes at
 * most every 50 ms, and the last one goes once more when the slider has settled.
 */

const sendIntervalMs = 20;
const brightnessGapMs = 50;
const brightnessSettleMs = 500;
const saveDelayMs = 250;

export interface IWriter {
    /** A change to send: `changes.channels` says whose crosspoints to work out again. */
    commit: (changes: IChanges) => void;
    /** Every channel's crosspoints are compared at the next send (a new mix, connection or solo). */
    markAll: () => void;
    /** Sends what's waiting now (a device report is about to be applied over it). */
    flush: () => void;
    isPending: () => boolean;
    /** What a reading confirms: what the Volt reports, but not a brightness still waiting to go. */
    confirmed: ISyncScope;
    saveMixNow: () => void;
    saveMixSoon: () => void;
    /** The mix changed in a way that has to be saved (a link, a reset, a forget). */
    markMixChanged: () => void;
    stop: () => void;
}

const isBrightness = (key: string): boolean => key === "brightness";

export const createWriter = (core: ICore, rememberBrightness: (raw: number) => void): IWriter => {
    let dirty: Set<ChannelId> | "all" = "all";
    let brightnessSentAt = -Infinity;
    let isBrightnessWaiting = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let isMixDirty = false;

    const brightnessReports = (spec: ISpec): IReport[] => {
        const wait = brightnessSentAt + brightnessGapMs - performance.now();
        if (wait > 0) {
            isBrightnessWaiting = true;
            pump.schedule(wait);
            return [];
        }
        isBrightnessWaiting = false;
        const reports = core.sync.diff(core.state, spec, { kind: "reported", keys: isBrightness });
        if (reports.length === 0) return reports;
        brightnessSentAt = performance.now();
        rememberBrightness(core.state.device.brightness);
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => core.isLive() && void core.send(reports), brightnessSettleMs);
        return reports;
    };

    /* Not live: nothing goes, and every channel is compared again once it is. */
    const collect = (): IReport[] => {
        const spec = core.connectedSpec();
        if (!spec || !core.isLive()) {
            dirty = "all";
            return [];
        }
        const channels = dirty === "all" ? undefined : dirty;
        dirty = new Set();
        const reports = core.sync.diff(core.state, spec, {
            keys: (key) => !isBrightness(key),
            ...(channels ? { channels } : {}),
        });
        return [...reports, ...brightnessReports(spec)];
    };

    const pump = createSendPump({ intervalMs: sendIntervalMs, collect, write: (reports) => core.send(reports) });

    const saveMixNow = (): void => {
        clearTimeout(saveTimer);
        saveTimer = undefined;
        const { state, flags } = core;
        // Only the program that drives the Volt saves: a read-only tab's copy may be older.
        if (!isMixDirty || !state.isMixOwned || !flags.serial || !flags.hasControl) return;
        isMixDirty = false;
        core.store.saveMix(flags.serial, toSavedMix(state));
    };

    const isMixChange = ({ topics }: IChanges): boolean =>
        topics.has("channels") || topics.has("routing") || topics.has("layout");

    return {
        commit: (changes) => {
            if (dirty !== "all") for (const id of changes.channels) dirty.add(id);
            if (isMixChange(changes)) isMixDirty = true;
            pump.schedule();
            saveTimer ??= setTimeout(saveMixNow, saveDelayMs);
        },
        markAll: () => void (dirty = "all"),
        flush: () => pump.flush(),
        isPending: () => pump.isPending(),
        confirmed: { kind: "reported", keys: (key) => !(isBrightness(key) && isBrightnessWaiting) },
        saveMixNow,
        saveMixSoon: () => void (saveTimer ??= setTimeout(saveMixNow, saveDelayMs)),
        markMixChanged: () => void (isMixDirty = true),
        stop: () => {
            pump.stop();
            clearTimeout(settleTimer);
            dirty = "all";
        },
    };
};
