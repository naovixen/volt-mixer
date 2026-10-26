import { identify } from "../../src/lib/commands.ts";
import { protocol, specFor } from "../../src/lib/spec.ts";
import type { IHidBackend, IHidHandle, IHidInfo } from "./hid-transport.ts";

/*
 * A pretend Volt for tools/perf-bench.mjs, so the app can be measured without touching the real
 * one: it answers identify and the state request, sends meter reports 50 times a second, and
 * prints how many reports it was sent ("bench:sent N") for the bench to read. Only used when the
 * bench starts the app from source with VOLT_FAKE_VOLT=bench (engine-host.ts).
 */

const spec = specFor("1.0.5").spec;
const inputBytes = 74;
const info: IHidInfo = {
    path: "bench",
    vendorId: protocol.vendorId,
    productId: protocol.productId,
    usagePage: protocol.controlUsagePage,
};

const identifyReply = (): number[] => {
    const { vendorId, productId } = protocol;
    const serial = [..."BENCH0001"].map((character) => character.charCodeAt(0));
    return [
        spec.reports.identifyReply.id,
        vendorId & 0xff,
        vendorId >> 8,
        productId & 0xff,
        productId >> 8,
        0x05,
        0x01,
        ...serial,
    ];
};

/** A Volt in use: everything on Direct, levels about half way, display lit. */
const stateDump = (): number[] => {
    const bytes = new Array<number>(inputBytes).fill(0);
    const layout = spec.stateLayout;
    const at = (offset: number, value: number): void => void (bytes[2 + offset] = value);
    bytes[0] = spec.reports.command.id;
    bytes[1] = spec.commands.stateRequest;
    at(layout.directMask, 0x0f);
    at(layout.monitorLevel, 400 & 0xff);
    at(layout.monitorLevel + 1, 400 >> 8);
    at(layout.headphoneLevelU16, 450 & 0xff);
    at(layout.headphoneLevelU16 + 1, 450 >> 8);
    at(layout.clipProtection, 1);
    at(layout.brightness, 180);
    return bytes;
};

/** Meter peaks that move like a voice on Input 1 and music on the monitor. */
const meterReport = (time: number): number[] => {
    const bytes = new Array<number>(inputBytes).fill(0);
    bytes[0] = spec.reports.meters.id;
    for (const [name, offset] of Object.entries(spec.reports.meters.offsets)) {
        const level = Math.round(
            (name.startsWith("monitor") ? 12000 : 6000) * (0.4 + 0.6 * Math.abs(Math.sin(time / 300 + offset))),
        );
        bytes[offset] = level & 0xff;
        bytes[offset + 1] = level >> 8;
    }
    return bytes;
};

const openFake = (): IHidHandle => {
    const listeners = new Set<(bytes: Uint8Array) => void>();
    const emit = (bytes: number[]): void => listeners.forEach((listen) => listen(Uint8Array.from(bytes)));
    let sent = 0;
    let told = -1;
    const meters = setInterval(() => emit(meterReport(Date.now())), 20);
    const tell = setInterval(() => {
        if (sent !== told) console.log(`bench:sent ${(told = sent)}`);
    }, 250);
    return {
        write: async (bytes) => {
            sent++;
            if (bytes[0] === identify(spec).reportId) setImmediate(() => emit(identifyReply()));
            if (bytes[0] === spec.reports.command.id && bytes[1] === spec.commands.stateRequest)
                setImmediate(() => emit(stateDump()));
        },
        onData: (listen) => void listeners.add(listen),
        onError: () => {},
        close: async () => {
            clearInterval(meters);
            clearInterval(tell);
        },
    };
};

export const fakeBackend: IHidBackend = {
    list: async () => [info],
    open: async () => openFake(),
};
