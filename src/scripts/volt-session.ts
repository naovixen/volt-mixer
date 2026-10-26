import { autoGain, identifyLights } from "../lib/commands.ts";
import { applyDeviceReport } from "../lib/device-report.ts";
import { applyHardwareState, isLinked, matchQuieterGain } from "../lib/mixer.ts";
import { reportedSettings, type ISyncScope } from "../lib/mixer-sync.ts";
import { parseCommandReport, parseMeters, parseState, type DeviceReport } from "../lib/reports.ts";
import type { ISpec } from "../lib/spec.ts";
import { app, currentSpec, hooks, isLive, layout } from "./app-state.ts";
import { showMeterLevels } from "./meters-view.ts";
import { isPageShown } from "./page-visibility.ts";
import { saveMixSoon } from "./mix-ownership.ts";
import { rememberBrightness, undimDisplay } from "./display-fade.ts";
import { checkOtherProgram, noteOtherReading, takeMixWhenFree } from "./mix-pause.ts";
import { setCondition } from "./notices.ts";
import * as volt from "./volt-connection.ts";

/*
 * The conversation with the connected Volt: sending what changed, reading its state and following
 * its front panel. The Volt doesn't tell this page when another program on this computer changes
 * it, so the page re-reads it now and then. Readings that arrive while the user is moving
 * something here are ignored: one taken just before their latest move would undo it. Readings
 * this page didn't ask for come from another program (mix-pause.ts).
 */

const editHoldMs = 1500;
const rereadMs = 1500;
/** A reading asked for longer ago than this isn't coming: replies take milliseconds. */
const replyMs = 1000;
let isFlushPending = false;
/** When each reading this page asked for, and hasn't had yet, was asked. */
let asked: number[] = [];
let stateTimer = 0;

/*
 * The Volt's display eases to a new brightness, and a change that arrives mid-way can leave it
 * stuck short of the value the Volt stored (seen dragging the slider on a 240 Hz screen, changes
 * 4 ms apart; rarer 50 ms apart). Sending the same value again unsticks it. So brightness goes at
 * most every 50 ms, and the last one goes once more when the slider has settled.
 */
const brightnessGapMs = 50;
const brightnessSettleMs = 500;
let brightnessSentAt = -Infinity;
let brightnessTimer = 0;
let settleTimer = 0;

const isEditing = (): boolean => performance.now() - app.lastEditAt < editHoldMs;
const isBrightness = (key: string): boolean => key === "brightness";
/** What a reading confirms: what the Volt reports, but not a brightness still waiting to go. */
const confirmed: ISyncScope = { kind: "reported", keys: (key) => !(isBrightness(key) && brightnessTimer !== 0) };

/** Sends brightness once the gap since the last has passed; until then a timer waits to send the latest. */
const sendBrightness = (spec: ISpec): void => {
    const wait = brightnessSentAt + brightnessGapMs - performance.now();
    if (wait > 0) {
        brightnessTimer ||= window.setTimeout(() => ((brightnessTimer = 0), sendSoon()), wait);
        return;
    }
    const reports = app.sync.diff(app.state, spec, { kind: "reported", keys: isBrightness });
    if (reports.length === 0) return;
    brightnessSentAt = performance.now();
    rememberBrightness(app.state.device.brightness);
    volt.send(reports);
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => isLive() && volt.send(reports), brightnessSettleMs);
};

/** Sends what changed and saves the mix. */
const flush = (): void => {
    isFlushPending = false;
    const spec = volt.connectedSpec();
    if (spec && isLive()) {
        volt.send(app.sync.diff(app.state, spec, { keys: (key) => !isBrightness(key) }));
        sendBrightness(spec);
    }
    saveMixSoon();
    hooks.refresh();
};

/** Sends what changed once per frame, or after 16 ms when there are no frames: a hidden window (the desktop tray). */
export const sendSoon = (): void => {
    if (isFlushPending) return;
    isFlushPending = true;
    const flushOnce = (): void => {
        if (isFlushPending) flush();
    };
    requestAnimationFrame(flushOnce);
    window.setTimeout(flushOnce, 16);
};

const askForState = (): void => {
    asked.push(performance.now());
    volt.requestState();
};

/** Only the tab that drives the Volt asks; a read-only second tab sees its readings anyway. */
export const rereadVolt = (): void => {
    if (!volt.connectedSpec() || !app.isHardwareKnown || !app.hasControl) return;
    askForState();
    checkOtherProgram();
};

const requestStateSoon = (): void => {
    window.clearTimeout(stateTimer);
    stateTimer = window.setTimeout(askForState, 150);
};

const onFirstState = (data: Uint8Array): void => {
    const spec = currentSpec();
    applyHardwareState(app.state, parseState(spec, data));
    app.isHardwareKnown = true;
    setCondition("no-settings", null);
    app.sync.forget();
    app.sync.prime(app.state, spec);
    if (app.mixHold) layout();
    takeMixWhenFree();
    undimDisplay();
};

const onLaterState = (data: Uint8Array): void => {
    if (isEditing()) return;
    const spec = currentSpec();
    const before = reportedSettings(app.state, spec);
    const changed = applyHardwareState(app.state, parseState(spec, data));
    if (changed.length === 0 && reportedSettings(app.state, spec) === before) return;
    app.sync.prime(app.state, spec, confirmed);
    // Linked with the INPUT button: the preamps take the lower gain, which the commit sends.
    for (const pair of changed) if (isLinked(app.state, pair[0])) matchQuieterGain(app.state, pair);
    if (changed.length > 0) layout();
    sendSoon();
};

/** Whether a reading is one this page asked for; a request with no reply by now never gets one. */
const isOwnReading = (): boolean => {
    const now = performance.now();
    asked = asked.filter((time) => now - time < replyMs);
    return asked.shift() !== undefined;
};

/** Every state reading reaches every program that has the Volt open; this page's own are counted. */
const onStateReading = (data: Uint8Array): void => {
    if (!isOwnReading()) noteOtherReading();
    if (app.isHardwareKnown) onLaterState(data);
    else onFirstState(data);
};

/**
 * The headphone report carries the level and the mute together. While this page has a change of
 * its own waiting, the level the Volt reports (its knob) wins, so the waiting change never sends
 * back an older, louder level; the mute the page set wins over the one in the report.
 */
const mergePending = (report: DeviceReport): DeviceReport => {
    if (!isFlushPending || report.type !== "headphone") return report;
    app.state.headphone.level = report.level;
    return { ...report, isMuted: app.state.headphone.isMuted };
};

const onCommandReport = (spec: ISpec, data: Uint8Array): void => {
    const report = mergePending(parseCommandReport(spec, data));
    if (report.type === "state") return onStateReading(data);
    if (!app.isHardwareKnown) return;
    if (report.type === "links" || report.type === "panel") return requestStateSoon();
    // This page's own pending changes go out first, so the Volt's report isn't sent back to it.
    if (isFlushPending) flush();
    if (!applyDeviceReport(app.state, report)) return;
    app.sync.prime(app.state, spec, confirmed);
    if (report.type === "digitalFormat") layout();
    else hooks.refresh();
};

const onReport = ({ reportId, data }: { reportId: number; data: Uint8Array }): void => {
    const spec = volt.connectedSpec();
    if (!spec) return;
    // Fifty a second, even in silence: not even read while no one can see them.
    if (reportId === spec.reports.meters.id) return void (isPageShown() && showMeterLevels(parseMeters(spec, data)));
    if (reportId === spec.reports.command.id) onCommandReport(spec, data);
};

/** A new connection asks for its first reading itself, straight after the "connected" event. */
export const startSession = (): void => {
    asked = [performance.now()];
};

/** Starts Auto-Gain, then re-reads the state dump once it's done to show the new gain. */
export const startAutoGain = (mask: number, seconds: number): boolean => {
    const spec = volt.connectedSpec();
    if (!spec || !isLive() || mask === 0) return false;
    volt.send([autoGain(spec, mask, seconds)]);
    window.setTimeout(askForState, (seconds + 1.5) * 1000);
    return true;
};

export const identifyVolt = (): void => {
    const spec = volt.connectedSpec();
    if (spec && isLive()) volt.send([identifyLights(spec)]);
};

export const wireSession = (): void => {
    volt.connectionEvents.addEventListener("report", (event) => onReport((event as CustomEvent).detail));
    window.setInterval(rereadVolt, rereadMs);
    // A page that was in the background may be well behind (browsers slow its timers), so it
    // catches up before anything can be moved from what it shows.
    window.addEventListener("focus", rereadVolt);
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && rereadVolt());
};
