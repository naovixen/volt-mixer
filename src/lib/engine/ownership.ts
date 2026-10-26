import { parseMixLink } from "../mix-links.ts";
import { createOtherProgram } from "../other-program.ts";
import { adoptSavedMix } from "../saved-mix.ts";
import { allChanges } from "./changes.ts";
import type { ICore, MessageKind, MixHold } from "./core.ts";
import type { IWriter } from "./writer.ts";

/*
 * This computer's mix: the Volt can't report fader and pan positions, so the engine keeps its own
 * copy (per Volt, in the store) and applies it on connecting, like UAD Console. A mix link replaces
 * it.
 *
 * Another Volt Mixer on this computer (the desktop app, or the website in another browser) drives
 * the same Volt with its own mix. Two mixes would fight, and this one's faders would show levels
 * the Volt isn't playing. So the website leaves the mix to the other one while it's open, and on
 * connecting listens before it applies its own. The desktop app always keeps its mix.
 */

const listenMs = 3500;
const pausedText =
    "Volt Mixer is also open in the desktop app or another browser, so this page leaves the mix to that one " +
    "until it closes. Levels, 48V and gain still work here.";
const appText = "Volt Mixer is also open in a browser on this computer. The browser leaves the mix to the app.";

/** What became of a mix link, to show where it was given (a paste box, or the notice bar). */
export interface ILinkOutcome {
    kind: MessageKind;
    text: string;
}

export const notMixLink: ILinkOutcome = { kind: "error", text: "That isn't a Volt Mixer mix link." };

export interface IOwnership {
    /** Gives up the mix (disconnecting, pausing, a new connection), saving the latest changes first. */
    releaseMix: () => void;
    /** Applies the whole mix to the Volt, like Console does when it starts. */
    pushMix: () => void;
    /** Makes a mix this computer's own and puts it on the Volt, or keeps it while the mix is held. */
    takeOwnership: (savedMix: unknown) => void;
    /** A link kept before the Volt connected, or the saved mix, applied. Only by the program in control. */
    takeSavedMix: () => void;
    forgetMix: () => void;
    receiveMixLink: (link: string, base: string) => ILinkOutcome;
    heldText: () => string | null;
    /** Holds the mix back (giving it up if this one had it) or takes it once it's free. */
    checkOtherProgram: () => void;
    /** A state reading this engine didn't ask for. */
    noteOtherReading: () => void;
    takeMixWhenFree: () => void;
    /** On connecting, disconnecting or taking control: the website listens before taking the mix. */
    restartMixPause: (isConnected: boolean) => void;
}

const layoutAll = (core: ICore): void => {
    const { topics, channels } = allChanges();
    core.changed([...topics], channels);
};

export const createOwnership = (core: ICore, writer: IWriter): IOwnership => {
    const others = createOtherProgram();
    let listenUntil = 0;
    let listenTimer: ReturnType<typeof setTimeout> | undefined;
    /** The mix waits to be taken (again) once nothing else is open. */
    let isMixWaiting = false;

    const pushMix = (): void => {
        const spec = core.connectedSpec();
        if (!spec || !core.canApplyMix()) return;
        void core.send(core.sync.diff(core.state, spec, { isFull: true, kind: "mix" }));
        writer.markAll();
    };

    const releaseMix = (): void => {
        writer.saveMixNow();
        core.state.isMixOwned = false;
    };

    const takeOwnership = (savedMix: unknown): void => {
        if (core.flags.mixHold) return void core.store.savePendingMix(savedMix);
        adoptSavedMix(core.state, savedMix, core.spec().faderMaxDb);
        writer.markMixChanged();
        writer.saveMixNow();
        pushMix();
        layoutAll(core);
    };

    const takeSavedMix = (): void => {
        if (!core.flags.hasControl) return layoutAll(core);
        const pendingMix = core.store.loadPendingMix();
        const savedMix = pendingMix ?? core.store.loadMix(core.flags.serial);
        core.store.savePendingMix(null);
        if (pendingMix) core.message("Mix applied from the link.", "success");
        if (savedMix) takeOwnership(savedMix);
        else layoutAll(core);
    };

    const holdNow = (now: number, isOtherOpen: boolean): MixHold => {
        if (!core.flags.hasControl || !core.options.isWebsite) return null;
        if (isOtherOpen) return "other";
        return now < listenUntil ? "listening" : null;
    };

    /** The mix comes back once nothing holds it, saying so if another Volt Mixer had it. */
    const resume = (now: number): void => {
        isMixWaiting = false;
        if (now >= listenUntil + 1000)
            core.message("The other Volt Mixer closed, so this page's mix is back on the Volt.", "info");
        takeSavedMix();
    };

    const checkOtherProgram = (): void => {
        const now = performance.now();
        const isOtherOpen = core.flags.hasControl && others.isOpen(now);
        const text = core.options.isWebsite ? pausedText : appText;
        core.setCondition("other-program", isOtherOpen ? text : null, { kind: "info" });
        const hold = holdNow(now, isOtherOpen);
        if (hold === core.flags.mixHold) return;
        core.flags.mixHold = hold;
        if (hold && core.state.isMixOwned) isMixWaiting = true;
        if (hold) releaseMix();
        // A link kept while the mix was held back waits too.
        if (hold || !(isMixWaiting || core.store.loadPendingMix() !== null)) return layoutAll(core);
        resume(now);
    };

    return {
        releaseMix,
        pushMix,
        takeOwnership,
        takeSavedMix,
        forgetMix: () => {
            core.store.saveMix(core.flags.serial, null);
            core.state.isMixOwned = false;
            layoutAll(core);
        },
        receiveMixLink: (link, base) => {
            const mix = parseMixLink(link, base);
            if (!mix) return notMixLink;
            if (core.canApplyMix()) {
                takeOwnership(mix);
                return { kind: "success", text: "Mix applied from the link." };
            }
            core.store.savePendingMix(mix);
            return { kind: "info", text: pendingWhen(core) };
        },
        heldText: () => heldText(core.flags.mixHold),
        checkOtherProgram,
        noteOtherReading: () => {
            if (!core.flags.hasControl) return;
            others.note(performance.now());
            checkOtherProgram();
        },
        takeMixWhenFree: () => {
            if (core.flags.mixHold) isMixWaiting = true;
            else takeSavedMix();
        },
        restartMixPause: (isConnected) => {
            others.forget();
            isMixWaiting = false;
            clearTimeout(listenTimer);
            listenUntil = isConnected && core.options.isWebsite ? performance.now() + listenMs : 0;
            if (listenUntil) listenTimer = setTimeout(checkOtherProgram, listenMs + 50);
            checkOtherProgram();
        },
    };
};

/** Why a mix change can't be made now, while the mix is held back; null when it isn't. */
const heldText = (hold: MixHold): string | null => {
    if (hold === "other") return pausedText;
    if (hold === "listening") return "Your mix goes on the Volt in a moment, once nothing else is using it.";
    return null;
};

/** Where a kept link goes next. */
const pendingWhen = (core: ICore): string => {
    if (!core.flags.hasControl) return "Mix sent to the Volt Mixer tab that's in use.";
    if (core.flags.mixHold === "other") return "Mix received. It will be applied when the other Volt Mixer closes.";
    return core.connection
        ? "Mix received. It will be applied in a moment."
        : "Mix received. It will be applied when the Volt connects.";
};
