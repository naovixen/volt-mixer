import { defaultBrightness } from "./display-fade.ts";
import { minDb } from "./gain.ts";
import type { IHardwareState } from "./reports.ts";
import type { DigitalFormat } from "./spec.ts";

/** Every channel of the Volt's mixer, in hardware order. */
export const channelIds = [
    "in1",
    "in2",
    "in3",
    "in4",
    "spdifL",
    "spdifR",
    "adat1",
    "adat2",
    "adat3",
    "adat4",
    "adat5",
    "adat6",
    "adat7",
    "adat8",
    "loopbackL",
    "loopbackR",
] as const;
export type ChannelId = (typeof channelIds)[number];
export type Pair = [ChannelId, ChannelId];
export type ChannelKind = "analog" | "digital" | "loopback";
export const cueNames = ["cue1", "cue2"] as const;
export type CueName = (typeof cueNames)[number];

/** For IDs from outside the page's own code: storage, links, other windows, the DOM. */
export const isChannelId = (value: unknown): value is ChannelId =>
    typeof value === "string" && (channelIds as readonly string[]).includes(value);

export interface IChannelInfo {
    id: ChannelId;
    name: string;
    kind: ChannelKind;
    preampIndex?: number;
    toneIndex?: number;
    format?: DigitalFormat;
}

export interface ISend {
    db: number;
    pan: number;
    isMuted: boolean;
}

export interface IChannel {
    fader: number;
    pan: number;
    isMuted: boolean;
    isSoloed: boolean;
    cue1: ISend;
    cue2: ISend;
}

export interface ICueRouting {
    /** On: the cue's outputs carry the monitor mix. Off: the cue's own mix. */
    isMix: boolean;
    isMirroredToLine34: boolean;
}

/** Page state. Fader, pan, cue sends and cue routing are the page's own (the Volt can't report them). */
export interface IMixerState {
    channels: Record<ChannelId, IChannel>;
    linked: Record<string, boolean>;
    cues: Record<CueName, ICueRouting>;
    headphoneSource: CueName;
    /** Custom channel names (Console keeps these on the computer too); missing = the default name. */
    names: Partial<Record<ChannelId, string>>;
    /** Custom tray icons (names from src/lib/channel-icons.ts); missing = the channel's default. */
    icons: Partial<Record<ChannelId, string>>;
    /** True once this computer's mix has been applied to the Volt; until then no crosspoint is sent. */
    isMixOwned: boolean;
    preamp: { gain: [number, number]; phantom: [boolean, boolean] };
    tone: number[];
    monitor: { isMuted: boolean; isMono: boolean; level: number };
    headphone: { level: number; isMuted: boolean };
    device: { isClipProtected: boolean; brightness: number; digitalFormat: DigitalFormat };
}

type ChannelDetails = Omit<IChannelInfo, "id">;
const adat = (n: number): ChannelDetails => ({ name: `ADAT ${n}`, kind: "digital", format: "adat" });

/* A record, so the compiler insists every channel ID has its details. */
const channelDetails: Record<ChannelId, ChannelDetails> = {
    in1: { name: "Input 1", kind: "analog", preampIndex: 0, toneIndex: 0 },
    in2: { name: "Input 2", kind: "analog", preampIndex: 1, toneIndex: 1 },
    in3: { name: "Line 3", kind: "analog", toneIndex: 2 },
    in4: { name: "Line 4", kind: "analog", toneIndex: 3 },
    spdifL: { name: "S/PDIF L", kind: "digital", format: "spdif" },
    spdifR: { name: "S/PDIF R", kind: "digital", format: "spdif" },
    adat1: adat(1),
    adat2: adat(2),
    adat3: adat(3),
    adat4: adat(4),
    adat5: adat(5),
    adat6: adat(6),
    adat7: adat(7),
    adat8: adat(8),
    loopbackL: { name: "Loopback L", kind: "loopback" },
    loopbackR: { name: "Loopback R", kind: "loopback" },
};

/** Every channel, in hardware order. */
export const channels: IChannelInfo[] = channelIds.map((id) => ({ id, ...channelDetails[id] }));
export const channelById = Object.fromEntries(channels.map((c) => [c.id, c])) as Record<ChannelId, IChannelInfo>;

export const pairs: Pair[] = [
    ["in1", "in2"],
    ["in3", "in4"],
    ["spdifL", "spdifR"],
    ["adat1", "adat2"],
    ["adat3", "adat4"],
    ["adat5", "adat6"],
    ["adat7", "adat8"],
    ["loopbackL", "loopbackR"],
];
/** The analog pairs: bit 0 and bit 1 of the Volt's link mask. */
export const hardwarePairs: Pair[] = [
    ["in1", "in2"],
    ["in3", "in4"],
];
/** Inputs 1–4: bits 0–3 of the Volt's Direct mask. */
export const analogIds = channels.filter((c) => c.kind === "analog").map((c) => c.id);

export const pairKey = (pair: Pair): string => pair.join("-");
export const pairOf = (id: ChannelId): Pair | undefined => pairs.find((pair) => pair.includes(id));
export const isLinked = (state: IMixerState, id: ChannelId): boolean => {
    const pair = pairOf(id);
    return Boolean(pair && state.linked[pairKey(pair)]);
};

/** Loopback is the computer's own stereo playback: always linked, never split. */
export const isAlwaysLinked = ([a]: Pair): boolean => channelById[a].kind === "loopback";

/** The channels that move together with `ids`: each one's linked partner too. */
export const linkGroup = (state: IMixerState, ids: readonly ChannelId[]): ChannelId[] => [
    ...new Set(ids.flatMap((id) => (isLinked(state, id) ? (pairOf(id) ?? [id]) : [id]))),
];

/** Any solo silences every channel that isn't soloed, shown or not (the engine says so: showHiddenSolos in src/lib/engine/engine.ts). */
export const isSoloActive = (state: IMixerState): boolean => channelIds.some((id) => state.channels[id].isSoloed);

/** Channel names are at most 24 UTF-16 units, like the name field's maxlength. */
export const maxNameLength = 24;

/** A name trimmed and cut to the limit, never inside an emoji (a surrogate pair). */
export const trimName = (name: string): string => {
    let result = "";
    for (const character of name.trim()) {
        if (result.length + character.length > maxNameLength) break;
        result += character;
    }
    return result;
};

const silentSend = (): ISend => ({ db: minDb, pan: 0, isMuted: false });

/** Console's default session: every channel at 0 dB, centred; analog inputs muted; loopback on. */
export const defaultChannel = (info: IChannelInfo): IChannel => ({
    fader: 0,
    pan: 0,
    isMuted: info.kind !== "loopback",
    isSoloed: false,
    cue1: silentSend(),
    cue2: silentSend(),
});

export const defaultState = (): IMixerState => {
    const state: IMixerState = {
        channels: Object.fromEntries(channels.map((c) => [c.id, defaultChannel(c)])) as Record<ChannelId, IChannel>,
        linked: { "loopbackL-loopbackR": true },
        cues: { cue1: { isMix: true, isMirroredToLine34: false }, cue2: { isMix: true, isMirroredToLine34: false } },
        headphoneSource: "cue1",
        names: {},
        icons: {},
        isMixOwned: false,
        preamp: { gain: [0, 0], phantom: [false, false] },
        tone: [0, 0, 0, 0],
        monitor: { isMuted: false, isMono: false, level: 0 },
        headphone: { level: 79.6, isMuted: false },
        device: { isClipProtected: true, brightness: defaultBrightness, digitalFormat: "adat" },
    };
    panPair(state, ["loopbackL", "loopbackR"], true);
    return state;
};

const panPair = (state: IMixerState, [a, b]: Pair, isLinkedNow: boolean): void => {
    const [left, right] = [state.channels[a], state.channels[b]];
    const [leftPan, rightPan] = isLinkedNow ? [-1, 1] : [0, 0];
    left.pan = left.cue1.pan = left.cue2.pan = leftPan;
    right.pan = right.cue1.pan = right.cue2.pan = rightPan;
};

/** The quieter of two sends: the lower level, muted if either side is. Pan is set by the link. */
const quieterSend = (a: ISend, b: ISend): ISend => ({
    db: Math.min(a.db, b.db),
    pan: a.pan,
    isMuted: a.isMuted || b.isMuted,
});

/**
 * Gives a linked pair's two sides the quieter side's mix, so a link never turns a fader or send
 * up: the lower fader and sends, muted if either side is. Solo follows either side, so linking
 * never ends a solo (which would bring every other channel back).
 */
export const matchQuieterMix = (state: IMixerState, [a, b]: Pair): void => {
    const [left, right] = [state.channels[a], state.channels[b]];
    const fader = Math.min(left.fader, right.fader);
    const [isMuted, isSoloed] = [left.isMuted || right.isMuted, left.isSoloed || right.isSoloed];
    const [cue1, cue2] = [quieterSend(left.cue1, right.cue1), quieterSend(left.cue2, right.cue2)];
    for (const side of [left, right])
        Object.assign(side, { fader, isMuted, isSoloed, cue1: { ...cue1 }, cue2: { ...cue2 } });
};

/**
 * Inputs 1/2 just linked (on the page, or with the Volt's INPUT button): both preamps take the
 * lower gain. Not on connecting to a pair that was already linked. Other pairs have no preamp.
 */
export const matchQuieterGain = (state: IMixerState, [a, b]: Pair): void => {
    const [first, second] = [channelById[a].preampIndex, channelById[b].preampIndex];
    if (first === undefined || second === undefined) return;
    const gain = Math.min(state.preamp.gain[first] ?? 0, state.preamp.gain[second] ?? 0);
    state.preamp.gain[first] = state.preamp.gain[second] = gain;
};

/**
 * Links or unlinks a pair. Linking gives both sides the quieter side's mix (preamp gain is matched
 * separately, by matchQuieterGain); tone is never shared, as In 2 could be a different source.
 * The pans go hard left and right, as in Console: the same power as two centred legs, but a
 * source on one side alone now plays from one speaker only, louder there.
 */
export const setLinked = (state: IMixerState, pair: Pair, isOn: boolean): void => {
    state.linked[pairKey(pair)] = isOn;
    if (isOn) matchQuieterMix(state, pair);
    panPair(state, pair, isOn);
};

/**
 * Adopts what the Volt reports. Links first, so the hardware's own mutes win. Returns the pairs whose
 * link changed; the preamp gain the Volt reports wins too, so for a pair that just linked the caller
 * matches its gains afterwards (matchQuieterGain), once the reported gains count as sent.
 */
export const applyHardwareState = (state: IMixerState, hardware: IHardwareState): Pair[] => {
    const changed = hardwarePairs.filter(
        (pair, i) => Boolean(state.linked[pairKey(pair)]) !== Boolean(hardware.linkMask & (1 << i)),
    );
    for (const pair of changed) setLinked(state, pair, !state.linked[pairKey(pair)]);
    setDirectMask(state, hardware.directMask);
    state.preamp.gain = [...hardware.preampGain];
    setPhantomMask(state, hardware.phantomMask);
    state.tone = [...hardware.tone];
    state.monitor = { ...hardware.monitor };
    state.headphone = { ...hardware.headphone };
    state.device = {
        isClipProtected: hardware.isClipProtected,
        brightness: hardware.brightness,
        digitalFormat: hardware.digitalFormat,
    };
    return changed;
};

export const hardwareLinkMask = (state: IMixerState): number =>
    hardwarePairs.reduce((mask, pair, i) => mask | (state.linked[pairKey(pair)] ? 1 << i : 0), 0);

export const directMask = (state: IMixerState): number =>
    analogIds.reduce((mask, id, i) => mask | (state.channels[id].isMuted ? 0 : 1 << i), 0);

/** Bit i set: analog input i is on Direct (unmuted). The inverse of directMask. */
export const setDirectMask = (state: IMixerState, mask: number): void =>
    analogIds.forEach((id, i) => (state.channels[id].isMuted = !(mask & (1 << i))));

export const phantomMask = (state: IMixerState): number =>
    state.preamp.phantom.reduce((mask, isOn, i) => mask | (isOn ? 1 << i : 0), 0);

/** Bit i set: preamp i has 48V. The inverse of phantomMask. */
export const setPhantomMask = (state: IMixerState, mask: number): void =>
    void (state.preamp.phantom = [Boolean(mask & 1), Boolean(mask & 2)]);

/** What feeds the headphones and Line Out 3/4, from the cue routing. Keys are spec.routeSources names. */
export const routeSources = (state: IMixerState): { headphone: string; line34: string } => {
    const sourceOf = (cue: CueName): string => (state.cues[cue].isMix ? "monitorMix" : `${cue}Mix`);
    const mirrored = cueNames.find((cue) => state.cues[cue].isMirroredToLine34);
    return { headphone: sourceOf(state.headphoneSource), line34: mirrored ? sourceOf(mirrored) : "playback34" };
};
