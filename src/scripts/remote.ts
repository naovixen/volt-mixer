import type { ITraySnapshot } from "../lib/engine/engine.ts";
import { isRemoteIntent, type Intent, type IntentResult } from "../lib/intents.ts";
import { desktopApp } from "./desktop.ts";

export type { ITraySnapshot };

/*
 * The main window drives the Volt and answers the tray mixer wherever it's shown: the desktop
 * app's tray window over a BroadcastChannel (same origin, no relay), and phones through the app's
 * phone server (desktop/src/phone.ts, via the preload). They draw what they're sent and ask for
 * changes as intents. Nothing is sent until a tray says hello or a phone connects.
 */

/** A tray window names itself in hello and bye, so one closing doesn't silence another. */
export type RemoteMessage =
    | { kind: "hello"; id: string }
    | { kind: "bye"; id: string }
    | { kind: "intent"; intent: unknown }
    | { kind: "snapshot"; snapshot: ITraySnapshot }
    | { kind: "result"; result: IntentResult };

export const openChannel = (): BroadcastChannel | null =>
    typeof BroadcastChannel === "function" ? new BroadcastChannel("volt-mixer") : null;

interface IResponder {
    /** Only the tab that drives the Volt answers; a read-only second tab stays quiet. */
    isActive: () => boolean;
    /** What a view shows now; the mix link only for a phone, which can carry it. */
    snapshot: (isForPhone: boolean) => ITraySnapshot;
    run: (intent: Intent) => IntentResult;
    /** A tray window opened or a phone connected: what it's about to show should be fresh. */
    onViewOpened: () => void;
}

let channel: BroadcastChannel | null = null;
let responder: IResponder | null = null;
const openTrays = new Set<string>();
let phoneCount = 0;
/** What each kind of view was last sent, so an unchanged snapshot isn't sent again. */
const lastSent = { tray: "", phone: "" };

const post = (message: RemoteMessage): void => channel?.postMessage(message);
const isActive = (): boolean => responder !== null && responder.isActive();

/** Sends the tray and any phones what they show now, if it changed; called after every refresh. */
export const publish = (): void => {
    if (!isActive()) return;
    const send = (target: keyof typeof lastSent, deliver: (snapshot: ITraySnapshot) => void): void => {
        const snapshot = responder!.snapshot(target === "phone");
        const text = JSON.stringify(snapshot);
        if (text === lastSent[target]) return;
        lastSent[target] = text;
        deliver(snapshot);
    };
    if (openTrays.size > 0) send("tray", (snapshot) => post({ kind: "snapshot", snapshot }));
    if (phoneCount > 0) send("phone", (snapshot) => desktopApp()?.publishToPhones(snapshot));
};

/** Another window and a phone may only ask for the remote intents (levels and mutes). */
const run = (intent: unknown): IntentResult =>
    isActive() && isRemoteIntent(intent) ? responder!.run(intent) : "ignored";

/** A view that just opened gets everything, changed or not. */
const onOpened = (target: keyof typeof lastSent): void => {
    lastSent[target] = "";
    responder?.onViewOpened();
    publish();
};

const onMessage = ({ data }: MessageEvent): void => {
    const message = data as Partial<RemoteMessage> | null;
    const id = message && "id" in message && typeof message.id === "string" ? message.id : "";
    if (message?.kind === "hello") return (openTrays.add(id), onOpened("tray"));
    if (message?.kind === "bye") return void openTrays.delete(id);
    if (message?.kind === "intent") post({ kind: "result", result: run(message.intent) });
};

/**
 * Makes this page answer tray windows and phones. Only in the desktop app, whose origin is its
 * own: on the website, any page of the same origin could post to the channel.
 */
export const wireRemote = (answer: IResponder): void => {
    const desktop = desktopApp();
    if (!desktop) return;
    responder = answer;
    channel = openChannel();
    channel?.addEventListener("message", onMessage);
    desktop.onPhoneIntent(run);
    desktop.onPhoneCount((count) => {
        const isNew = count > phoneCount;
        phoneCount = count;
        if (isNew) onOpened("phone");
        else publish();
    });
};
