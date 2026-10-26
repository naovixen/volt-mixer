import type { Intent } from "../lib/intents.ts";
import { nextTone, type StripIds } from "../lib/strip-groups.ts";
import { openChannelDialog } from "./channel-dialog.ts";
import { snap } from "./engine-client.ts";
import { togglePhantom } from "./phantom.ts";
import { runPageIntent } from "./run-intent.ts";
import { setSliderValue } from "./slider.ts";
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

/** Refreshes the outputs panel. */
export const refreshOutputs = (isLive: boolean): void => {
    const { monitor, headphone } = snap().state;
    const pressed = (action: string, isOn: boolean): void =>
        document.querySelector(`[data-action="${action}"]`)?.setAttribute("aria-pressed", String(isOn));
    pressed("monitor-mute", monitor.isMuted);
    pressed("monitor-mono", monitor.isMono);
    pressed("headphone-mute", headphone.isMuted);
    for (const [name, value] of [
        ["monitor-level", monitor.level],
        ["headphone-level", headphone.level],
    ] as const) {
        const control = document.querySelector<HTMLElement>(`[data-slider="${name}"]`);
        if (!control) continue;
        setSliderValue(control, value);
        control.setAttribute("aria-disabled", String(!isLive));
    }
    for (const action of Object.keys(outputIntents)) {
        const button = document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
        if (button) button.disabled = !isLive;
    }
};
