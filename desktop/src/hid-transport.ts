import { identify, type IReport } from "../../src/lib/commands.ts";
import type { IConnectionInfo, ITransport } from "../../src/lib/engine/ports.ts";
import { parseIdentify } from "../../src/lib/reports.ts";
import { modelName, newestSpec, protocol, specFor, type ISpec } from "../../src/lib/spec.ts";

/*
 * The app's link to the Volt: finding it, opening and identifying it, and noticing it's gone, as
 * src/scripts/transport-webhid.ts does on the website. The HID library is a backend
 * (hid-backend-node.ts, or the bench's fake), so this has no Electron or native code and is
 * tested on its own. HID reports arrive with their report ID in byte 0, and go out the same way.
 *
 * There are no plug-in events to follow, so while no Volt is connected the backend is asked for
 * one every few seconds; once one is, nothing is polled.
 */

/** Something the backend found: a HID interface, by its address. */
export interface IHidInfo {
    path: string;
    vendorId: number;
    productId: number;
    usagePage: number;
}

export interface IHidHandle {
    /** Writes one report, its ID first; rejects when the link is gone. */
    write: (bytes: number[]) => Promise<void>;
    onData: (listen: (bytes: Uint8Array) => void) => void;
    /** A read failed: the link is gone (a KVM switch, an unplug). */
    onError: (listen: () => void) => void;
    close: () => Promise<void>;
}

export interface IHidBackend {
    list: () => Promise<IHidInfo[]>;
    open: (info: IHidInfo) => Promise<IHidHandle>;
}

export interface ITransportEvents {
    connected: (info: IConnectionInfo, spec: ISpec) => void;
    disconnected: (isByUser: boolean) => void;
    report: (reportId: number, data: Uint8Array) => void;
    error: (message: string) => void;
}

export interface IHidTransport extends ITransport {
    /** Starts looking for the Volt, and keeps looking whenever none is connected. */
    start: (events: ITransportEvents) => void;
    /** Connect Volt: looks now, even after Disconnect. */
    connect: () => Promise<void>;
    /** Disconnect: closes it, and stops looking until connect(). */
    disconnect: () => Promise<void>;
    stop: () => Promise<void>;
}

const pollMs = 3000;
const identifyMs = 1500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const isVoltControl = (info: IHidInfo): boolean =>
    info.vendorId === protocol.vendorId &&
    info.productId === protocol.productId &&
    info.usagePage === protocol.controlUsagePage;

/** Right after a KVM switch the device can be briefly not ready, so opening retries a few times. */
const openWithRetry = async (backend: IHidBackend, info: IHidInfo): Promise<IHidHandle> => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            return await backend.open(info);
        } catch (error) {
            lastError = error;
            await sleep(400 * (attempt + 1));
        }
    }
    throw lastError instanceof Error ? lastError : new Error("unknown error");
};

/** Sends identify and waits for the reply; null when none comes. */
const askIdentity = (handle: IHidHandle, spec: ISpec, replies: Set<(bytes: Uint8Array) => void>) =>
    new Promise<Uint8Array | null>((resolve) => {
        const finish = (bytes: Uint8Array | null): void => {
            clearTimeout(timer);
            replies.delete(onReply);
            resolve(bytes);
        };
        const onReply = (bytes: Uint8Array): void => void (bytes[0] === spec.reports.identifyReply.id && finish(bytes));
        const timer = setTimeout(() => finish(null), identifyMs);
        replies.add(onReply);
        const report = identify(spec);
        handle.write([report.reportId, ...report.data]).catch(() => finish(null));
    });

/** Who the Volt is, and which protocol data fits its firmware. */
const identityOf = (reply: Uint8Array | null): { info: IConnectionInfo; spec: ISpec } => {
    const identity = reply ? parseIdentify(reply.subarray(1)) : null;
    const isIdentified = identity?.vendorId === protocol.vendorId && identity.productId === protocol.productId;
    const choice = specFor(isIdentified ? identity.version : "");
    const info = {
        version: isIdentified ? identity.version : "unknown",
        serial: isIdentified ? identity.serial : "",
        specVersion: choice.version,
        isExact: isIdentified && choice.isExact,
        isIdentified,
    };
    return { info, spec: choice.spec };
};

export const createHidTransport = (backend: IHidBackend): IHidTransport => {
    let events: ITransportEvents | null = null;
    let device: IHidHandle | null = null;
    let isHeldOff = false;
    let isLooking = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let queue: Promise<void> = Promise.resolve();
    /** Who hears the open handle's reports: the engine, and an identify waiting for its reply. */
    const listeners = new Set<(bytes: Uint8Array) => void>();

    const drop = (): void => {
        const current = device;
        if (!current) return;
        device = null;
        void current.close().catch(() => undefined);
        events?.disconnected(isHeldOff);
        schedulePoll();
    };

    const schedulePoll = (): void => {
        clearTimeout(pollTimer);
        if (!device && !isHeldOff) pollTimer = setTimeout(() => void look(), pollMs);
    };

    /** Opens and identifies `info`; it becomes the device, and its reports count, only then. */
    const adopt = async (info: IHidInfo): Promise<boolean> => {
        const handle = await openWithRetry(backend, info).catch((error: unknown) => {
            events?.error(
                `Couldn't open the Volt (${(error as Error).message}). Unplug it and plug it back in, then try again.`,
            );
            return null;
        });
        if (!handle) return false;
        listeners.clear();
        handle.onData((bytes) => listeners.forEach((listen) => listen(bytes)));
        handle.onError(() => device === handle && drop());
        const { info: identity, spec } = identityOf(await askIdentity(handle, newestSpec(), listeners));
        if (isHeldOff) {
            await handle.close().catch(() => undefined);
            return false;
        }
        device = handle;
        listeners.add((bytes) => events?.report(bytes[0] ?? 0, bytes.subarray(1)));
        // The engine asks for the Volt's state itself, straight away.
        events?.connected(identity, spec);
        return true;
    };

    const look = async (): Promise<void> => {
        if (device || isHeldOff || isLooking) return;
        isLooking = true;
        try {
            const candidate = (await backend.list().catch(() => [])).find(isVoltControl);
            if (candidate) await adopt(candidate);
        } finally {
            isLooking = false;
            schedulePoll();
        }
    };

    const sendNow = async (target: IHidHandle, reports: IReport[]): Promise<void> => {
        for (const report of reports) {
            if (device !== target) return;
            try {
                await target.write([report.reportId, ...report.data]);
            } catch {
                // A failed write means the link is gone; anything still queued for it is abandoned.
                if (device === target) drop();
                return;
            }
        }
    };

    /** Another Volt model, when Connect finds no supported one: name it, since only the decoded one works. */
    const explainUnsupported = async (): Promise<void> => {
        const other = (await backend.list().catch(() => [])).find(
            (info) => info.vendorId === protocol.vendorId && info.productId !== protocol.productId,
        );
        if (other)
            events?.error(
                `${modelName(other.productId)} isn't supported yet: only the ${modelName(protocol.productId)} has been decoded.`,
            );
    };

    return {
        send: (reports) => {
            const target = device;
            if (!target || reports.length === 0) return Promise.resolve();
            queue = queue.then(() => sendNow(target, reports));
            return queue;
        },
        start: (listen) => {
            events = listen;
            void look();
        },
        connect: async () => {
            isHeldOff = false;
            await look();
            if (!device) await explainUnsupported();
        },
        disconnect: async () => {
            isHeldOff = true;
            clearTimeout(pollTimer);
            drop();
        },
        stop: async () => {
            isHeldOff = true;
            clearTimeout(pollTimer);
            const current = device;
            device = null;
            await current?.close().catch(() => undefined);
        },
    };
};
