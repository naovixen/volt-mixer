import { commandNames, type CommandName, type DigitalFormat, type ISpec, type MuteField } from "./spec.ts";

export interface IIdentity {
    vendorId: number;
    productId: number;
    version: string;
    serial: string;
}

/**
 * Everything the Volt reports about itself in its state dump. Fader and pan positions aren't in it.
 * Masks stay masks, as in the Volt's other reports; src/lib/mixer.ts turns them into page state.
 */
export interface IHardwareState {
    phantomMask: number;
    digitalFormat: DigitalFormat;
    linkMask: number;
    directMask: number;
    monitor: { isMuted: boolean; level: number; isMono: boolean };
    preampGain: [number, number];
    headphone: { level: number; isMuted: boolean };
    isClipProtected: boolean;
    brightness: number;
    tone: number[];
}

/** A front-panel change or other report, decoded. `type` says which fields are set. */
export type DeviceReport =
    | { type: "state"; data: Uint8Array }
    | { type: "direct"; mask: number }
    | { type: "monitorMute"; isMuted: boolean }
    | { type: "monitorLevel"; level: number }
    | { type: "headphone"; level: number; isMuted: boolean }
    | { type: "tone"; tones: number[] }
    | { type: "phantom"; mask: number }
    | { type: "preampGain"; channel: number; db: number }
    | { type: "mono"; isOn: boolean }
    | { type: "clipProtection"; isOn: boolean }
    | { type: "brightness"; raw: number }
    | { type: "digitalFormat"; format: DigitalFormat }
    | { type: "links"; mask: number }
    | { type: "panel"; field: number; value: number }
    | { type: "unknown"; cmd: number };

const byte = (data: Uint8Array, i: number): number => data[i] ?? 0;
const formatAt = (spec: ISpec, index: number): DigitalFormat =>
    spec.digitalFormat[index] === "spdif" ? "spdif" : "adat";
const u16 = (data: Uint8Array, i: number): number => byte(data, i) | (byte(data, i + 1) << 8);

/** Identify reply (report 0x0E): VID, PID, bcdDevice (BCD major, minor/patch nibbles), ASCII serial. */
export const parseIdentify = (data: Uint8Array): IIdentity => {
    const high = byte(data, 5);
    const low = byte(data, 4);
    const version = `${(high >> 4) * 10 + (high & 0xf)}.${low >> 4}.${low & 0xf}`;
    let serial = "";
    for (let i = 6; i < data.length && byte(data, i) >= 0x30 && byte(data, i) <= 0x7a; i++) {
        serial += String.fromCharCode(byte(data, i));
    }
    return { vendorId: u16(data, 0), productId: u16(data, 2), version, serial };
};

const muteWordReport = (spec: ISpec, data: Uint8Array): DeviceReport => {
    const field = byte(data, 7);
    const value = (name: MuteField): number => byte(data, 1 + spec.muteWordOffsets[name]);
    if (field === spec.muteWordFields.direct) return { type: "direct", mask: value("direct") };
    if (field === spec.muteWordFields.monitorMute) return { type: "monitorMute", isMuted: value("monitorMute") === 1 };
    if (field === spec.muteWordFields.monitorLevel) {
        const raw = u16(data, 1 + spec.muteWordOffsets.monitorLevel);
        return { type: "monitorLevel", level: raw / spec.monitorLevelPerUnit };
    }
    return { type: "unknown", cmd: byte(data, 0) };
};

const panelReport = (spec: ISpec, data: Uint8Array): DeviceReport =>
    byte(data, 1) === spec.linkState.field
        ? { type: "links", mask: byte(data, 2) & 0x0f }
        : { type: "panel", field: byte(data, 1), value: byte(data, 2) };

const toneNibbles = (first: number, second: number): number[] => [first & 0xf, first >> 4, second & 0xf, second >> 4];

type Decoder = (spec: ISpec, data: Uint8Array) => DeviceReport;

/** The reports the Volt sends in command format, by the command they share a byte with. */
const decoders: Partial<Record<CommandName, Decoder>> = {
    stateRequest: (_spec, data) => ({ type: "state", data }),
    muteWord: muteWordReport,
    headphone: (spec, data) => ({
        type: "headphone",
        level: u16(data, 1) / spec.headphoneLevelScale,
        isMuted: byte(data, 3) === 1,
    }),
    tone: (_spec, data) => ({ type: "tone", tones: toneNibbles(byte(data, 1), byte(data, 2)) }),
    phantomMask: (_spec, data) => ({ type: "phantom", mask: byte(data, 1) }),
    preampGain: (spec, data) => ({
        type: "preampGain",
        channel: byte(data, 1),
        db: u16(data, 2) / spec.preampGainStepsPerDb,
    }),
    monitorMono: (_spec, data) => ({ type: "mono", isOn: byte(data, 2) === 1 }),
    clipProtection: (_spec, data) => ({ type: "clipProtection", isOn: byte(data, 1) === 1 }),
    brightness: (_spec, data) => ({ type: "brightness", raw: byte(data, 1) }),
    digitalFormat: (spec, data) => ({ type: "digitalFormat", format: formatAt(spec, byte(data, 1)) }),
    panelState: panelReport,
};

/** Decodes a command-format report from the Volt (`data` starts at the command byte). */
export const parseCommandReport = (spec: ISpec, data: Uint8Array): DeviceReport => {
    const cmd = byte(data, 0);
    const name = commandNames.find((candidate) => spec.commands[candidate] === cmd);
    return (name && decoders[name]?.(spec, data)) ?? { type: "unknown", cmd };
};

/** Reads the state dump's fields: `data` starts at the command byte, offsets count after it. */
const stateReader = (spec: ISpec, data: Uint8Array) => ({
    at: (offset: number): number => byte(data, 1 + offset),
    word: (offset: number): number => u16(data, 1 + offset),
    gain: (index: number): number =>
        u16(data, 1 + (spec.stateLayout.preampGainU16[index] ?? 0)) / spec.preampGainStepsPerDb,
});

/** State dump (reply to the state request): `data` starts at the command byte. */
export const parseState = (spec: ISpec, data: Uint8Array): IHardwareState => {
    const layout = spec.stateLayout;
    const { at, word, gain } = stateReader(spec, data);
    const [tone1 = 0, tone2 = 0] = layout.toneNibbles;
    return {
        phantomMask: at(layout.phantomMask),
        digitalFormat: formatAt(spec, at(layout.digitalFormat)),
        linkMask: at(layout.linkMask) & 0x0f,
        directMask: at(layout.directMask),
        monitor: {
            isMuted: at(layout.monitorMute) === 1,
            level: word(layout.monitorLevel) / spec.monitorLevelPerUnit,
            isMono: at(layout.monitorMono) === 1,
        },
        preampGain: [gain(0), gain(1)],
        headphone: {
            level: word(layout.headphoneLevelU16) / spec.headphoneLevelScale,
            isMuted: at(layout.headphoneMute) === 1,
        },
        isClipProtected: at(layout.clipProtection) === 1,
        brightness: at(layout.brightness),
        tone: toneNibbles(at(tone1), at(tone2)),
    };
};

/** Meter report (0xF1, `data` after the report ID): dBFS per named meter; −Infinity when silent. */
export const parseMeters = (spec: ISpec, data: Uint8Array): Record<string, number> => {
    const meters = spec.reports.meters;
    const levels: Record<string, number> = {};
    for (const [name, offset] of Object.entries(meters.offsets)) {
        // Bit 15 is a flag, not level (seen on Input 1's preamp meter); the level is the low 15 bits.
        const value = u16(data, offset - 1) & 0x7fff;
        levels[name] = value ? 20 * Math.log10(Math.min(value, meters.fullScale) / meters.fullScale) : -Infinity;
    }
    return levels;
};
