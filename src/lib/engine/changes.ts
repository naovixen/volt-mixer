import type { Intent } from "../intents.ts";
import { channelIds, linkGroup, type ChannelId, type IMixerState } from "../mixer.ts";

/*
 * What a change touched, so each view redraws only its part and the sync re-computes only the
 * crosspoints of the channels that moved. A topic is a part of the snapshot (engine.ts); channels
 * say which strips. When in doubt a change says more, never less: views and the sync compare
 * values anyway, so an extra topic costs a little time and a missing one a stale view.
 */

export type Topic =
    /** The strips themselves: which there are (a link, the digital format, the view settings). */
    | "layout"
    /** Channel values: faders, pans, sends, mutes, solos, names, icons (which ones: `channels`). */
    | "channels"
    /** Monitor and headphone levels and mutes, mono. */
    | "outputs"
    /** Preamp gain, 48V and TONE. */
    | "inputs"
    /** Brightness, clip protection, digital format. */
    | "device"
    /** Cue routing and the headphone source. */
    | "routing"
    /** The connection, whether the page can send, mix ownership and what holds it back. */
    | "status"
    /** The notice bar's lasting conditions. */
    | "conditions"
    /** What this viewer chose to see (Settings › View, the tray's rows). */
    | "view";

export interface IChanges {
    topics: Set<Topic>;
    channels: Set<ChannelId>;
}

export const noChanges = (): IChanges => ({ topics: new Set(), channels: new Set() });

/** Everything: a new connection, a new mix, a view opening. */
export const allChanges = (): IChanges => ({
    topics: new Set<Topic>([
        "layout",
        "channels",
        "outputs",
        "inputs",
        "device",
        "routing",
        "status",
        "conditions",
        "view",
    ]),
    channels: new Set(channelIds),
});

export const addChanges = (into: IChanges, topics: readonly Topic[], channels: Iterable<ChannelId> = []): void => {
    topics.forEach((topic) => into.topics.add(topic));
    for (const id of channels) into.channels.add(id);
};

export const mergeChanges = (into: IChanges, from: IChanges): void => addChanges(into, [...from.topics], from.channels);

type Rule = (intent: Intent, state: IMixerState) => [Topic[], readonly ChannelId[]];

/** The channels an intent names, with their linked partners (applyIntent moves a pair together). */
const named = (intent: Intent, state: IMixerState): ChannelId[] =>
    linkGroup(state, "ids" in intent ? intent.ids : "id" in intent ? [intent.id] : []);

const onChannels: Rule = (intent, state) => [["channels"], named(intent, state)];
const onInputs: Rule = (intent, state) => [["inputs", "channels"], named(intent, state)];

const rules: { [T in Intent["type"]]: Rule } = {
    fader: onChannels,
    mute: onChannels,
    pan: onChannels,
    cueSend: onChannels,
    cuePan: onChannels,
    cueMute: onChannels,
    rename: onChannels,
    icon: onChannels,
    // A solo silences every other channel in the monitor mix.
    solo: () => [["channels"], channelIds],
    link: () => [["layout", "channels"], channelIds],
    preampGain: onInputs,
    phantom: onInputs,
    tone: onInputs,
    monitorLevel: () => [["outputs"], []],
    headphoneLevel: () => [["outputs"], []],
    monitorMute: () => [["outputs"], []],
    monitorMono: () => [["outputs"], []],
    headphoneMute: () => [["outputs"], []],
    clipProtection: () => [["device"], []],
    brightness: () => [["device"], []],
    digitalFormat: () => [["device", "layout"], []],
    headphoneSource: () => [["routing"], []],
    cueSource: () => [["routing"], []],
    mirror: () => [["routing"], []],
};

/** What an applied intent touched. */
export const intentChanges = (intent: Intent, state: IMixerState): IChanges => {
    const changes = noChanges();
    const [topics, channels] = rules[intent.type](intent, state);
    addChanges(changes, topics, channels);
    return changes;
};
