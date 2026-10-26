import { identify, stateRequest } from "../lib/commands.ts";
import type { IReport } from "../lib/commands.ts";
import { parseIdentify } from "../lib/reports.ts";
import { modelName, newestSpec, protocol, specFor } from "../lib/spec.ts";
import type { ISpec } from "../lib/spec.ts";

/*
 * The page's one link to the Volt over WebHID. Everything the controller needs is exported here,
 * so a desktop app could swap in a native HID bridge with the same functions and events.
 */

export interface IConnectionInfo {
    version: string;
    serial: string;
    specVersion: string;
    isExact: boolean;
    isIdentified: boolean;
}

/** "connected" (IConnectionInfo), "disconnected", "report" ({ reportId, data }) and "error" ({ message }). */
export const connectionEvents = new EventTarget();

/** The connected Volt: set only once it has identified itself, so no report is handled before. */
let device: HIDDevice | null = null;
let currentSpec: ISpec | null = null;
/** Adopts run one after another, so connect events, reconnect() and pair() can't open a device twice. */
let adopting: Promise<boolean> = Promise.resolve(false);
/** Set by disconnect(): the page stays disconnected (no automatic reconnect) until pair(). */
let isHeldOff = false;
/** Each device's own queue, so a slow send to one never holds up another. */
const queues = new WeakMap<HIDDevice, Promise<void>>();

const emit = (type: string, detail?: unknown): boolean =>
    connectionEvents.dispatchEvent(new CustomEvent(type, { detail }));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const bytesOf = (event: HIDInputReportEvent): Uint8Array =>
    new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);

export const isWebHidSupported = (): boolean => "hid" in navigator;
export const connectedSpec = (): ISpec | null => (device ? currentSpec : null);

const declaresCommandReport = (collection: HIDCollectionInfo): boolean =>
    (collection.outputReports ?? []).some((report) => report.reportId === newestSpec().reports.command.id) ||
    (collection.children ?? []).some(declaresCommandReport);

/** The Volt's control interface: its vendor usage page, declaring the command report we decoded. */
const isVoltControl = (candidate: HIDDevice): boolean =>
    candidate.vendorId === protocol.vendorId &&
    candidate.productId === protocol.productId &&
    candidate.collections.some((c) => c.usagePage === protocol.controlUsagePage && declaresCommandReport(c));

const onInput = (event: HIDInputReportEvent): void => {
    if (event.device === device) emit("report", { reportId: event.reportId, data: bytesOf(event) });
};

/** Sends to `target` while it's the device being identified or the one connected. */
const sendNow = async (target: HIDDevice, reports: IReport[], isCurrent: () => boolean): Promise<void> => {
    for (const report of reports) {
        if (!isCurrent()) return;
        try {
            await target.sendReport(report.reportId, report.data as Uint8Array<ArrayBuffer>);
        } catch {
            // A failed write means the link is gone, typically a KVM switch or an unplug. The
            // device drops quietly, the same as a disconnect event, rather than as an error: the
            // page shows "on the other computer?" and reconnects when it's back. Anything still
            // queued for it is abandoned.
            if (device === target) drop();
            return;
        }
    }
};

const enqueue = (target: HIDDevice, reports: IReport[], isCurrent: () => boolean): void => {
    if (reports.length === 0) return;
    queues.set(
        target,
        (queues.get(target) ?? Promise.resolve()).then(() => sendNow(target, reports, isCurrent)),
    );
};

/** Sends in order, bound to the device connected when queued, so nothing crosses a KVM switch. */
export const send = (reports: IReport[]): void => {
    const target = device;
    if (target) enqueue(target, reports, () => device === target);
};

export const requestState = (): void => {
    if (currentSpec) send([stateRequest(currentSpec)]);
};

/** Sends one report to `target` and resolves with the first input report whose ID matches, or null. */
const request = (target: HIDDevice, report: IReport, reportId: number, timeoutMs: number): Promise<Uint8Array | null> =>
    new Promise((resolve) => {
        const finish = (data: Uint8Array | null): void => {
            clearTimeout(timer);
            target.removeEventListener("inputreport", onReport);
            resolve(data);
        };
        const onReport = (event: HIDInputReportEvent): void =>
            void (event.reportId === reportId && finish(bytesOf(event)));
        const timer = setTimeout(() => finish(null), timeoutMs);
        target.addEventListener("inputreport", onReport);
        enqueue(target, [report], () => target.opened);
    });

const identifyDevice = async (candidate: HIDDevice): Promise<IConnectionInfo> => {
    const spec = newestSpec();
    const reply = await request(candidate, identify(spec), spec.reports.identifyReply.id, 1500);
    const identity = reply ? parseIdentify(reply) : null;
    const isIdentified = identity?.vendorId === protocol.vendorId && identity.productId === protocol.productId;
    const choice = specFor(isIdentified ? identity.version : "");
    currentSpec = choice.spec;
    return {
        version: isIdentified ? identity.version : "unknown",
        serial: isIdentified ? identity.serial : "",
        specVersion: choice.version,
        isExact: isIdentified && choice.isExact,
        isIdentified,
    };
};

/** Right after a KVM switch the device can be briefly not ready, so opening retries a few times. */
const openWithRetry = async (candidate: HIDDevice): Promise<Error | null> => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 4 && !candidate.opened; attempt++) {
        try {
            await candidate.open();
        } catch (error) {
            lastError = error as Error;
            await sleep(400 * (attempt + 1));
        }
    }
    return candidate.opened ? null : (lastError ?? new Error("unknown error"));
};

/** Opens and identifies `candidate`; it becomes the device, and its reports count, only then. */
const doAdopt = async (candidate: HIDDevice): Promise<boolean> => {
    if (device || isHeldOff) return false;
    const openError = await openWithRetry(candidate);
    if (openError) {
        emit("error", {
            message: `Couldn't open the Volt (${openError.message}). Unplug it and plug it back in, then try again.`,
        });
        return false;
    }
    const info = await identifyDevice(candidate);
    if (!candidate.opened || isHeldOff) return false;
    device = candidate;
    candidate.addEventListener("inputreport", onInput);
    emit("connected", info);
    requestState();
    return true;
};

/** Adopts after any adopt already under way; one that finds a device already connected does nothing. */
const adopt = (candidate: HIDDevice): Promise<boolean> => {
    if (!isVoltControl(candidate)) return Promise.resolve(false);
    const next = adopting.then(() => doAdopt(candidate));
    adopting = next.catch(() => false);
    return next;
};

const drop = (): void => {
    if (!device) return;
    device.removeEventListener("inputreport", onInput);
    device = null;
    currentSpec = null;
    emit("disconnected", { isByUser: isHeldOff });
};

/** Reconnects to a Volt this site was given before, without a prompt (page load, KVM switch back). */
export const reconnect = async (): Promise<boolean> => {
    for (const candidate of (await navigator.hid.getDevices()).filter(isVoltControl)) {
        if (await adopt(candidate)) return true;
    }
    return false;
};

/** Another Volt model was picked: name it, since only the decoded one can be controlled. */
const explainUnsupported = (picked: HIDDevice[]): void => {
    const other = picked.find((candidate) => candidate.productId !== protocol.productId);
    if (!other) return;
    const name = modelName(other.productId);
    emit("error", {
        message: `${name} isn't supported yet: only the ${modelName(protocol.productId)} has been decoded.`,
    });
};

/** The browser's device picker; lists every UA device so another model can be named. Needs a user gesture. */
export const pair = async (): Promise<"ok" | "cancelled" | "failed"> => {
    isHeldOff = false;
    const picked = await navigator.hid.requestDevice({ filters: [{ vendorId: protocol.vendorId }] });
    if (picked.length === 0) return "cancelled";
    for (const candidate of picked) if (await adopt(candidate)) return "ok";
    explainUnsupported(picked);
    return "failed";
};

/** Closes the connection; the page stays disconnected until pair() is called again. */
export const disconnect = async (): Promise<void> => {
    const current = device;
    if (!current) return;
    isHeldOff = true;
    drop();
    await current.close().catch(() => undefined);
};

export const watchDevices = (): void => {
    navigator.hid.addEventListener("connect", (event) => void adopt(event.device));
    navigator.hid.addEventListener("disconnect", (event) => event.device === device && drop());
};
