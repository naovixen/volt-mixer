import { defaultBrightness, dimmedBrightness, fadeLevels, isDimmed } from "../display-fade.ts";
import type { Intent, IntentResult } from "../intents.ts";
import type { ICore } from "./core.ts";

/*
 * The desktop app dims the Volt's display as its computer sleeps or shuts down, and whichever
 * Volt Mixer connects to the Volt next fades it back up (src/lib/display-fade.ts). Dimming is one
 * step: the system suspends the app within a few reports. Brightness goes through its intent, so
 * it's paced like the slider (writer.ts).
 */

const fadeSteps = 6;
const stepMs = 50;

export interface IFade {
    /** Remembers the brightness and dims straight away; false when there's nothing to dim. */
    dim: () => boolean;
    /** Once the Volt's state is known: fades back up if Volt Mixer dimmed it, or remembers it. */
    undim: () => void;
    /** Brightness the user set, to come back to: the app may dim the Volt with no word to the engine. */
    rememberBrightness: (raw: number) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const createFade = (core: ICore, runIntent: (intent: Intent) => IntentResult): IFade => {
    /** A new fade takes over from one still running (waking and sleeping again straight away). */
    let fadeId = 0;
    let fadeTarget: number | null = null;
    /** Where the display is heading: a running fade's end, or where it is. */
    const brightnessNow = (): number => fadeTarget ?? core.state.device.brightness;

    const fadeTo = async (target: number): Promise<void> => {
        const id = ++fadeId;
        fadeTarget = target;
        for (const raw of fadeLevels(core.state.device.brightness, target, fadeSteps)) {
            if (id !== fadeId) return;
            runIntent({ type: "brightness", raw });
            await sleep(stepMs);
        }
        if (id === fadeId) fadeTarget = null;
    };

    const rememberBrightness = (raw: number): void => {
        if (!isDimmed(raw)) core.store.saveBrightness(core.flags.serial, raw);
    };

    return {
        dim: () => {
            const raw = brightnessNow();
            if (!core.isLive() || raw <= dimmedBrightness) return false;
            core.store.saveBrightness(core.flags.serial, raw);
            fadeId++;
            fadeTarget = null;
            runIntent({ type: "brightness", raw: dimmedBrightness });
            return true;
        },
        undim: () => {
            const raw = brightnessNow();
            if (!isDimmed(raw)) return rememberBrightness(raw);
            if (core.isLive()) void fadeTo(core.store.loadBrightness(core.flags.serial) ?? defaultBrightness);
        },
        rememberBrightness,
    };
};
