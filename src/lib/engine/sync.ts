import * as commands from "../commands.ts";
import type { IReport } from "../commands.ts";
import { mixLegs } from "../crosspoints.ts";
import { crosspointValue } from "../gain.ts";
import { directMask, hardwareLinkMask, phantomMask, routeSources } from "../mixer.ts";
import type { ChannelId, IMixerState } from "../mixer.ts";
import type { ISpec } from "../spec.ts";

/**
 * "mix": what only this page knows (crosspoints and routing), sent once it owns the mix.
 * "reported": what the Volt reports about itself (links, mutes, levels, preamps, display).
 */
export type SyncKind = "mix" | "reported";

export interface ISyncScope {
    /** Only this kind; both when left out. */
    kind?: SyncKind;
    /** Only the keys this accepts ("brightness", "gain0", …); all when left out. */
    keys?: (key: string) => boolean;
    /**
     * Only these channels' crosspoints (the ones a change touched); all when left out. The other
     * entries are few and always compared.
     */
    channels?: ReadonlySet<ChannelId>;
}

/** A value to compare with what was sent: a number, flag or short text, never an object. */
type Value = number | boolean | string;

interface IEntry {
    key: string;
    kind: SyncKind;
    value: Value;
    build: () => IReport | IReport[];
}

export interface IMixerSync {
    /** Reports for what changed since the last diff (`isFull`: everything in scope). */
    diff: (state: IMixerState, spec: ISpec, options?: ISyncScope & { isFull?: boolean }) => IReport[];
    /** Treats the current state as already applied. */
    prime: (state: IMixerState, spec: ISpec, scope?: ISyncScope) => void;
    /** Forgets what was sent, so it goes again on the next diff. */
    forget: (scope?: ISyncScope) => void;
}

type Group = (state: IMixerState, spec: ISpec, scope: ISyncScope) => IEntry[];

const mix = (key: string, value: Value, build: IEntry["build"]): IEntry => ({ key, kind: "mix", value, build });
const reported = (key: string, value: Value, build: IEntry["build"]): IEntry => ({
    key,
    kind: "reported",
    value,
    build,
});

const crosspointEntries: Group = (state, spec, { channels }) =>
    mixLegs(state, spec, channels).map(({ source, destination, linear }) =>
        mix(`x${source}:${destination}`, crosspointValue(spec, linear), () =>
            commands.crosspoint(spec, source, destination, linear),
        ),
    );

const routeEntries: Group = (state, spec) => {
    if (!state.isMixOwned) return [];
    const { headphone, line34 } = routeSources(state);
    return [
        mix("routeHeadphone", headphone, () => commands.routePair(spec, "headphone", headphone)),
        mix("routeLine34", line34, () => commands.routePair(spec, "line34", line34)),
    ];
};

const linkEntries: Group = (state, spec) => {
    const mask = hardwareLinkMask(state);
    return [reported("links", mask, () => commands.linkMask(spec, mask))];
};

const outputEntries: Group = (state, spec) => {
    const { monitor, headphone } = state;
    const direct = directMask(state);
    return [
        reported("direct", direct, () => commands.muteWord(spec, "direct", direct)),
        reported("monitorMute", monitor.isMuted, () => commands.muteWord(spec, "monitorMute", monitor.isMuted)),
        reported("mono", monitor.isMono, () => commands.monitorMono(spec, monitor.isMono)),
        reported("monitorLevel", monitor.level, () => commands.monitorLevel(spec, monitor.level)),
        reported("headphone", `${headphone.level}:${headphone.isMuted}`, () =>
            commands.headphone(spec, headphone.level, headphone.isMuted),
        ),
    ];
};

const inputEntries: Group = (state, spec) => {
    const phantom = phantomMask(state);
    return [
        reported("phantom", phantom, () => commands.phantomMask(spec, phantom)),
        reported("tone", state.tone.join(","), () => commands.tone(spec, state.tone)),
        ...state.preamp.gain.map((db, i) => reported(`gain${i}`, db, () => commands.preampGain(spec, i, db))),
    ];
};

const deviceEntries: Group = (state, spec) => {
    const { isClipProtected, brightness, digitalFormat } = state.device;
    return [
        reported("clip", isClipProtected, () => commands.clipProtection(spec, isClipProtected)),
        reported("brightness", brightness, () => commands.brightness(spec, brightness)),
        reported("digital", digitalFormat, () => commands.digitalFormat(spec, digitalFormat)),
    ];
};

/** In sending order. Link state goes first: Console sends it before re-writing the pair's crosspoints. */
const groups: { kind: SyncKind; entries: Group }[] = [
    { kind: "reported", entries: linkEntries },
    { kind: "mix", entries: crosspointEntries },
    { kind: "mix", entries: routeEntries },
    { kind: "reported", entries: outputEntries },
    { kind: "reported", entries: inputEntries },
    { kind: "reported", entries: deviceEntries },
];

/** The entries in scope; a group of another kind isn't even built. */
const entriesIn = (state: IMixerState, spec: ISpec, scope: ISyncScope): IEntry[] => {
    const { kind, keys } = scope;
    const entries = groups
        .filter((group) => kind === undefined || group.kind === kind)
        .flatMap((group) => group.entries(state, spec, scope));
    return keys ? entries.filter((member) => keys(member.key)) : entries;
};

/** What the Volt reports about itself, as one comparable value: whether a reading changed anything. */
export const reportedSettings = (state: IMixerState, spec: ISpec): string =>
    entriesIn(state, spec, { kind: "reported" })
        .map(({ key, value }) => `${key}=${value}`)
        .join(";");

/** Remembers what the Volt was last told and produces only the reports that differ. */
export const createMixerSync = (): IMixerSync => {
    const sent = new Map<string, { kind: SyncKind; value: Value }>();
    const diff: IMixerSync["diff"] = (state, spec, { isFull = false, ...scope } = {}) => {
        const reports: IReport[] = [];
        for (const { key, kind, value, build } of entriesIn(state, spec, scope)) {
            if (!isFull && sent.get(key)?.value === value) continue;
            sent.set(key, { kind, value });
            const built = build();
            if (Array.isArray(built)) reports.push(...built);
            else reports.push(built);
        }
        return reports;
    };
    return {
        diff,
        prime: (state, spec, scope = {}) => void diff(state, spec, scope),
        forget: ({ kind, keys = () => true } = {}) => {
            for (const [key, { kind: sentKind }] of sent) {
                if ((kind === undefined || kind === sentKind) && keys(key)) sent.delete(key);
            }
        },
    };
};
