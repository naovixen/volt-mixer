import type { IReport } from "../commands.ts";
import { defaultState, type ChannelId, type IMixerState } from "../mixer.ts";
import { newestSpec, type ISpec } from "../spec.ts";
import type { IStripView } from "../strip-groups.ts";
import { addChanges, noChanges, type IChanges, type Topic } from "./changes.ts";
import type { IConnectionInfo, IEngineOptions, IEngineStore, ITransport } from "./ports.ts";
import { createMixerSync, type IMixerSync } from "./sync.ts";

/*
 * The engine's shared state, and the few things every part of it does: say what changed (once per
 * task, however many changes), keep the notice bar's conditions, pass on a message.
 */

/**
 * Why the website holds back its mix on a connected Volt (ownership.ts): "listening" just after
 * connecting, for another Volt Mixer on this computer; "other" while one is open, as it has the mix.
 */
export type MixHold = "listening" | "other" | null;

export type MessageKind = "success" | "info" | "warning" | "error";
export type StatusKind = "off" | "on" | "away";

/** Something the notice bar can do about a condition: the view maps it to an engine call. */
export type ConditionCommand = "allow-sending" | "clear-hidden-solo";

export interface ICondition {
    key: string;
    text: string;
    kind: MessageKind;
    action?: { label: string; command: ConditionCommand };
}

/** What this viewer chose to see: optional strips, and the rows left out of the tray. */
export interface IEngineView extends IStripView {
    trayHidden: string[];
}

export interface IEngineFlags {
    serial: string;
    /** The Volt's state dump has arrived this connection. */
    isHardwareKnown: boolean;
    /** The firmware matched exactly, or the user chose "Use anyway". */
    isSendAllowed: boolean;
    /** This program drives the Volt (on the website: this tab holds the lock). */
    hasControl: boolean;
    mixHold: MixHold;
    /** When the user last changed something (performance.now()), so re-reading the Volt waits. */
    lastEditAt: number;
}

export interface ICore {
    state: IMixerState;
    flags: IEngineFlags;
    view: IEngineView;
    sync: IMixerSync;
    store: IEngineStore;
    options: IEngineOptions;
    connection: { info: IConnectionInfo; spec: ISpec } | null;
    status: { text: string; kind: StatusKind };
    conditions: Map<string, ICondition>;
    connectedSpec: () => ISpec | null;
    /** The connected Volt's spec, or the newest recorded one while none is. */
    spec: () => ISpec;
    /** Whether the engine may change the Volt now: connected, its settings read, allowed, in control. */
    isLive: () => boolean;
    /** Whether this computer's mix can go on the Volt now: live, and not held back. */
    canApplyMix: () => boolean;
    send: (reports: IReport[]) => Promise<void>;
    changed: (topics: readonly Topic[], channels?: Iterable<ChannelId>) => void;
    setCondition: (key: string, text: string | null, options?: Partial<Omit<ICondition, "key" | "text">>) => void;
    message: (text: string, kind?: MessageKind) => void;
}

interface ICoreListeners {
    onChange: (changes: IChanges) => void;
    onMessage: (text: string, kind: MessageKind) => void;
}

const sameCondition = (a: ICondition | undefined, b: ICondition): boolean =>
    a !== undefined && a.text === b.text && a.kind === b.kind && a.action?.command === b.action?.command;

interface ICoreParts {
    transport: ITransport;
    store: IEngineStore;
    options: IEngineOptions;
    view: IEngineView;
}

export const createCore = ({ transport, store, options, view }: ICoreParts, listen: ICoreListeners): ICore => {
    let pending: IChanges | null = null;
    const flushChanges = (): void => {
        const changes = pending;
        pending = null;
        if (changes) listen.onChange(changes);
    };
    const core: ICore = {
        state: defaultState(),
        flags: {
            serial: "",
            isHardwareKnown: false,
            isSendAllowed: false,
            hasControl: false,
            mixHold: null,
            lastEditAt: -Infinity,
        },
        view,
        sync: createMixerSync(),
        store,
        options,
        connection: null,
        status: { text: "Not connected", kind: "off" },
        conditions: new Map(),
        connectedSpec: () => core.connection?.spec ?? null,
        spec: () => core.connection?.spec ?? newestSpec(),
        isLive: () =>
            core.connection !== null && core.flags.isHardwareKnown && core.flags.isSendAllowed && core.flags.hasControl,
        canApplyMix: () => core.isLive() && core.flags.mixHold === null,
        send: (reports) => (reports.length > 0 && core.connection ? transport.send(reports) : Promise.resolve()),
        changed: (topics, channels = []) => {
            if (!pending) {
                pending = noChanges();
                queueMicrotask(flushChanges);
            }
            addChanges(pending, topics, channels);
        },
        setCondition: (key, text, extra = {}) => {
            const next = text
                ? { key, text, kind: extra.kind ?? "warning", ...(extra.action ? { action: extra.action } : {}) }
                : null;
            if (next ? sameCondition(core.conditions.get(key), next) : !core.conditions.has(key)) return;
            if (next) core.conditions.set(key, next);
            else core.conditions.delete(key);
            core.changed(["conditions"]);
        },
        message: (text, kind = "warning") => listen.onMessage(text, kind),
    };
    return core;
};
