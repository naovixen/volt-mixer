import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { protocol, specFor } from "../../src/lib/spec.ts";
import { createHidTransport, type IHidBackend, type IHidHandle, type ITransportEvents } from "./hid-transport.ts";

const spec = specFor("1.0.5").spec;
const info = {
    path: "volt",
    vendorId: protocol.vendorId,
    productId: protocol.productId,
    usagePage: protocol.controlUsagePage,
};

/** A pretend Volt behind the backend: it answers identify, and its link can be cut. */
const scriptedVolt = (isThere = { value: true }) => {
    const written: number[][] = [];
    let onData = (_bytes: Uint8Array): void => {};
    let onError = (): void => {};
    let opens = 0;
    const handle: IHidHandle = {
        write: async (bytes) => {
            if (!isThere.value) throw new Error("gone");
            written.push(bytes);
            if (bytes[0] === spec.reports.identify.id) {
                const { vendorId, productId } = protocol;
                const reply = [
                    spec.reports.identifyReply.id,
                    vendorId & 0xff,
                    vendorId >> 8,
                    productId & 0xff,
                    productId >> 8,
                    0x05,
                    0x01,
                    0x41,
                ];
                queueMicrotask(() => onData(Uint8Array.from(reply)));
            }
        },
        onData: (listen) => void (onData = listen),
        onError: (listen) => void (onError = listen),
        close: async () => {},
    };
    const backend: IHidBackend = {
        list: async () => (isThere.value ? [info] : []),
        open: async () => (opens++, handle),
    };
    return {
        backend,
        written,
        cut: () => onError(),
        send: (bytes: number[]) => onData(Uint8Array.from(bytes)),
        opens: () => opens,
    };
};

const recorder = () => {
    const log: string[] = [];
    const events: ITransportEvents = {
        connected: (identity) => void log.push(`connected ${identity.version}`),
        disconnected: (isByUser) => void log.push(`disconnected ${isByUser}`),
        report: (reportId) => void log.push(`report ${reportId}`),
        error: (message) => void log.push(`error ${message}`),
    };
    return { log, events };
};

beforeEach(() => void vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => void vi.useRealTimers());

describe("Using the HID transport, when the Volt is plugged in", () => {
    test("then it should connect with the firmware it reports", async () => {
        const volt = scriptedVolt();
        const { log, events } = recorder();
        createHidTransport(volt.backend).start(events);
        await vi.advanceTimersByTimeAsync(10);
        expect(log).toEqual(["connected 1.0.5"]);
    });
});

describe("Using the HID transport, when the Volt sends a report", () => {
    test("then it should pass it on with its report ID", async () => {
        const volt = scriptedVolt();
        const { log, events } = recorder();
        createHidTransport(volt.backend).start(events);
        await vi.advanceTimersByTimeAsync(10);
        volt.send([spec.reports.meters.id, 0, 0]);
        expect(log.at(-1)).toBe(`report ${spec.reports.meters.id}`);
    });
});

describe("Using the HID transport, when the link is cut", () => {
    test("then it should say the Volt went away, not by the user", async () => {
        const volt = scriptedVolt();
        const { log, events } = recorder();
        createHidTransport(volt.backend).start(events);
        await vi.advanceTimersByTimeAsync(10);
        volt.cut();
        expect(log.at(-1)).toBe("disconnected false");
    });
});

describe("Using the HID transport, when the Volt comes back after a KVM switch", () => {
    test("then it should connect again by itself", async () => {
        const isThere = { value: true };
        const volt = scriptedVolt(isThere);
        const { log, events } = recorder();
        createHidTransport(volt.backend).start(events);
        await vi.advanceTimersByTimeAsync(10);
        isThere.value = false;
        volt.cut();
        await vi.advanceTimersByTimeAsync(10_000);
        isThere.value = true;
        await vi.advanceTimersByTimeAsync(4000);
        expect(log.filter((entry) => entry.startsWith("connected")).length).toBe(2);
    });
});

describe("Using the HID transport, when a write fails mid-queue", () => {
    test("then it should drop the rest and say the Volt went away", async () => {
        const isThere = { value: true };
        const volt = scriptedVolt(isThere);
        const { log, events } = recorder();
        const transport = createHidTransport(volt.backend);
        transport.start(events);
        await vi.advanceTimersByTimeAsync(10);
        isThere.value = false;
        const report = { reportId: 240, data: new Uint8Array([1]) };
        await transport.send([report, report, report]);
        expect(log.at(-1)).toBe("disconnected false");
    });
});

describe("Using the HID transport, after Disconnect", () => {
    test("then it should not connect again by itself", async () => {
        const volt = scriptedVolt();
        const { log, events } = recorder();
        const transport = createHidTransport(volt.backend);
        transport.start(events);
        await vi.advanceTimersByTimeAsync(10);
        await transport.disconnect();
        await vi.advanceTimersByTimeAsync(20_000);
        expect(log).toEqual(["connected 1.0.5", "disconnected true"]);
    });
});

describe("Using the HID transport, when sending", () => {
    test("then it should write the report ID first", async () => {
        const volt = scriptedVolt();
        const transport = createHidTransport(volt.backend);
        transport.start(recorder().events);
        await vi.advanceTimersByTimeAsync(10);
        await transport.send([{ reportId: 240, data: new Uint8Array([33, 180]) }]);
        expect(volt.written.at(-1)).toEqual([240, 33, 180]);
    });
});
