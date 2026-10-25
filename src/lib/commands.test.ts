import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import * as commands from "./commands.ts";
import { defaultState, type IMixerState } from "./mixer.ts";
import { createMixerSync } from "./mixer-sync.ts";
import { parseCommandReport } from "./reports.ts";
import type { DeviceReport } from "./reports.ts";
import { specFor, type MuteField } from "./spec.ts";

interface IStep {
    label: string;
    value: unknown;
    out: { type: string; data: string }[];
    inReports?: string[];
}

const spec = specFor("1.0.3").spec;
const decoded = (name: string): IStep[] =>
    JSON.parse(readFileSync(new URL(`../../reference/decoded/${name}/steps.json`, import.meta.url), "utf8")) as IStep[];
const trimmed = (hex: string): string => hex.replace(/f7(00)*$/, "f7");
const sentBy = (step: IStep): string[] => step.out.map((report) => trimmed(report.data));
const hexOf = (reports: commands.IReport[]): string[] => reports.map((report) => trimmed(commands.toHex(report)));
const stepsLabelled = (steps: IStep[], label: string): IStep[] =>
    steps.filter((step) => step.label.replace(/ \(restore\)$/, "") === label && step.out.length > 0);
const sweep = decoded("1.0.3.0");

/** Every expected report must be among what UA's software sent for that step. */
const isReproduced = (label: string, build: (value: number) => commands.IReport[]): boolean => {
    const steps = stepsLabelled(sweep, label);
    return (
        steps.length > 0 &&
        steps.every((step) => hexOf(build(step.value as number)).every((hex) => sentBy(step).includes(hex)))
    );
};

/** The crosspoints the page itself sends for one source's two legs into a bus, after `change`. */
const legsAfter =
    (source: number, destinations: [number, number], change: (state: IMixerState, value: number) => void) =>
    (value: number): commands.IReport[] => {
        const state = defaultState();
        state.isMixOwned = true;
        change(state, value);
        const keys = (key: string): boolean => destinations.some((destination) => key === `x${source}:${destination}`);
        return createMixerSync().diff(state, spec, { isFull: true, kind: "mix", keys });
    };

describe("Using the mixer sync, when re-encoding the captured Line 3 fader sweep", () => {
    test("then it should reproduce every crosspoint UA's software sent", () => {
        const build = legsAfter(2, spec.mixBuses.monitor, (state, db) => (state.channels.in3.fader = db));
        expect(isReproduced("ANALOG 3 fader", build)).toBe(true);
    });
});

describe("Using the mixer sync, when re-encoding the captured Line 3 pan sweep", () => {
    test("then it should reproduce every crosspoint UA's software sent", () => {
        const build = legsAfter(2, spec.mixBuses.monitor, (state, pan) => (state.channels.in3.pan = pan));
        expect(isReproduced("ANALOG 3 pan", build)).toBe(true);
    });
});

describe("Using the mixer sync, when re-encoding the captured Input 1 cue 1 send sweep", () => {
    test("then it should reproduce every crosspoint UA's software sent", () => {
        const build = legsAfter(0, spec.mixBuses.cue1, (state, db) => (state.channels.in1.cue1.db = db));
        expect(isReproduced("ANALOG 1 cue_0 send", build)).toBe(true);
    });
});

describe("Using preampGain, when re-encoding the captured Input 1 gain sweep", () => {
    test("then it should reproduce every report UA's software sent", () => {
        expect(isReproduced("ANALOG 1 preamp gain", (db) => [commands.preampGain(spec, 0, db)])).toBe(true);
    });
});

describe("Using brightness, when re-encoding the captured brightness sweep", () => {
    test("then it should reproduce every report UA's software sent", () => {
        expect(isReproduced("display brightness", (raw) => [commands.brightness(spec, raw)])).toBe(true);
    });
});

describe("Using muteWord, when asked for a monitor level below 0", () => {
    test("then it should send 0, because the Volt jumps loud below 0", () => {
        expect(hexOf([commands.muteWord(spec, "monitorLevel", -20)])).toEqual(["f01500000000000010f7"]);
    });
});

describe("Using monitorLevel, when given Console's full level 100", () => {
    test("then it should send raw 1000 as a u16, reaching full monitor volume", () => {
        expect(hexOf([commands.monitorLevel(spec, 100)])).toEqual(["f01500000000e80310f7"]);
    });
});

const reencode = (report: DeviceReport): commands.IReport | null => {
    const builders: Partial<Record<DeviceReport["type"], () => commands.IReport>> = {
        direct: () => commands.muteWord(spec, "direct", (report as { mask: number }).mask),
        monitorMute: () => commands.muteWord(spec, "monitorMute", (report as { isMuted: boolean }).isMuted),
        monitorLevel: () => commands.monitorLevel(spec, (report as { level: number }).level),
        headphone: () =>
            commands.headphone(spec, (report as { level: number }).level, (report as { isMuted: boolean }).isMuted),
        tone: () => commands.tone(spec, (report as { tones: number[] }).tones),
        phantom: () => commands.phantomMask(spec, (report as { mask: number }).mask),
        preampGain: () =>
            commands.preampGain(spec, (report as { channel: number }).channel, (report as { db: number }).db),
        mono: () => commands.monitorMono(spec, (report as { isOn: boolean }).isOn),
    };
    return builders[report.type]?.() ?? null;
};

/**
 * A mute-word report names one field in its last byte and the device applies only that one, but
 * Console fills the other fields with the current state. The page sends only the named field, so
 * compare just that: zero the other fields' bytes before the byte-for-byte round-trip check.
 */
const canonicalMuteWord = (hex: string): string => {
    const data = [...Buffer.from(hex.slice(2), "hex")];
    if (data[0] !== spec.commands.muteWord) return hex;
    const named = (Object.keys(spec.muteWordFields) as MuteField[]).find((f) => spec.muteWordFields[f] === data[7]);
    if (!named) return hex;
    for (const field of Object.keys(spec.muteWordOffsets) as MuteField[]) {
        if (field === named) continue;
        data[1 + spec.muteWordOffsets[field]] = 0;
        if (field === "monitorLevel") data[1 + spec.muteWordOffsets[field] + 1] = 0; // u16 high byte
    }
    return "f0" + Buffer.from(data).toString("hex");
};

const roundTripFailures = (steps: IStep[]): string[] =>
    steps
        .flatMap((step) => [...step.out.map((report) => report.data), ...(step.inReports ?? [])])
        .filter((hex) => hex.startsWith("f0"))
        .filter((hex) => {
            const again = reencode(parseCommandReport(spec, Uint8Array.from(Buffer.from(hex.slice(2), "hex"))));
            return again !== null && trimmed(commands.toHex(again)) !== trimmed(canonicalMuteWord(hex));
        });

describe.each(["1.0.3.0", "1.0.3.0-startup", "1.0.3.0-manual", "1.0.5.0", "1.0.5.0-manual"])(
    "Using parseCommandReport on the %s capture",
    (name) => {
        test("then it should encode every report it decodes back to the same bytes", () => {
            expect(roundTripFailures(decoded(name))).toEqual([]);
        });
    },
);

describe("Using routePair, when the source isn't in the protocol data", () => {
    test("then it should send nothing", () => {
        expect(commands.routePair(spec, "headphone", "notCaptured")).toEqual([]);
    });
});

const routing = decoded("1.0.3.0-routing");
const routeSent = (label: string): string[] =>
    sentBy(routing.find((step) => step.label === label) ?? { label, value: null, out: [] });

describe.each([
    ["HP source cue2", "headphone", "cue2Mix"],
    ["CUE 2 mirror LINE 3-4", "line34", "cue2Mix"],
    ["CUE 2 mirror None", "line34", "playback34"],
    ["CUE 1 MIX off", "headphone", "cue1Mix"],
    ["CUE 1 mirror LINE 3-4", "line34", "cue1Mix"],
    ["CUE 1 MIX on", "headphone", "monitorMix"],
])("Using routePair for the captured step %s", (label, destination, source) => {
    test("then it should reproduce what UA's software sent", () => {
        expect(routeSent(label)).toEqual(expect.arrayContaining(hexOf(commands.routePair(spec, destination, source))));
    });
});

const autoGainSteps = decoded("1.0.3.0-autogain");

describe.each([
    ["auto-gain run (5 s)", 5],
    ["auto-gain cancel start", 10],
])("Using autoGain for the captured step %s", (label, seconds) => {
    test("then it should reproduce what UA's software sent", () => {
        const step = autoGainSteps.find((candidate) => candidate.label === label);
        expect(sentBy(step ?? { label, value: null, out: [] })).toEqual(
            hexOf([commands.autoGain(spec, 0b10, seconds)]),
        );
    });
});
