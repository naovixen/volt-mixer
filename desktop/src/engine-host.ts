import { app } from "electron";
import path from "path";
import { allChanges, mergeChanges, noChanges, type IChanges } from "../../src/lib/engine/changes.ts";
import { createVoltEngine, type IVoltEngine } from "../../src/lib/engine/engine.ts";
import type { IPatch } from "../../src/lib/engine/mirror.ts";
import { isKnownIntent, isRemoteIntent, type IntentResult } from "../../src/lib/intents.ts";
import { site } from "../../src/lib/site.ts";
import { fakeBackend } from "./hid-backend-fake.ts";
import { nodeHidBackend } from "./hid-backend-node.ts";
import { createHidTransport, type IHidTransport } from "./hid-transport.ts";
import { publishToPhones, streamCount } from "./phone-streams.ts";
import { createFileStore, type IFileStore } from "./store-file.ts";

/*
 * The engine (src/lib/engine) runs here, in the app's main process, with the Volt through
 * node-hid and its memory in a file. Windows only show it: the main window gets the whole
 * snapshot and what changed, the tray window and phones what the tray shows. While no window is
 * open, nothing is drawn anywhere and the engine just keeps the Volt company.
 *
 * Views hear of changes at most every 33 ms: a drag changes the state at the pointer's rate.
 */

const publishMs = 33;

export interface IViews {
    /** The main window's page, if one is open and loaded. */
    sendToMain: (channel: string, ...args: unknown[]) => void;
    /** The tray window's page, if one is open. */
    sendToTray: (channel: string, ...args: unknown[]) => void;
    /** Whether the tray window is shown: hidden, it hears only what it asks for. */
    isTrayShown: boolean;
}

export interface IEngineHost {
    engine: IVoltEngine;
    /** Measured by the bench, against a pretend Volt: nothing may reach a real one. */
    isBench: boolean;
    transport: IHidTransport;
    store: IFileStore;
    /** A change from the main window's page, numbered so its patches can say which they include. */
    runPageIntent: (seq: number, intent: unknown) => void;
    /** A change from the tray window or a phone: levels and mutes only, and only while live. */
    runRemoteIntent: (intent: unknown) => IntentResult;
    /** Sends the main window everything now (it just loaded). */
    greetMain: () => void;
    /** Sends the tray window what it shows now (it was just shown). */
    greetTray: () => void;
    setMetersWanted: (isWanted: boolean) => void;
    stop: () => Promise<void>;
}

/** Only from source, and only when the bench asks: the app is measured against a pretend Volt. */
const isBench = (): boolean => !app.isPackaged && process.env["VOLT_FAKE_VOLT"] === "bench";

export const createEngineHost = (views: () => IViews): IEngineHost => {
    const store = createFileStore(path.join(app.getPath("userData"), "volt-mixer.json"));
    if (isBench()) console.log("bench:fake-volt");
    const transport = createHidTransport(isBench() ? fakeBackend : nodeHidBackend);
    const engine = createVoltEngine({
        transport,
        store: store.engineStore,
        options: { isWebsite: false, linkBase: site.websiteUrl },
        view: store.view(),
    });
    engine.setControl(true);

    let seq = 0;
    let pending: IChanges = noChanges();
    let timer: NodeJS.Timeout | undefined;
    let lastTray = "";

    const patch = (changes: IChanges): IPatch => ({
        seq,
        snapshot: engine.snapshot(),
        changes: { topics: [...changes.topics], channels: [...changes.channels] },
    });

    /** The tray window, while it's shown (or when it asks), and phones, while any are connected. */
    const publishTray = (isAsked = false): void => {
        const { sendToTray, isTrayShown } = views();
        if (isTrayShown || isAsked) {
            const snapshot = engine.traySnapshot(false);
            const text = JSON.stringify(snapshot);
            if (text !== lastTray) sendToTray("tray:snapshot", snapshot);
            lastTray = text;
        }
        if (streamCount() > 0) publishToPhones(engine.traySnapshot(true));
    };

    const publish = (): void => {
        timer = undefined;
        const changes = pending;
        pending = noChanges();
        views().sendToMain("engine:patch", patch(changes));
        publishTray();
    };

    const schedule = (changes: IChanges): void => {
        mergeChanges(pending, changes);
        timer ??= setTimeout(publish, publishMs);
    };

    engine.onChange(schedule);
    engine.onMessage((text, kind) => views().sendToMain("engine:message", text, kind));
    engine.onMeters((frame) => views().sendToMain("engine:meters", frame));
    transport.start({
        connected: engine.connected,
        disconnected: engine.disconnected,
        report: engine.report,
        error: (message) => views().sendToMain("engine:message", message, "error"),
    });

    return {
        engine,
        isBench: isBench(),
        transport,
        store,
        runPageIntent: (number, intent) => {
            seq = Math.max(seq, number);
            // The page is the app's own, but what it sends is still checked before it's applied.
            if (isKnownIntent(intent)) {
                try {
                    engine.runIntent(intent);
                } catch {
                    /* A malformed change is dropped; the page catches up with the next patch. */
                }
            }
            // Its own change answered, even one refused: the page then shows the engine's state again.
            schedule(noChanges());
        },
        runRemoteIntent: (intent) =>
            isRemoteIntent(intent) && engine.snapshot().isLive ? engine.runIntent(intent) : "ignored",
        greetMain: () => {
            mergeChanges(pending, allChanges());
            publish();
        },
        greetTray: () => {
            lastTray = "";
            engine.reread();
            publishTray(true);
        },
        setMetersWanted: engine.setMetersWanted,
        stop: async () => {
            engine.saveNow();
            store.flush();
            await transport.stop();
        },
    };
};
