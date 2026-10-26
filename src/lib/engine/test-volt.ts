import { vi } from "vitest";
import { toHex, type IReport } from "../commands.ts";
import { specFor, type ISpec } from "../spec.ts";
import { createVoltEngine, type IVoltEngine } from "./engine.ts";
import type { IEngineStore } from "./ports.ts";

/*
 * For the engine's tests only: an engine wired to a pretend Volt that records what it's sent, a
 * store in memory, and the Volt's state dump built from the protocol data. Nothing here reaches a
 * device.
 */

export const spec: ISpec = specFor("1.0.3").spec;
export const serial = "TEST0001";
const inputBytes = 73;

/** A state dump: Inputs 1–4 on Direct, levels about half way, display lit. */
export const stateDump = (change: (at: (offset: number, value: number) => void) => void = () => {}): Uint8Array => {
    const layout = spec.stateLayout;
    const bytes = new Uint8Array(inputBytes);
    const at = (offset: number, value: number): void => void (bytes[1 + offset] = value);
    bytes[0] = spec.commands.stateRequest;
    at(layout.directMask, 0x0f);
    at(layout.monitorLevel, 400 & 0xff);
    at(layout.monitorLevel + 1, 400 >> 8);
    at(layout.headphoneLevelU16, 450 & 0xff);
    at(layout.headphoneLevelU16 + 1, 450 >> 8);
    at(layout.clipProtection, 1);
    at(layout.brightness, 180);
    change(at);
    return bytes;
};

export const memoryStore = (mix: unknown = null): IEngineStore & { saved: Map<string, unknown> } => {
    const saved = new Map<string, unknown>([[`mix:${serial}`, mix]]);
    return {
        saved,
        loadMix: (id) => saved.get(`mix:${id}`) ?? null,
        saveMix: (id, value) => void saved.set(`mix:${id}`, value),
        loadPendingMix: () => saved.get("pending") ?? null,
        savePendingMix: (value) => void saved.set("pending", value),
        loadBrightness: (id) => (saved.get(`brightness:${id}`) as number | undefined) ?? null,
        saveBrightness: (id, raw) => void saved.set(`brightness:${id}`, raw),
    };
};

export interface ITestVolt {
    engine: IVoltEngine;
    /** Every report sent, in order, as hex. */
    sent: string[];
    /** How many batches the engine handed the transport. */
    batches: () => number;
    /** A state reading the engine didn't ask for (another program asked), with this dump. */
    reply: (dump: Uint8Array) => void;
}

/** An engine connected to the pretend Volt; with `isWebsite`, it listens for another Volt Mixer first. */
export const connectedEngine = async ({ mix = null as unknown, isWebsite = false } = {}): Promise<ITestVolt> => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    const sent: string[] = [];
    let batches = 0;
    const reply = (dump: Uint8Array): void => engine.report(spec.reports.command.id, dump);
    const engine = createVoltEngine({
        transport: {
            send: (reports: IReport[]) => {
                batches++;
                const hex = reports.map(toHex);
                sent.push(...hex);
                // The Volt answers its state request straight away, as the real one does.
                if (hex.some((report) => report.startsWith("f011"))) queueMicrotask(() => reply(stateDump()));
                return Promise.resolve();
            },
        },
        store: memoryStore(mix),
        options: { isWebsite, linkBase: "https://example.test/volt-mixer/" },
        view: { isDigitalShown: false, isLoopbackShown: true, trayHidden: [] },
    });
    engine.setControl(true);
    engine.connected({ version: "1.0.3", serial, specVersion: "1.0.3", isExact: true, isIdentified: true }, spec);
    await vi.advanceTimersByTimeAsync(isWebsite ? 4000 : 100);
    return { engine, sent, batches: () => batches, reply };
};

/** Crosspoint reports among `sent` (command byte 01), as hex. */
export const crosspoints = (sent: string[]): string[] => sent.filter((hex) => hex.startsWith("f001"));
