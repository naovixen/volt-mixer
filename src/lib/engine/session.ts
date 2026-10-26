import { autoGain, identifyLights, stateRequest } from "../commands.ts";
import { applyDeviceReport } from "../device-report.ts";
import {
    analogIds,
    applyHardwareState,
    channelIds,
    isLinked,
    matchQuieterGain,
    type ChannelId,
    type Pair,
} from "../mixer.ts";
import { parseCommandReport, parseState, type DeviceReport } from "../reports.ts";
import type { ISpec } from "../spec.ts";
import { allChanges, type Topic } from "./changes.ts";
import type { ICore } from "./core.ts";
import type { IFade } from "./fade.ts";
import type { IMeters } from "./meters.ts";
import type { IOwnership } from "./ownership.ts";
import type { IConnectionInfo } from "./ports.ts";
import { reportedSettings } from "./sync.ts";
import type { IWriter } from "./writer.ts";

/*
 * The conversation with the connected Volt: reading its state and following its front panel. The
 * Volt doesn't say when another program on this computer changes it, so the engine re-reads it now
 * and then. Readings that arrive while the user is moving something are ignored: one taken just
 * before their latest move would undo it. Readings this engine didn't ask for come from another
 * program (ownership.ts).
 */

const editHoldMs = 1500;
const rereadMs = 1500;
/** A reading asked for longer ago than this isn't coming: replies take milliseconds. */
const replyMs = 1000;
/** The Volt sends its settings straight away; if it doesn't, the notice bar says so. */
const settingsWaitMs = 2500;

export interface ISession {
    connected: (info: IConnectionInfo, spec: ISpec) => void;
    disconnected: (isByUser: boolean) => void;
    report: (reportId: number, data: Uint8Array) => void;
    /** Only the program in control asks; a read-only tab sees its readings anyway. */
    reread: () => void;
    startAutoGain: (mask: number, seconds: number) => boolean;
    identify: () => void;
}

interface ISessionParts {
    writer: IWriter;
    ownership: IOwnership;
    fade: IFade;
    meters: IMeters;
}

/** What a front-panel report changed, for the views. */
const reportTopics: Partial<Record<DeviceReport["type"], [Topic[], readonly ChannelId[]]>> = {
    direct: [["channels"], analogIds],
    monitorMute: [["outputs"], []],
    monitorLevel: [["outputs"], []],
    headphone: [["outputs"], []],
    mono: [["outputs"], []],
    tone: [["inputs", "channels"], analogIds],
    phantom: [["inputs", "channels"], analogIds],
    preampGain: [["inputs"], []],
    clipProtection: [["device"], []],
    brightness: [["device"], []],
    digitalFormat: [["device", "layout"], channelIds],
};

const deviceText = (info: IConnectionInfo): string =>
    info.isIdentified ? `Connected · firmware ${info.version}` : "Connected · firmware unknown";

export const createSession = (core: ICore, { writer, ownership, fade, meters }: ISessionParts): ISession => {
    /** When each reading this engine asked for, and hasn't had yet, was asked. */
    let asked: number[] = [];
    let stateTimer: ReturnType<typeof setTimeout> | undefined;
    let settingsTimer: ReturnType<typeof setTimeout> | undefined;
    let rereadTimer: ReturnType<typeof setInterval> | undefined;

    const askForState = (): void => {
        const spec = core.connectedSpec();
        if (!spec) return;
        asked.push(performance.now());
        void core.send([stateRequest(spec)]);
    };

    const reread = (): void => {
        if (!core.connection || !core.flags.isHardwareKnown || !core.flags.hasControl) return;
        askForState();
        ownership.checkOtherProgram();
    };

    const changedAll = (): void => {
        const { topics, channels } = allChanges();
        core.changed([...topics], channels);
    };

    const onFirstState = (spec: ISpec, data: Uint8Array): void => {
        applyHardwareState(core.state, parseState(spec, data));
        core.flags.isHardwareKnown = true;
        core.setCondition("no-settings", null);
        core.sync.forget();
        core.sync.prime(core.state, spec);
        writer.markAll();
        changedAll();
        ownership.takeMixWhenFree();
        fade.undim();
    };

    const isEditing = (): boolean => performance.now() - core.flags.lastEditAt < editHoldMs;

    /** Linked with the INPUT button: the preamps take the lower gain, which the next send sends. */
    const matchLinkedGains = (pairs: Pair[]): void => {
        for (const pair of pairs) if (isLinked(core.state, pair[0])) matchQuieterGain(core.state, pair);
    };

    const onLaterState = (spec: ISpec, data: Uint8Array): void => {
        if (isEditing()) return;
        const before = reportedSettings(core.state, spec);
        const changed = applyHardwareState(core.state, parseState(spec, data));
        if (changed.length === 0 && reportedSettings(core.state, spec) === before) return;
        core.sync.prime(core.state, spec, writer.confirmed);
        matchLinkedGains(changed);
        if (changed.length > 0) {
            writer.markAll();
            changedAll();
        } else core.changed(["outputs", "inputs", "device", "channels"], analogIds);
        writer.commit({ topics: new Set(), channels: new Set() });
    };

    /** Whether a reading is one this engine asked for; a request with no reply by now never gets one. */
    const isOwnReading = (): boolean => {
        const now = performance.now();
        asked = asked.filter((time) => now - time < replyMs);
        return asked.shift() !== undefined;
    };

    const onStateReading = (spec: ISpec, data: Uint8Array): void => {
        if (!isOwnReading()) ownership.noteOtherReading();
        if (core.flags.isHardwareKnown) onLaterState(spec, data);
        else onFirstState(spec, data);
    };

    /**
     * The headphone report carries the level and the mute together. While a change of this
     * engine's own is waiting, the level the Volt reports (its knob) wins, so the waiting change
     * never sends back an older, louder level; the mute set here wins over the one in the report.
     */
    const mergePending = (report: DeviceReport): DeviceReport => {
        if (!writer.isPending() || report.type !== "headphone") return report;
        core.state.headphone.level = report.level;
        return { ...report, isMuted: core.state.headphone.isMuted };
    };

    const requestStateSoon = (): void => {
        clearTimeout(stateTimer);
        stateTimer = setTimeout(askForState, 150);
    };

    const onCommandReport = (spec: ISpec, data: Uint8Array): void => {
        const report = mergePending(parseCommandReport(spec, data));
        if (report.type === "state") return onStateReading(spec, data);
        if (!core.flags.isHardwareKnown) return;
        if (report.type === "links" || report.type === "panel") return requestStateSoon();
        // This engine's own waiting changes go out first, so the Volt's report isn't sent back to it.
        if (writer.isPending()) writer.flush();
        if (!applyDeviceReport(core.state, report)) return;
        core.sync.prime(core.state, spec, writer.confirmed);
        const [topics, channels] = reportTopics[report.type] ?? [["outputs"], []];
        core.changed(topics, channels);
    };

    const awaitSettings = (): void => {
        clearTimeout(settingsTimer);
        settingsTimer = setTimeout(() => {
            if (!core.connection || core.flags.isHardwareKnown) return;
            const text = "Connected, but the Volt didn't send its settings. Unplug it and plug it back in.";
            core.setCondition("no-settings", text, { kind: "error" });
        }, settingsWaitMs);
    };

    const warnUncheckedFirmware = (info: IConnectionInfo): void => {
        const unknown = info.isIdentified
            ? `firmware ${info.version}, which this page hasn't been checked against`
            : "unknown firmware";
        core.setCondition(
            "firmware",
            `This Volt has ${unknown}, so the page shows its settings but won't change anything.`,
            {
                action: { label: "Use anyway", command: "allow-sending" },
            },
        );
    };

    return {
        connected: (info, spec) => {
            ownership.releaseMix();
            core.connection = { info, spec };
            Object.assign(core.flags, { serial: info.serial, isHardwareKnown: false, isSendAllowed: info.isExact });
            meters.useSpec(spec);
            writer.markAll();
            asked = [];
            askForState();
            ownership.restartMixPause(true);
            core.status = { text: deviceText(info), kind: "on" };
            if (!info.isExact) warnUncheckedFirmware(info);
            awaitSettings();
            clearInterval(rereadTimer);
            rereadTimer = setInterval(reread, rereadMs);
            changedAll();
        },
        disconnected: (isByUser) => {
            ownership.releaseMix();
            core.connection = null;
            Object.assign(core.flags, { serial: "", isHardwareKnown: false, isSendAllowed: false });
            core.sync.forget();
            writer.stop();
            meters.useSpec(null);
            [settingsTimer, stateTimer].forEach((timer) => clearTimeout(timer));
            clearInterval(rereadTimer);
            core.setCondition("no-settings", null);
            core.setCondition("firmware", null);
            ownership.restartMixPause(false);
            core.status = isByUser
                ? { text: "Disconnected", kind: "off" }
                : { text: "Volt not connected · on the other computer?", kind: "away" };
            changedAll();
        },
        report: (reportId, data) => {
            const spec = core.connectedSpec();
            if (!spec) return;
            // Fifty a second, even in silence: not even read while no one is watching.
            if (reportId === spec.reports.meters.id) return meters.report(data);
            if (reportId === spec.reports.command.id) onCommandReport(spec, data);
        },
        reread,
        startAutoGain: (mask, seconds) => {
            const spec = core.connectedSpec();
            if (!spec || !core.isLive() || mask === 0) return false;
            void core.send([autoGain(spec, mask, seconds)]);
            setTimeout(askForState, (seconds + 1.5) * 1000);
            return true;
        },
        identify: () => {
            const spec = core.connectedSpec();
            if (spec && core.isLive()) void core.send([identifyLights(spec)]);
        },
    };
};
