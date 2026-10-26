import { afterEach, describe, expect, test, vi } from "vitest";
import { monitorLevel, toHex } from "../commands.ts";
import { defaultState } from "../mixer.ts";
import { toSavedMix } from "../saved-mix.ts";
import { connectedEngine, crosspoints, spec, stateDump } from "./test-volt.ts";

afterEach(() => void vi.useRealTimers());

/** A saved mix with Inputs 1–4 up, so the engine owns a mix as soon as it connects. */
const ownedMix = (): unknown => toSavedMix(defaultState());

/** Crosspoint reports whose source byte is `source` (the byte after the command). */
const fromSource = (sent: string[], source: number): string[] =>
    crosspoints(sent).filter((hex) => parseInt(hex.slice(4, 6), 16) === source);

describe("Using the engine, when a saved mix is there on connecting", () => {
    test("then it should put the whole mix on the Volt", async () => {
        const { sent } = await connectedEngine({ mix: ownedMix() });
        expect(crosspoints(sent).length).toBe(96);
    });
});

describe("Using the engine, when there's no saved mix on connecting", () => {
    test("then it should send no crosspoint", async () => {
        const { sent } = await connectedEngine();
        expect(crosspoints(sent).length).toBe(0);
    });
});

describe("Using the engine, when a fader moves a hundred times within one send interval", () => {
    test("then it should send that channel's crosspoints once", async () => {
        const volt = await connectedEngine({ mix: ownedMix() });
        volt.sent.length = 0;
        for (let i = 0; i < 100; i++) volt.engine.runIntent({ type: "fader", ids: ["in1"], db: -i / 10 });
        await vi.advanceTimersByTimeAsync(19);
        // Input 1 feeds three stereo buses: six legs, of which the fader moves the monitor's two.
        expect(crosspoints(volt.sent).length).toBe(2);
    });
});

describe("Using the engine, when a fader moves", () => {
    test("then it should send only that channel's crosspoints", async () => {
        const volt = await connectedEngine({ mix: ownedMix() });
        volt.sent.length = 0;
        volt.engine.runIntent({ type: "fader", ids: ["in3"], db: -6 });
        await vi.advanceTimersByTimeAsync(20);
        const source = spec.sources["in3"] ?? -1;
        expect(fromSource(volt.sent, source)).toEqual(crosspoints(volt.sent));
    });
});

describe("Using the engine, when a fader is dragged for a second at 240 moves a second", () => {
    test("then it should send at most 50 batches", async () => {
        const volt = await connectedEngine({ mix: ownedMix() });
        const before = volt.batches();
        for (let ms = 0; ms < 1000; ms += 4) {
            volt.engine.runIntent({ type: "fader", ids: ["in1"], db: -((ms / 4) % 40) });
            await vi.advanceTimersByTimeAsync(4);
        }
        expect(volt.batches() - before).toBeLessThanOrEqual(51);
    });
});

describe("Using the engine, when the monitor level is asked to go below 0", () => {
    test("then it should send 0", async () => {
        const volt = await connectedEngine({ mix: ownedMix() });
        volt.sent.length = 0;
        volt.engine.runIntent({ type: "monitorLevel", level: -5 });
        await vi.advanceTimersByTimeAsync(20);
        expect(volt.sent).toContain(toHex(monitorLevel(spec, 0)));
    });
});

describe("Using the engine, when a reading arrives just after the user moved the monitor level", () => {
    test("then it should keep the level the user set", async () => {
        const volt = await connectedEngine({ mix: ownedMix() });
        volt.engine.runIntent({ type: "monitorLevel", level: 10 });
        await vi.advanceTimersByTimeAsync(100);
        volt.reply(stateDump());
        expect(volt.engine.snapshot().state.monitor.level).toBe(10);
    });
});

describe("Using the engine, when a reading arrives long after the user's last move", () => {
    test("then it should take the level the Volt reports", async () => {
        const volt = await connectedEngine({ mix: ownedMix() });
        volt.engine.runIntent({ type: "monitorLevel", level: 10 });
        await vi.advanceTimersByTimeAsync(2000);
        volt.reply(stateDump());
        expect(volt.engine.snapshot().state.monitor.level).toBe(40);
    });
});

describe("Using the engine, when a reading changes nothing", () => {
    test("then it should send nothing", async () => {
        const volt = await connectedEngine({ mix: ownedMix() });
        await vi.advanceTimersByTimeAsync(2000);
        volt.sent.length = 0;
        volt.reply(stateDump());
        await vi.advanceTimersByTimeAsync(20);
        expect(volt.sent.filter((hex) => !hex.startsWith("f011"))).toEqual([]);
    });
});

describe("Using the engine, when Inputs 1/2 are linked with different faders", () => {
    test("then it should give both the lower fader", async () => {
        const volt = await connectedEngine({ mix: ownedMix() });
        volt.engine.runIntent({ type: "fader", ids: ["in1"], db: -3 });
        volt.engine.runIntent({ type: "fader", ids: ["in2"], db: -9 });
        volt.engine.runIntent({ type: "link", id: "in1" });
        const { channels } = volt.engine.snapshot().state;
        expect([channels.in1.fader, channels.in2.fader]).toEqual([-9, -9]);
    });
});

describe("Using the engine on the website, when readings it didn't ask for keep coming", () => {
    test("then it should leave the mix to the other Volt Mixer", async () => {
        const volt = await connectedEngine({ mix: ownedMix(), isWebsite: true });
        volt.reply(stateDump());
        await vi.advanceTimersByTimeAsync(1000);
        volt.reply(stateDump());
        await vi.advanceTimersByTimeAsync(0);
        expect(volt.engine.snapshot().mixHold).toBe("other");
    });
});

describe("Using the engine in the desktop app, when readings it didn't ask for keep coming", () => {
    test("then it should keep the mix", async () => {
        const volt = await connectedEngine({ mix: ownedMix() });
        volt.reply(stateDump());
        await vi.advanceTimersByTimeAsync(1000);
        volt.reply(stateDump());
        expect(volt.engine.snapshot().mixHold).toBe(null);
    });
});

describe("Using the engine, when the Volt goes away", () => {
    test("then it should send nothing more", async () => {
        const volt = await connectedEngine({ mix: ownedMix() });
        volt.engine.disconnected(false);
        volt.sent.length = 0;
        volt.engine.runIntent({ type: "monitorLevel", level: 20 });
        await vi.advanceTimersByTimeAsync(3000);
        expect(volt.sent).toEqual([]);
    });
});

describe("Using the engine, when no one watches the meters", () => {
    test("then it should pass on no meter frame", async () => {
        const volt = await connectedEngine();
        const frames: unknown[] = [];
        volt.engine.onMeters((frame) => frames.push(frame));
        volt.engine.report(spec.reports.meters.id, new Uint8Array(64).fill(0x40));
        await vi.advanceTimersByTimeAsync(100);
        expect(frames.length).toBe(0);
    });
});

describe("Using the engine, when several meter reports arrive within one frame", () => {
    test("then it should pass on one frame with the highest peak", async () => {
        const volt = await connectedEngine();
        const peaks: number[] = [];
        volt.engine.onMeters(({ levels }) => peaks.push(levels[0] ?? -Infinity));
        volt.engine.setMetersWanted(true);
        const offset = (spec.reports.meters.offsets["in1"] ?? 0) - 1;
        for (const level of [0x1000, 0x7000, 0x2000]) {
            const data = new Uint8Array(64);
            data[offset] = level & 0xff;
            data[offset + 1] = level >> 8;
            volt.engine.report(spec.reports.meters.id, data);
        }
        await vi.advanceTimersByTimeAsync(40);
        expect(peaks.map((db) => Math.round(db))).toEqual([Math.round(20 * Math.log10(0x7000 / 32767))]);
    });
});
