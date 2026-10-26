import type { IChanges } from "../lib/engine/changes.ts";
import type { ConditionCommand, IEngineView, MessageKind } from "../lib/engine/core.ts";
import type { IEngineSnapshot } from "../lib/engine/engine.ts";
import type { IMeterFrame } from "../lib/engine/meters.ts";
import type { ILinkOutcome } from "../lib/engine/ownership.ts";
import type { Intent, IntentResult } from "../lib/intents.ts";
import { specFor, newestSpec, type ISpec } from "../lib/spec.ts";

/*
 * The engine as the views see it. On the website it runs in this page (host-web.ts); in the
 * desktop app it runs in the app's main process and this page shows a copy (host-desktop.ts). The
 * views only ever read its snapshot and ask it for changes, so where it runs is the host's business.
 */

export interface IEngineClient {
    snapshot: () => IEngineSnapshot;
    onChange: (listen: (changes: IChanges) => void) => void;
    onMessage: (listen: (text: string, kind: MessageKind) => void) => void;
    onMeters: (listen: (frame: IMeterFrame) => void) => void;
    setMetersWanted: (isWanted: boolean) => void;
    runIntent: (intent: Intent) => IntentResult;
    runCondition: (command: ConditionCommand) => void;
    pushMix: () => void;
    forgetMix: () => void;
    resetMix: () => void;
    receiveMixLink: (link: string) => ILinkOutcome | Promise<ILinkOutcome>;
    setView: (change: Partial<IEngineView>) => void;
    identify: () => void;
    startAutoGain: (mask: number, seconds: number) => boolean;
    /** Catches up with the Volt now (the page was in the background). */
    reread: () => void;
    /** Connect Volt and Disconnect. */
    connect: () => void;
    disconnect: () => void;
}

let client: IEngineClient | null = null;

export const useEngine = (next: IEngineClient): void => {
    client = next;
};

export const getEngine = (): IEngineClient => {
    if (!client) throw new Error("The engine isn't running yet.");
    return client;
};

/** What the views show now. */
export const snap = (): IEngineSnapshot => getEngine().snapshot();

/** The connected Volt's protocol data, or the newest recorded one while none is. */
export const viewSpec = (snapshot: IEngineSnapshot = snap()): ISpec =>
    snapshot.connection ? specFor(snapshot.connection.specVersion).spec : newestSpec();
