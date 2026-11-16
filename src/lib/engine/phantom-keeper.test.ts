import { afterEach, describe, expect, test, vi } from "vitest";
import { phantomMask, toHex } from "../commands.ts";
import { connectedEngine, spec, stateDump, type ITestVolt } from "./test-volt.ts";

afterEach(() => void vi.useRealTimers());

const phantomOn = (mask: number): string => toHex(phantomMask(spec, mask));
const withPhantom = (mask: number): Uint8Array => stateDump((at) => at(spec.stateLayout.phantomMask, mask));
const phantomReports = (sent: string[]): string[] => sent.filter((hex) => hex.startsWith("f004"));

/** A Volt whose Input 1 the user gave 48V, long enough ago for readings to count again. */
const voltWithPhantom = async (): Promise<ITestVolt> => {
    const volt = await connectedEngine();
    volt.engine.runIntent({ type: "phantom", ids: ["in1"], to: true });
    await vi.advanceTimersByTimeAsync(2000);
    volt.sent.length = 0;
    return volt;
};

describe("Using the engine, when the Volt comes back with 48V off after having it on", () => {
    test("then it should turn 48V back on", async () => {
        const volt = await voltWithPhantom();
        await volt.reconnect();
        expect(phantomReports(volt.sent)).toEqual([phantomOn(1)]);
    });

    test("then it should say so", async () => {
        const volt = await voltWithPhantom();
        const messages: string[] = [];
        volt.engine.onMessage((text) => messages.push(text));
        await volt.reconnect();
        expect(messages).toEqual(["The Volt came back with 48V off, so it's on again for Input 1, as you left it."]);
    });
});

describe("Using the engine, when the Volt comes back with 48V off on one input and on on the other", () => {
    test("then it should keep the other input's 48V on", async () => {
        const volt = await voltWithPhantom();
        await volt.reconnect(withPhantom(2));
        expect(phantomReports(volt.sent)).toEqual([phantomOn(3)]);
    });
});

describe("Using the engine, when the Volt comes back with 48V still on", () => {
    test("then it should send no 48V", async () => {
        const volt = await voltWithPhantom();
        await volt.reconnect(withPhantom(1));
        expect(phantomReports(volt.sent)).toEqual([]);
    });
});

describe("Using the engine, when 48V was turned off on the Volt's front panel before it went away", () => {
    test("then it should leave 48V off when the Volt comes back", async () => {
        const volt = await voltWithPhantom();
        volt.engine.report(spec.reports.command.id, phantomMask(spec, 0).data);
        await vi.advanceTimersByTimeAsync(100);
        await volt.reconnect();
        expect(phantomReports(volt.sent)).toEqual([]);
    });
});

describe("Using the engine, when a reading shows 48V went off while the Volt stayed connected", () => {
    test("then it should leave 48V off", async () => {
        const volt = await voltWithPhantom();
        volt.reply(stateDump());
        await vi.advanceTimersByTimeAsync(3000);
        expect(phantomReports(volt.sent)).toEqual([]);
    });
});

describe("Using the engine, when a Volt that never had 48V here connects with it on", () => {
    test("then it should leave 48V as the Volt has it", async () => {
        const volt = await connectedEngine();
        volt.sent.length = 0;
        await volt.reconnect(withPhantom(1));
        expect(volt.engine.snapshot().state.preamp.phantom).toEqual([true, false]);
    });
});
