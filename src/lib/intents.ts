import { isChannelIcon } from "./channel-icons.ts";
import { minDb } from "./gain.ts";
import {
    channelById,
    isAlwaysLinked,
    isChannelId,
    linkGroup,
    matchQuieterGain,
    pairKey,
    pairOf,
    setLinked,
    trimName,
} from "./mixer.ts";
import type { ChannelId, CueName, IChannel, IMixerState } from "./mixer.ts";
import { clamp, isFiniteNumber } from "./numbers.ts";
import { outputLevelMax, type DigitalFormat, type ISpec } from "./spec.ts";

/*
 * Every change a user makes, from the page's own controls, the tray window or a phone. This is the
 * one place they change state: values are clamped, and mix changes wait until this computer owns
 * the mix. Another window or a phone may only send the remote ones, checked by isRemoteIntent.
 *
 * A switch either flips (`to` left out: a button on this page) or is set to `to`. Another window
 * or a phone always says `to`: its messages could arrive twice or late, and a flip would undo.
 *
 * A linked pair moves together whatever a view sends: the linked-pair rules live here.
 */

type Ids = ChannelId[];

/* One member per type, so TypeScript can narrow each check. */
/** What the tray window and a phone may change: levels and mutes. */
export type RemoteIntent =
    | { type: "fader"; ids: Ids; db: number }
    | { type: "mute"; ids: Ids; to?: boolean }
    | { type: "monitorLevel"; level: number }
    | { type: "headphoneLevel"; level: number }
    | { type: "monitorMute"; to?: boolean }
    | { type: "headphoneMute"; to?: boolean };

/** Changes only the page's own controls make: the strips' other buttons, channel settings and Settings. */
export type PageIntent =
    | { type: "solo"; ids: Ids; to?: boolean }
    | { type: "link"; id: ChannelId }
    | { type: "monitorMono"; to?: boolean }
    | { type: "pan"; id: ChannelId; pan: number }
    | { type: "cueSend"; ids: Ids; cue: CueName; db: number }
    | { type: "cuePan"; id: ChannelId; cue: CueName; pan: number }
    | { type: "cueMute"; ids: Ids; cue: CueName; to: boolean }
    | { type: "preampGain"; ids: Ids; db: number }
    | { type: "tone"; ids: Ids; tone: number }
    | { type: "phantom"; ids: Ids; to: boolean }
    | { type: "clipProtection"; to: boolean }
    | { type: "brightness"; raw: number }
    | { type: "digitalFormat"; format: DigitalFormat }
    | { type: "headphoneSource"; cue: CueName }
    | { type: "cueSource"; cue: CueName; isMix: boolean }
    | { type: "mirror"; cue: CueName | null }
    | { type: "rename"; ids: Ids; name: string }
    | { type: "icon"; ids: Ids; icon: string };

export type Intent = RemoteIntent | PageIntent;

/** "needsMix": the change is part of the mix, and this computer doesn't have the mix yet. */
export type IntentResult = "ok" | "needsMix" | "ignored";

type Applier<T extends Intent["type"]> = (
    state: IMixerState,
    intent: Extract<Intent, { type: T }>,
    spec: ISpec,
) => boolean;

/** The preamp (or TONE) slots of the channels among `ids` that have one. */
const slots = (ids: Ids, slot: "preampIndex" | "toneIndex"): number[] =>
    ids.map((id) => channelById[id][slot]).filter((index): index is number => index !== undefined);

/** A group's channels move together, to one value read from the first before any changes. */
const setChannels = (state: IMixerState, ids: Ids, change: (first: IChannel) => Partial<IChannel>): boolean => {
    const [first] = ids;
    if (first === undefined) return false;
    const values = change(state.channels[first]);
    for (const id of ids) Object.assign(state.channels[id], values);
    return true;
};

const toggleLink = (state: IMixerState, id: ChannelId): boolean => {
    const pair = pairOf(id);
    if (!pair || isAlwaysLinked(pair)) return false;
    const isOn = !state.linked[pairKey(pair)];
    setLinked(state, pair, isOn);
    if (isOn) matchQuieterGain(state, pair);
    return true;
};

/** Runs a change that can't fail. */
const done = (change: () => void): boolean => (change(), true);

/** Changes each of `indexes` (preamp or TONE slots); false when there are none. */
const setEach = (indexes: number[], change: (index: number) => void): boolean => {
    indexes.forEach(change);
    return indexes.length > 0;
};

const isTone = (tone: number, spec: ISpec): boolean => Number.isInteger(tone) && tone >= 0 && tone < spec.tone.length;

const stripAppliers: { [T in "fader" | "mute" | "solo" | "link"]: Applier<T> } = {
    fader: (state, { ids, db }, spec) => setChannels(state, ids, () => ({ fader: clamp(db, minDb, spec.faderMaxDb) })),
    // Only the field asked for: a pair's two mutes can differ (the Volt reports each input's own).
    mute: (state, { ids, to }) => setChannels(state, ids, (first) => ({ isMuted: to ?? !first.isMuted })),
    solo: (state, { ids, to }) => setChannels(state, ids, (first) => ({ isSoloed: to ?? !first.isSoloed })),
    link: (state, { id }) => toggleLink(state, id),
};

/* Console's 0–100 scale for the outputs. The Volt jumps loud below 0, so 0 is the floor. */
const outputAppliers: {
    [T in "monitorLevel" | "headphoneLevel" | "monitorMute" | "monitorMono" | "headphoneMute"]: Applier<T>;
} = {
    monitorLevel: (state, { level }) => done(() => (state.monitor.level = clamp(level, 0, outputLevelMax))),
    headphoneLevel: (state, { level }) => done(() => (state.headphone.level = clamp(level, 0, outputLevelMax))),
    monitorMute: ({ monitor }, { to }) => done(() => (monitor.isMuted = to ?? !monitor.isMuted)),
    monitorMono: ({ monitor }, { to }) => done(() => (monitor.isMono = to ?? !monitor.isMono)),
    headphoneMute: ({ headphone }, { to }) => done(() => (headphone.isMuted = to ?? !headphone.isMuted)),
};

const mixAppliers: { [T in "pan" | "cueSend" | "cuePan" | "cueMute"]: Applier<T> } = {
    pan: (state, { id, pan }) => done(() => (state.channels[id].pan = clamp(pan, -1, 1))),
    cueSend: (state, { ids, cue, db }, spec) =>
        done(() => ids.forEach((id) => (state.channels[id][cue].db = clamp(db, minDb, spec.faderMaxDb)))),
    cuePan: (state, { id, cue, pan }) => done(() => (state.channels[id][cue].pan = clamp(pan, -1, 1))),
    cueMute: (state, { ids, cue, to }) => done(() => ids.forEach((id) => (state.channels[id][cue].isMuted = to))),
};

const preampAppliers: { [T in "preampGain" | "tone" | "phantom"]: Applier<T> } = {
    preampGain: (state, { ids, db }, spec) =>
        setEach(slots(ids, "preampIndex"), (i) => (state.preamp.gain[i] = clamp(db, 0, spec.preampGainMaxDb))),
    tone: (state, { ids, tone }, spec) =>
        isTone(tone, spec) && setEach(slots(ids, "toneIndex"), (i) => (state.tone[i] = tone)),
    phantom: (state, { ids, to }) => setEach(slots(ids, "preampIndex"), (i) => (state.preamp.phantom[i] = to)),
};

const settingAppliers: { [T in "clipProtection" | "brightness" | "digitalFormat"]: Applier<T> } = {
    clipProtection: (state, { to }) => done(() => (state.device.isClipProtected = to)),
    brightness: (state, { raw }) => done(() => (state.device.brightness = clamp(Math.round(raw), 0, 255))),
    digitalFormat: (state, { format }) => done(() => (state.device.digitalFormat = format)),
};

const routingAppliers: { [T in "headphoneSource" | "cueSource" | "mirror"]: Applier<T> } = {
    headphoneSource: (state, { cue }) => done(() => (state.headphoneSource = cue)),
    cueSource: (state, { cue, isMix }) => done(() => (state.cues[cue].isMix = isMix)),
    mirror: (state, { cue }) =>
        done(() => {
            state.cues.cue1.isMirroredToLine34 = cue === "cue1";
            state.cues.cue2.isMirroredToLine34 = cue === "cue2";
        }),
};

/** Sets or (with "") removes a channel's own label; a pair shares one. */
const setLabel = (labels: Partial<Record<ChannelId, string>>, ids: Ids, label: string): boolean =>
    done(() => ids.forEach((id) => (label ? (labels[id] = label) : delete labels[id])));

const labelAppliers: { [T in "rename" | "icon"]: Applier<T> } = {
    rename: (state, { ids, name }) => setLabel(state.names, ids, trimName(name)),
    icon: (state, { ids, icon }) => (icon === "" || isChannelIcon(icon)) && setLabel(state.icons, ids, icon),
};

const appliers = {
    ...stripAppliers,
    ...outputAppliers,
    ...mixAppliers,
    ...preampAppliers,
    ...settingAppliers,
    ...routingAppliers,
    ...labelAppliers,
} as { [T in Intent["type"]]: Applier<T> };

/** Faders, pan, cue sends, solo, routing, and mutes other than the analog inputs' (the Volt's own Direct). */
const mixTypes = new Set<Intent["type"]>(["fader", "solo", "pan", "cueSend", "cuePan", "cueMute"]);
const routingTypes = new Set<Intent["type"]>(["headphoneSource", "cueSource", "mirror"]);

/** Whether a change is part of the mix, so it waits until this computer owns it. */
export const needsMix = (intent: Intent): boolean =>
    mixTypes.has(intent.type) ||
    routingTypes.has(intent.type) ||
    (intent.type === "mute" && intent.ids.some((id) => channelById[id].kind !== "analog"));

/** Whether a view has to be rebuilt after the change: strips merge, split or appear. A rename is refreshed in place. */
export const changesLayout = (intent: Intent): boolean => intent.type === "link" || intent.type === "digitalFormat";

/* What a linked pair shares (matchQuieterMix, matchQuieterGain). Pan, tone and labels are per side. */
const pairedTypes = new Set<Intent["type"]>(["fader", "mute", "solo", "cueSend", "cueMute", "preampGain"]);

/** The intent with its channels widened to their linked partners, for what a pair shares. */
const forLinks = (state: IMixerState, intent: Intent): Intent =>
    "ids" in intent && pairedTypes.has(intent.type) ? { ...intent, ids: linkGroup(state, intent.ids) } : intent;

/** Applies one intent to the state; the caller commits (and re-lays out, see changesLayout). */
export const applyIntent = (state: IMixerState, intent: Intent, spec: ISpec): IntentResult => {
    if (needsMix(intent) && !state.isMixOwned) return "needsMix";
    const apply = appliers[intent.type] as Applier<Intent["type"]>;
    return apply(state, forLinks(state, intent), spec) ? "ok" : "ignored";
};

const isIdList = (value: unknown): value is Ids =>
    Array.isArray(value) && value.length > 0 && value.length <= 2 && value.every(isChannelId);

/** Whether a message from another window or a phone is one of the changes those may ask for. */
export const isRemoteIntent = (value: unknown): value is RemoteIntent => {
    if (typeof value !== "object" || value === null) return false;
    const { type, ids, db, level, to } = value as Record<string, unknown>;
    if (type === "fader") return isIdList(ids) && isFiniteNumber(db);
    if (type === "monitorLevel" || type === "headphoneLevel") return isFiniteNumber(level);
    // A mute says where it goes: a message could arrive twice, and a flip would undo it.
    if (type === "mute") return isIdList(ids) && typeof to === "boolean";
    return (type === "monitorMute" || type === "headphoneMute") && typeof to === "boolean";
};

/**
 * Whether a message from the app's own page names a change applyIntent knows. Its fields are
 * checked as it's applied (clamped, or refused if they don't fit).
 */
export const isKnownIntent = (value: unknown): value is Intent => {
    const type = typeof value === "object" && value !== null ? (value as { type?: unknown }).type : undefined;
    return typeof type === "string" && Object.hasOwn(appliers, type);
};
