import { applyIntent, type Intent, type IntentResult } from "../intents.ts";
import { encodeMixCode } from "../mix-code.ts";
import { channelById, channelIds, defaultState, type ChannelId, type IMixerState } from "../mixer.ts";
import { toSavedMix } from "../saved-mix.ts";
import type { ISpec } from "../spec.ts";
import { stripGroups } from "../strip-groups.ts";
import { trayRows, type ITrayRow } from "../tray-rows.ts";
import { intentChanges, type IChanges } from "./changes.ts";
import {
    createCore,
    type ConditionCommand,
    type ICondition,
    type ICore,
    type IEngineView,
    type MessageKind,
    type MixHold,
    type StatusKind,
} from "./core.ts";
import { createFade } from "./fade.ts";
import { createMeters, type IMeterFrame } from "./meters.ts";
import { createOwnership, type ILinkOutcome } from "./ownership.ts";
import type { IConnectionInfo, IEngineOptions, IEngineStore, ITransport } from "./ports.ts";
import { createSession } from "./session.ts";
import { createWriter } from "./writer.ts";

/*
 * The engine: everything between the Volt and the views. It holds the state, applies every change
 * (an intent, from any view), sends what changed, follows the Volt, and keeps this computer's mix.
 * Views read its snapshot and are told what changed; they never write state themselves. The same
 * engine runs in the page on the website and in the desktop app's main process.
 */

const meterIntervalMs = 33;

/** Everything a view shows. In the page it's live; across processes it's a copy. */
export interface IEngineSnapshot {
    state: IMixerState;
    view: IEngineView;
    /** The connected Volt; null while none is. */
    connection: IConnectionInfo | null;
    status: { text: string; kind: StatusKind };
    isLive: boolean;
    isHardwareKnown: boolean;
    isSendAllowed: boolean;
    hasControl: boolean;
    mixHold: MixHold;
    /** Why a mix change can't be made now; null when it can. */
    heldText: string | null;
    conditions: ICondition[];
}

/** What a tray window or a phone shows: the rows the viewer chose, and whether it can change anything. */
export interface ITraySnapshot {
    rows: ITrayRow[];
    maxDb: number;
    isLive: boolean;
    isMixOwned: boolean;
    status: string;
    /** "on", "off" or "away", as the main window's status is coloured. */
    statusKind: string;
    /** The mix as a link to the website, while this computer has one: a phone can keep it to carry. */
    mixLink: string | null;
}

export interface IVoltEngine {
    snapshot: () => IEngineSnapshot;
    onChange: (listen: (changes: IChanges) => void) => void;
    onMessage: (listen: (text: string, kind: MessageKind) => void) => void;
    onMeters: (listen: (frame: IMeterFrame) => void) => void;
    /** Whether anyone is watching the meters; while not, meter reports are dropped unread. */
    setMetersWanted: (isWanted: boolean) => void;
    /** Applies a change from any view, sends it and saves it. */
    runIntent: (intent: Intent) => IntentResult;
    /** From the transport: a Volt identified itself, went away, or sent a report. */
    connected: (info: IConnectionInfo, spec: ISpec) => void;
    disconnected: (isByUser: boolean) => void;
    report: (reportId: number, data: Uint8Array) => void;
    /** Whether this program drives the Volt (the website: whether this tab holds the lock). */
    setControl: (hasControl: boolean) => void;
    /** Catches up with the Volt now (a page shown again, a view opened). */
    reread: () => void;
    runCondition: (command: ConditionCommand) => void;
    pushMix: () => void;
    forgetMix: () => void;
    /** Every channel at 0 dB, like a new UAD Console session. */
    resetMix: () => void;
    takeSavedMix: () => void;
    receiveMixLink: (link: string, base: string) => ILinkOutcome;
    setView: (change: Partial<IEngineView>) => void;
    dim: () => boolean;
    undim: () => void;
    startAutoGain: (mask: number, seconds: number) => boolean;
    identify: () => void;
    /** Saves the mix now (leaving the page, quitting). */
    saveNow: () => void;
    traySnapshot: (isForPhone: boolean) => ITraySnapshot;
}

export interface IEngineParts {
    transport: ITransport;
    store: IEngineStore;
    options: IEngineOptions;
    view: IEngineView;
}

/** A solo on a strip that isn't shown silences the rest of the monitor mix with no button in sight. */
const hiddenSolos = (core: ICore): ChannelId[] => {
    const shown = new Set(stripGroups(core.state, core.view).flatMap((group) => group.ids));
    return channelIds.filter((id) => core.state.channels[id].isSoloed && !shown.has(id));
};

const showHiddenSolos = (core: ICore): void => {
    const hidden = hiddenSolos(core);
    const names = hidden.map((id) => core.state.names[id] ?? channelById[id].name).join(", ");
    const text =
        hidden.length > 0
            ? `Solo is on for ${names}, which isn't shown, so the rest of the monitor mix is silent.`
            : null;
    core.setCondition("hidden-solo", text, {
        kind: "info",
        action: { label: "Clear the solo", command: "clear-hidden-solo" },
    });
};

const mixLinkOf = (core: ICore): string => {
    const url = new URL(core.options.linkBase);
    url.hash = `m=${encodeMixCode(toSavedMix(core.state))}`;
    return url.href;
};

export const createVoltEngine = (parts: IEngineParts): IVoltEngine => {
    const changeListeners = new Set<(changes: IChanges) => void>();
    const messageListeners = new Set<(text: string, kind: MessageKind) => void>();
    const meterListeners = new Set<(frame: IMeterFrame) => void>();
    const core = createCore(parts, {
        onChange: (changes) => {
            const { topics } = changes;
            if (topics.has("channels") || topics.has("layout") || topics.has("view")) showHiddenSolos(core);
            changeListeners.forEach((listen) => listen(changes));
        },
        onMessage: (text, kind) => messageListeners.forEach((listen) => listen(text, kind)),
    });
    const meters = createMeters(meterIntervalMs, (frame) => meterListeners.forEach((listen) => listen(frame)));
    let runIntent: (intent: Intent) => IntentResult = () => "ignored";
    const fade = createFade(core, (intent) => runIntent(intent));
    const writer = createWriter(core, fade.rememberBrightness);
    const ownership = createOwnership(core, writer);
    const session = createSession(core, { writer, ownership, fade, meters });

    runIntent = (intent) => {
        const result = applyIntent(core.state, intent, core.spec());
        if (result !== "ok") return result;
        const changes = intentChanges(intent, core.state);
        core.flags.lastEditAt = performance.now();
        if (changes.topics.has("layout") || intent.type === "solo") writer.markAll();
        writer.commit(changes);
        core.changed([...changes.topics], changes.channels);
        return result;
    };

    const setControl = (hasControl: boolean): void => {
        core.flags.hasControl = hasControl;
        if (!hasControl) {
            const text =
                "Volt Mixer is open in another tab or window. Use that one; this one takes over when it closes.";
            core.setCondition("other-tab", text, { kind: "info" });
            return core.changed(["status"]);
        }
        core.setCondition("other-tab", null);
        ownership.restartMixPause(core.connection !== null);
        if (core.connection && core.flags.isHardwareKnown) ownership.takeMixWhenFree();
        core.changed(["status"]);
    };

    /** "Use anyway" on an unchecked firmware: the engine may change the Volt from now on. */
    const allowSending = (): void => {
        core.flags.isSendAllowed = true;
        core.setCondition("firmware", null);
        if (core.store.loadPendingMix() !== null) ownership.takeMixWhenFree();
        else ownership.pushMix();
        writer.markAll();
        core.changed(["status"]);
    };

    const commands: Record<ConditionCommand, () => void> = {
        "allow-sending": allowSending,
        "clear-hidden-solo": () => void runIntent({ type: "solo", ids: hiddenSolos(core), to: false }),
    };

    return {
        snapshot: () => ({
            state: core.state,
            view: core.view,
            connection: core.connection?.info ?? null,
            status: core.status,
            isLive: core.isLive(),
            isHardwareKnown: core.flags.isHardwareKnown,
            isSendAllowed: core.flags.isSendAllowed,
            hasControl: core.flags.hasControl,
            mixHold: core.flags.mixHold,
            heldText: ownership.heldText(),
            conditions: [...core.conditions.values()],
        }),
        onChange: (listen) => void changeListeners.add(listen),
        onMessage: (listen) => void messageListeners.add(listen),
        onMeters: (listen) => void meterListeners.add(listen),
        setMetersWanted: (isWanted) => meters.setWanted(isWanted),
        runIntent: (intent) => runIntent(intent),
        connected: session.connected,
        disconnected: session.disconnected,
        report: session.report,
        setControl,
        reread: session.reread,
        runCondition: (command) => commands[command](),
        pushMix: ownership.pushMix,
        forgetMix: ownership.forgetMix,
        resetMix: () => ownership.takeOwnership(toSavedMix(defaultState())),
        takeSavedMix: ownership.takeSavedMix,
        receiveMixLink: ownership.receiveMixLink,
        setView: (change) => {
            Object.assign(core.view, change);
            // Only the optional strips change which strips there are; the tray's rows don't.
            const isStripChange = "isDigitalShown" in change || "isLoopbackShown" in change;
            core.changed(isStripChange ? ["view", "layout"] : ["view"]);
        },
        dim: fade.dim,
        undim: fade.undim,
        startAutoGain: session.startAutoGain,
        identify: session.identify,
        saveNow: writer.saveMixNow,
        traySnapshot: (isForPhone) => ({
            rows: trayRows(core.state, core.view, core.view.trayHidden),
            maxDb: core.spec().faderMaxDb,
            isLive: core.isLive(),
            isMixOwned: core.state.isMixOwned,
            status: core.status.text,
            statusKind: core.status.kind,
            mixLink: isForPhone && core.state.isMixOwned ? mixLinkOf(core) : null,
        }),
    };
};
