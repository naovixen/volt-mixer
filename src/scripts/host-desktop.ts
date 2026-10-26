import type { IChanges } from "../lib/engine/changes.ts";
import type { MessageKind } from "../lib/engine/core.ts";
import type { IMeterFrame } from "../lib/engine/meters.ts";
import { createMirror, type IPatch } from "../lib/engine/mirror.ts";
import { notMixLink, type ILinkOutcome } from "../lib/engine/ownership.ts";
import type { IVoltDesktopEngine } from "./desktop.ts";
import { useEngine, type IEngineClient } from "./engine-client.ts";
import { legacyStore, clearLegacyStore } from "./store.ts";

/*
 * The desktop app: the engine runs in the app's main process (desktop/src/engine-host.ts) and this
 * page shows a copy of it (src/lib/engine/mirror.ts). The page's changes are applied to the copy
 * at once and sent to main; main's patches keep the copy up to date. Before the engine moved to main the page kept the
 * mix itself, so the first time, it hands main what its storage held.
 */

export const startDesktopEngine = (bridge: IVoltDesktopEngine): void => {
    const mirror = createMirror();
    const changeListeners = new Set<(changes: IChanges) => void>();
    const messageListeners = new Set<(text: string, kind: MessageKind) => void>();
    const meterListeners = new Set<(frame: IMeterFrame) => void>();
    const tell = (changes: IChanges): void => changeListeners.forEach((listen) => listen(changes));
    const command = (name: string, ...args: unknown[]): Promise<unknown> => bridge.command(name, ...args);

    bridge.onPatch((patch) => tell(mirror.applyPatch(patch as IPatch)));
    bridge.onMessage((text, kind) => messageListeners.forEach((listen) => listen(String(text), kind as MessageKind)));
    bridge.onMeters((frame) => meterListeners.forEach((listen) => listen(frame as IMeterFrame)));

    const client: IEngineClient = {
        snapshot: mirror.snapshot,
        onChange: (listen) => void changeListeners.add(listen),
        onMessage: (listen) => void messageListeners.add(listen),
        onMeters: (listen) => void meterListeners.add(listen),
        setMetersWanted: bridge.setMetersWanted,
        runIntent: (intent) => {
            const { result, seq, changes } = mirror.runIntent(intent);
            bridge.sendIntent(seq, intent);
            if (changes.topics.size > 0) tell(changes);
            return result;
        },
        runCondition: (name) => void command("runCondition", name),
        pushMix: () => void command("pushMix"),
        forgetMix: () => void command("forgetMix"),
        resetMix: () => void command("resetMix"),
        receiveMixLink: async (link) => ((await command("receiveMixLink", link)) as ILinkOutcome | null) ?? notMixLink,
        setView: (change) => void command("setView", change),
        identify: () => void command("identify"),
        startAutoGain: (mask, seconds) => {
            void command("startAutoGain", mask, seconds);
            return mask !== 0 && mirror.snapshot().isLive;
        },
        reread: () => void command("reread"),
        connect: () => void command("connect"),
        disconnect: () => void command("disconnect"),
    };
    useEngine(client);
    bridge.hello();
    // Said even with nothing to hand over: main may have opened this window only to ask.
    const legacy = legacyStore();
    void command("importLegacy", legacy ?? {}).then(() => legacy && clearLegacyStore());
};
