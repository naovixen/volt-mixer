import { isRouteKnown } from "../lib/commands.ts";
import type { Intent } from "../lib/intents.ts";
import { cueNames, type CueName } from "../lib/mixer.ts";
import { getEngine, snap, viewSpec } from "./engine-client.ts";
import { requestRender } from "./render-loop.ts";
import { runPageIntent } from "./run-intent.ts";
import { setSliderValue } from "./slider.ts";
import { saveTheme, saveView } from "./store.ts";
import { applyTheme, currentTheme, isTheme } from "./theme.ts";
import { refreshMixLink, wireMixLink } from "./mix-link.ts";
import { wireDesktopSettings } from "./desktop-settings.ts";

/* The Settings dialog (SettingsDialog.astro): device options, cue routing, view and the mix. */

const dialog = (): HTMLDialogElement => document.querySelector<HTMLDialogElement>("#settings-dialog")!;
const inputs = (setting: string): NodeListOf<HTMLInputElement | HTMLSelectElement> =>
    dialog().querySelectorAll(`[data-setting="${setting}"]`);

const check = (setting: string, value: string | boolean): void => {
    for (const input of inputs(setting)) {
        if (input instanceof HTMLSelectElement) input.value = String(value);
        else input.checked = value === true;
    }
};

const mirroredCue = (): string => cueNames.find((cue) => snap().state.cues[cue].isMirroredToLine34) ?? "none";

/** "Own mix" can only be chosen once that cue's route is captured (src/data/volt4-gen2.json). */
const markUncapturedRoutes = (): void => {
    for (const cue of cueNames) {
        const own = dialog().querySelector<HTMLOptionElement>(`[data-setting="${cue}-source"] option[value="own"]`);
        if (own) own.disabled = !isRouteKnown(viewSpec(), `${cue}Mix`);
    }
};

/** Settings that only change what this page shows, so they work without a Volt. */
const viewSettings: Record<string, "isDigitalShown" | "isLoopbackShown"> = {
    "show-digital": "isDigitalShown",
    "show-loopback": "isLoopbackShown",
};

/** Updates the dialog's values from state; device settings need the Volt, the view doesn't. */
export const refreshSettings = (isLive: boolean): void => {
    const { device, cues: cueRouting, headphoneSource, isMixOwned } = snap().state;
    check("clip", device.isClipProtected);
    check("digital", device.digitalFormat);
    check("headphone-source", headphoneSource);
    for (const cue of cueNames) check(`${cue}-source`, cueRouting[cue].isMix ? "mix" : "own");
    check("mirror", mirroredCue());
    check("show-digital", snap().view.isDigitalShown);
    check("show-loopback", snap().view.isLoopbackShown);
    check("theme", currentTheme());
    refreshMixLink();
    markUncapturedRoutes();
    const brightness = dialog().querySelector<HTMLElement>("[data-slider='brightness']")!;
    setSliderValue(brightness, device.brightness);
    brightness.setAttribute("aria-disabled", String(!isLive));
    for (const input of dialog().querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-setting]")) {
        const setting = input.dataset["setting"] ?? "";
        const isRouting = /source|mirror/.test(setting);
        const isPageSetting = setting in viewSettings || setting === "theme";
        input.disabled = !isPageSetting && (!isLive || (isRouting && !isMixOwned));
    }
};

const cueOf = (value: string): CueName => (value === "cue2" ? "cue2" : "cue1");

/** What each Volt setting in the dialog asks for, from its control. */
const settingIntents: Record<string, (input: HTMLInputElement | HTMLSelectElement) => Intent> = {
    clip: (input) => ({ type: "clipProtection", to: (input as HTMLInputElement).checked }),
    digital: (input) => ({ type: "digitalFormat", format: input.value === "spdif" ? "spdif" : "adat" }),
    "headphone-source": (input) => ({ type: "headphoneSource", cue: cueOf(input.value) }),
    "cue1-source": (input) => ({ type: "cueSource", cue: "cue1", isMix: input.value === "mix" }),
    "cue2-source": (input) => ({ type: "cueSource", cue: "cue2", isMix: input.value === "mix" }),
    mirror: (input) => ({ type: "mirror", cue: input.value === "none" ? null : cueOf(input.value) }),
};

const changeView = (view: "isDigitalShown" | "isLoopbackShown", isShown: boolean): void => {
    const { isDigitalShown, isLoopbackShown } = snap().view;
    const next = { isDigitalShown, isLoopbackShown };
    next[view] = isShown;
    saveView(next);
    getEngine().setView(next);
};

const onChange = (input: HTMLInputElement | HTMLSelectElement): void => {
    const setting = input.dataset["setting"] ?? "";
    if (setting === "theme" && isTheme(input.value)) return (applyTheme(input.value), saveTheme(input.value));
    const view = viewSettings[setting];
    if (view) return changeView(view, (input as HTMLInputElement).checked);
    const intent = settingIntents[setting]?.(input);
    if (intent) runPageIntent(intent);
};

export const settingsActions: Record<string, () => void> = {
    "open-settings": () => (dialog().showModal(), requestRender()),
};

export const wireSettingsDialog = (): void => {
    wireMixLink();
    void wireDesktopSettings();
    dialog().addEventListener("change", (event) => {
        const input = (event.target as Element).closest<HTMLInputElement | HTMLSelectElement>("[data-setting]");
        if (input) onChange(input);
    });
    dialog().addEventListener("slider-input", (event) => {
        const { name, value } = (event as CustomEvent<{ name: string; value: number }>).detail;
        if (name === "brightness") runPageIntent({ type: "brightness", raw: value });
    });
};
