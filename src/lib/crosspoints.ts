import { minDb, panGains } from "./gain.ts";
import {
    channels,
    isSoloActive,
    type ChannelId,
    type IChannel,
    type IChannelInfo,
    type IMixerState,
    type ISend,
} from "./mixer.ts";
import { busNames, type BusName, type ISpec } from "./spec.ts";

/*
 * The mix as the Volt's crosspoints: every channel feeds each stereo bus through two legs, one
 * per side, each a linear gain from the fader (or send) and its equal-power pan.
 */

/** One leg: a mixer source into one side of a bus. */
export interface ILeg {
    source: number;
    destination: number;
    linear: number;
}

/** Both legs of a mono source into a stereo bus, at `db` and `pan` (−1…+1). */
export const busLegs = (spec: ISpec, source: number, bus: BusName, db: number, pan: number): ILeg[] => {
    const [left, right] = spec.mixBuses[bus];
    const [gainLeft, gainRight] = panGains(db, pan);
    return [
        { source, destination: left, linear: gainLeft },
        { source, destination: right, linear: gainRight },
    ];
};

const monitorSend = (info: IChannelInfo, channel: IChannel, isSoloOn: boolean): ISend => {
    // Analog mute is the Volt's Direct flag; digital and loopback mutes are a silent crosspoint.
    const isSoloedOut = isSoloOn && !channel.isSoloed;
    const isOff = (info.kind !== "analog" && channel.isMuted) || isSoloedOut;
    return { db: channel.fader, pan: channel.pan, isMuted: isOff };
};

const sendOf = (state: IMixerState, info: IChannelInfo, bus: BusName, isSoloOn: boolean): ISend => {
    const channel = state.channels[info.id];
    return bus === "monitor" ? monitorSend(info, channel, isSoloOn) : channel[bus];
};

/** One channel's legs into every bus (both sides of each), with solo already worked out. */
export const channelLegs = (state: IMixerState, spec: ISpec, info: IChannelInfo, isSoloOn: boolean): ILeg[] => {
    const source = spec.sources[info.id];
    if (source === undefined) return [];
    return busNames.flatMap((bus) => {
        const send = sendOf(state, info, bus, isSoloOn);
        return busLegs(spec, source, bus, send.isMuted ? minDb : Math.min(send.db, spec.faderMaxDb), send.pan);
    });
};

/**
 * Every leg of the mix, or only those of `only`; none until this computer owns it (the Volt keeps
 * what it has until then).
 */
export const mixLegs = (state: IMixerState, spec: ISpec, only?: ReadonlySet<ChannelId>): ILeg[] => {
    if (!state.isMixOwned) return [];
    const isSoloOn = isSoloActive(state);
    return channels
        .filter((info) => !only || only.has(info.id))
        .flatMap((info) => channelLegs(state, spec, info, isSoloOn));
};
