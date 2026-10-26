import type { Intent } from "../lib/intents.ts";
import { nextTone, type StripIds } from "../lib/strip-groups.ts";
import { openChannelDialog } from "./channel-dialog.ts";
import { snap } from "./engine-client.ts";
import { togglePhantom } from "./phantom.ts";
import { runPageIntent } from "./run-intent.ts";
import { setSliderDisabled, setSliderValue } from "./slider.ts";
import { stripIds } from "./strips.ts";

/* What the strip and output controls ask for: the same intents as the tray and phones. */

const stripIntents: Record<string, (ids: StripIds) => Intent> = {
    mute: (ids) => ({ type: "mute", ids: [...ids] }),
    solo: (ids) => ({ type: "solo", ids: [...ids] }),
    link: (ids) => ({ type: "link", id: ids[0] }),
    tone: (ids) => ({ type: "tone", ids: [...ids], tone: nextTone(snap().state, ids) }),
};

const onStripAction = (button: HTMLElement): void => {
    const ids = stripIds(button);
    const action = button.dataset["stripAction"] ?? "";
    if (!ids) return;
    if (action === "settings") return openChannelDialog(ids);
    if (action === "phantom") return togglePhantom(ids);
    const intent = stripIntents[action]?.(ids);
    if (intent) runPageIntent(intent);
};

const onFader = (event: Event): void => {
    const { name, value } = (event as CustomEvent<{ name: string; value: number }>).detail;
    const ids = stripIds(event.target as Element);
    if (name === "fader" && ids) runPageIntent({ type: "fader", ids: [...ids], db: value });
};

const outputIntents: Record<string, Intent> = {
    "monitor-mute": { type: "monitorMute" },
    "monitor-mono": { type: "monitorMono" },
    "headphone-mute": { type: "headphoneMute" },
};

/** The outputs panel's buttons, for the page's one [data-action] click handler (controller.ts). */
export const outputActions: Record<string, () => void> = Object.fromEntries(
    Object.entries(outputIntents).map(([action, intent]) => [action, () => runPageIntent(intent)]),
);

const onOutputLevel = (event: Event): void => {
    const { name, value } = (event as CustomEvent<{ name: string; value: number }>).detail;
    if (name === "monitor-level") runPageIntent({ type: "monitorLevel", level: value });
    if (name === "headphone-level") runPageIntent({ type: "headphoneLevel", level: value });
};

/** Wires the strips and the outputs panel. */
export const wireMixerControls = (): void => {
    const strips = document.querySelector<HTMLElement>("[data-strips]")!;
    strips.addEventListener("slider-input", onFader);
    strips.addEventListener("click", (event) => {
        const button = (event.target as Element).closest<HTMLElement>("[data-strip-action]");
        if (button) onStripAction(button);
    });
    document.addEventListener("slider-input", onOutputLevel);
};

/** The outputs panel's buttons and sliders, found once. */
let outputParts: { buttons: Map<string, HTMLButtonElement>; sliders: Map<string, HTMLElement> } | null = null;

/** The elements `selectorFor` finds, by name; a name with none is left out. */
const byName = <T extends Element>(names: string[], selectorFor: (name: string) => string): Map<string, T> => {
    const found = new Map<string, T>();
    for (const name of names) {
        const element = document.querySelector<T>(selectorFor(name));
        if (element) found.set(name, element);
    }
    return found;
};

const outputs = (): NonNullable<typeof outputParts> => {
    outputParts ??= {
        buttons: byName(Object.keys(outputIntents), (name) => `[data-action="${name}"]`),
        sliders: byName(["monitor-level", "headphone-level"], (name) => `[data-slider="${name}"]`),
    };
    return outputParts;
};

const press = (button: Element | undefined, isOn: boolean): void => {
    if (button && button.getAttribute("aria-pressed") !== String(isOn))
        button.setAttribute("aria-pressed", String(isOn));
};

/** Refreshes the outputs panel. */
export const refreshOutputs = (isLive: boolean): void => {
    const { monitor, headphone } = snap().state;
    const { buttons, sliders } = outputs();
    press(buttons.get("monitor-mute"), monitor.isMuted);
    press(buttons.get("monitor-mono"), monitor.isMono);
    press(buttons.get("headphone-mute"), headphone.isMuted);
    const levels: Record<string, number> = { "monitor-level": monitor.level, "headphone-level": headphone.level };
    for (const [name, control] of sliders) {
        setSliderValue(control, levels[name] ?? 0);
        setSliderDisabled(control, !isLive);
    }
    for (const button of buttons.values()) button.disabled = !isLive;
};
