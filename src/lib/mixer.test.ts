import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { toHex } from "./commands.ts";
import type { IReport } from "./commands.ts";
import { applyHardwareState, defaultState, routeSources, setLinked } from "./mixer.ts";
import type { IMixerState } from "./mixer.ts";
import { createMixerSync, reportedSettings } from "./engine/sync.ts";
import { parseState } from "./reports.ts";
import { specFor } from "./spec.ts";

const spec = specFor("1.0.3").spec;
const hexOf = (reports: IReport[]): string[] => reports.map((report) => toHex(report).replace(/f7(00)*$/, "f7"));
const stateMap = JSON.parse(
    readFileSync(new URL("../../reference/decoded/1.0.3-state/state-map.json", import.meta.url), "utf8"),
) as { baseline: number[] };
const dumpWith = (changes: Record<number, number> = {}): Uint8Array => {
    const bytes = [...stateMap.baseline];
    for (const [offset, value] of Object.entries(changes)) bytes[Number(offset)] = value;
    return Uint8Array.from([0x11, ...bytes]);
};

/** A synced pair: state as the Volt has it, with nothing left to send. */
const synced = (isOwned: boolean): { state: IMixerState; diff: () => string[] } => {
    const state = defaultState();
    state.isMixOwned = isOwned;
    const sync = createMixerSync();
    sync.prime(state, spec);
    return { state, diff: () => hexOf(sync.diff(state, spec)) };
};

describe("Using the mixer sync, when nothing has changed", () => {
    test("then it should send nothing", () => {
        expect(synced(true).diff()).toEqual([]);
    });
});

describe("Using the mixer sync, when this computer doesn't own the mix", () => {
    test("then it should send nothing for a fader move", () => {
        const { state, diff } = synced(false);
        state.channels.in3.fader = 6;
        expect(diff()).toEqual([]);
    });
});

describe("Using the mixer sync, when Line 3 moves to −6 dB", () => {
    test("then it should send exactly its two monitor crosspoints", () => {
        const { state, diff } = synced(true);
        state.channels.in3.fader = -6;
        expect(diff()).toEqual(["f0010200b02f570bf7", "f0010201b02f570bf7"]);
    });
});

describe("Using the mixer sync, when Line 3/4 is linked on the page", () => {
    const linked = (): string[] => {
        const { state, diff } = synced(true);
        setLinked(state, ["in3", "in4"], true);
        return diff();
    };
    test("then it should send the link flag first", () => {
        expect(linked()[0]).toBe("f0120212f7");
    });
    test("then it should put Line 3 hard left", () => {
        expect(linked()).toEqual(expect.arrayContaining(["f001020000000020f7", "f001020100000000f7"]));
    });
    test("then it should put Line 4 hard right", () => {
        expect(linked()).toEqual(expect.arrayContaining(["f001030000000000f7", "f001030100000020f7"]));
    });
    test("then it should copy neither preamp gain nor tone", () => {
        expect(linked().some((hex) => hex.startsWith("f016") || hex.startsWith("f022"))).toBe(false);
    });
});

describe("Using the mixer sync, when Line 3 and Line 4 are unmuted", () => {
    test("then it should send one Direct mask with bits 2 and 3", () => {
        const { state, diff } = synced(true);
        for (const id of ["in3", "in4"] as const) state.channels[id].isMuted = false;
        expect(diff()).toEqual(["f0150c000000000001f7"]);
    });
});

describe("Using the mixer sync, when Input 1 is soloed", () => {
    const soloed = (): string[] => {
        const { state, diff } = synced(true);
        state.channels.in1.isSoloed = true;
        return diff();
    };
    test("then it should silence Line 3's monitor legs", () => {
        expect(soloed()).toEqual(expect.arrayContaining(["f001020000000000f7", "f001020100000000f7"]));
    });
    test("then it should change no cue crosspoint", () => {
        expect(soloed().some((hex) => /^f001..0[2-5]/.test(hex))).toBe(false);
    });
});

describe("Using applyHardwareState, when the dump shows Line 3/4 linked with only Line 3 on Direct", () => {
    const applied = (): { state: IMixerState; changed: string[] } => {
        const state = defaultState();
        const changed = applyHardwareState(state, parseState(spec, dumpWith({ 11: 2, 14: 0b0100 })));
        return { state, changed: changed.map((pair) => pair.join("-")) };
    };
    test("then it should report the pair whose link changed", () => {
        expect(applied().changed).toEqual(["in3-in4"]);
    });
    test("then it should let the hardware's mutes win over the link copy", () => {
        const { state } = applied();
        expect([state.channels["in3"]?.isMuted, state.channels["in4"]?.isMuted]).toEqual([false, true]);
    });
});

describe("Using applyHardwareState on the captured baseline dump", () => {
    test("then it should read the headphone level as 79.6", () => {
        const state = defaultState();
        applyHardwareState(state, parseState(spec, dumpWith()));
        expect(state.headphone.level).toBe(79.6);
    });
});

describe("Using routeSources, when Cue 2's MIX is off and the headphones follow Cue 2", () => {
    test("then it should give the headphones Cue 2's own mix", () => {
        const state = defaultState();
        state.cues.cue2.isMix = false;
        state.headphoneSource = "cue2";
        expect(routeSources(state).headphone).toBe("cue2Mix");
    });
});

describe("Using routeSources, when no cue is mirrored", () => {
    test("then it should give Line Out 3/4 the computer's playback", () => {
        expect(routeSources(defaultState()).line34).toBe("playback34");
    });
});

describe("Using the mixer sync, when an ADAT input is soloed but the Volt is set to S/PDIF", () => {
    test("then it should still silence Line 3's monitor legs, never turn them back up", () => {
        const { state, diff } = synced(true);
        state.device.digitalFormat = "spdif";
        state.channels.in3.isMuted = false;
        diff();
        state.channels.adat1.isSoloed = true;
        expect(diff()).toEqual(expect.arrayContaining(["f001020000000000f7", "f001020100000000f7"]));
    });
});

describe("Using the mixer sync, when only the mix is asked for", () => {
    test("then it should send no report of what the Volt keeps itself", () => {
        const state = defaultState();
        state.isMixOwned = true;
        const reports = hexOf(createMixerSync().diff(state, spec, { isFull: true, kind: "mix" }));
        expect(reports.some((hex) => !/^f00[12]/.test(hex))).toBe(false);
    });
});

describe("Using the mixer sync, when the mix is forgotten", () => {
    test("then it should send the mix again but not the Volt's own settings", () => {
        const { state } = synced(true);
        const sync = createMixerSync();
        sync.prime(state, spec);
        sync.forget({ kind: "mix" });
        expect(hexOf(sync.diff(state, spec)).every((hex) => /^f00[12]/.test(hex))).toBe(true);
    });
});

describe("Using reportedSettings, when only a fader moves", () => {
    test("then it should say nothing the Volt reports changed", () => {
        const state = defaultState();
        const before = reportedSettings(state, spec);
        state.channels.in3.fader = -20;
        expect(reportedSettings(state, spec)).toBe(before);
    });
});

describe("Using reportedSettings, when the monitor level changes", () => {
    test("then it should say so", () => {
        const state = defaultState();
        const before = reportedSettings(state, spec);
        state.monitor.level = 40;
        expect(reportedSettings(state, spec)).not.toBe(before);
    });
});
