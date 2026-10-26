import { applyIntent, type Intent, type IntentResult } from "../intents.ts";
import { channelIds, defaultState, type ChannelId } from "../mixer.ts";
import { specFor, newestSpec } from "../spec.ts";
import { intentChanges, mergeChanges, noChanges, type IChanges, type Topic } from "./changes.ts";
import type { IEngineSnapshot } from "./engine.ts";

/*
 * The desktop app's main window shows an engine that runs in another process (desktop/src/
 * engine-host.ts), as a copy kept up to date by patches. A change made on the page is applied to
 * the copy at once, so a fader follows the hand, and sent with a rising number. A patch that
 * doesn't include the page's latest change yet (its number is lower) would put the fader back
 * where it was, so its state is set aside, and what it said changed is redrawn once a patch that
 * does include it arrives. If the engine refused the change, that patch puts the fader back.
 */

/** What main sends: the snapshot, what changed, and the number of the page's last change it applied. */
export interface IPatch {
    seq: number;
    snapshot: IEngineSnapshot;
    changes: { topics: string[]; channels: string[] };
}

export interface IMirror {
    snapshot: () => IEngineSnapshot;
    /** Takes a patch from main; returns what to draw. */
    applyPatch: (patch: IPatch) => IChanges;
    /** Applies the page's own change to the copy; returns its result, the number to send it with, and what to draw. */
    runIntent: (intent: Intent) => { result: IntentResult; seq: number; changes: IChanges };
}

const topicNames = new Set<string>([
    "layout",
    "channels",
    "outputs",
    "inputs",
    "device",
    "routing",
    "status",
    "conditions",
    "view",
]);

const changesOf = ({ topics, channels }: IPatch["changes"]): IChanges => ({
    topics: new Set(topics.filter((topic): topic is Topic => topicNames.has(topic))),
    channels: new Set(channels.filter((id): id is ChannelId => (channelIds as readonly string[]).includes(id))),
});

/** What the page shows until main's first patch: no Volt, no mix. */
const blankSnapshot = (): IEngineSnapshot => ({
    state: defaultState(),
    view: { isDigitalShown: false, isLoopbackShown: true, trayHidden: [] },
    connection: null,
    status: { text: "Not connected", kind: "off" },
    isLive: false,
    isHardwareKnown: false,
    isSendAllowed: false,
    hasControl: true,
    mixHold: null,
    heldText: null,
    conditions: [],
});

export const createMirror = (): IMirror => {
    let current = blankSnapshot();
    let sentSeq = 0;
    /** What stale patches and the page's own changes touched, to draw again once main has caught up. */
    let owed = noChanges();

    return {
        snapshot: () => current,
        applyPatch: (patch) => {
            const changes = changesOf(patch.changes);
            const isStale = patch.seq < sentSeq;
            current = isStale ? { ...patch.snapshot, state: current.state } : patch.snapshot;
            if (isStale) {
                mergeChanges(owed, changes);
                return changes;
            }
            mergeChanges(changes, owed);
            owed = noChanges();
            return changes;
        },
        runIntent: (intent) => {
            const spec = current.connection ? specFor(current.connection.specVersion).spec : newestSpec();
            const result = applyIntent(current.state, intent, spec);
            const changes = intentChanges(intent, current.state);
            mergeChanges(owed, changes);
            sentSeq += 1;
            return { result, seq: sentSeq, changes: result === "ok" ? changes : noChanges() };
        },
    };
};
