import { iconOf } from "../lib/channel-icons.ts";
import type { IChanges } from "../lib/engine/changes.ts";
import { channelById, isChannelId, isLinked } from "../lib/mixer.ts";
import type { ChannelId, IMixerState } from "../lib/mixer.ts";
import { toneOf, type IStripGroup, type StripIds } from "../lib/strip-groups.ts";
import { setText } from "./dom.ts";
import { cloneIcon } from "./icons.ts";
import { initSliders, setSliderDisabled, setSliderValue } from "./slider.ts";

/*
 * Channel strips: cloned from #strip-template (StripTemplate.astro) when the layout changes, and
 * refreshed in place otherwise (a rename too), so a drag or focus is never interrupted by a
 * rebuild. Each strip's parts are found once, when it's built; a refresh touches only the strips
 * whose channels changed.
 */

interface IStripParts {
    strip: HTMLElement;
    ids: StripIds;
    fader: HTMLElement;
    buttons: HTMLButtonElement[];
    action: (name: string) => HTMLButtonElement | null;
    icon: HTMLElement;
}

let parts: IStripParts[] = [];

const stripsList = (): HTMLElement => document.querySelector<HTMLElement>("[data-strips]")!;
const template = (): HTMLTemplateElement => document.querySelector<HTMLTemplateElement>("#strip-template")!;

/** The channels a strip controls (from an element inside it), or null outside a strip. */
export const stripIds = (element: Element): StripIds | null => {
    const ids = (element.closest<HTMLElement>("[data-strip]")?.dataset["ids"] ?? "").split(",").filter(isChannelId);
    return ids.length === 1 || ids.length === 2 ? (ids as StripIds) : null;
};

const focusKey = (element: Element | null): string | null => {
    const strip = element?.closest<HTMLElement>("[data-strip]");
    const part = element?.getAttribute("data-strip-action") ?? (element?.hasAttribute("data-slider") ? "fader" : null);
    return strip && part ? `${strip.dataset["ids"]}:${part}` : null;
};

const restoreFocus = (key: string | null): void => {
    if (!key) return;
    const [ids, part] = key.split(":");
    const strip = parts.find((member) => member.strip.dataset["ids"] === ids);
    const target = part === "fader" ? strip?.fader : strip?.action(part ?? "");
    target?.focus();
};

const label = (element: Element | null, text: string): void => {
    if (element && element.getAttribute("aria-label") !== text) element.setAttribute("aria-label", text);
};

const isAnalog = (id: ChannelId): boolean => channelById[id].kind === "analog";
const hasPreamp = (ids: readonly ChannelId[]): boolean => ids.some((id) => channelById[id].preampIndex !== undefined);

/** The tone button says the tone and the channel: "Warmth tone, Vocal". */
const labelTone = (strip: IStripParts): void => {
    const tone = strip.strip.querySelector("[data-strip-tone]")?.textContent ?? "";
    label(strip.action("tone"), `${tone} tone, ${strip.strip.dataset["name"] ?? ""}`);
};

/** The strip's name and every label that says it; only when it changes (a rename). */
const nameStrip = (strip: IStripParts, name: string): void => {
    const { strip: element } = strip;
    if (element.dataset["name"] === name) return;
    element.dataset["name"] = name;
    setText(element.querySelector("[data-strip-name]"), name);
    setText(element.querySelector("[data-strip-settings-label]"), `${name} settings`);
    label(strip.fader, `${name} level`);
    label(strip.action("mute"), `Mute ${name}`);
    label(strip.action("solo"), `Solo ${name}`);
    label(strip.action("phantom"), `48V phantom power, ${name}`);
    labelTone(strip);
};

const partsOf = (strip: HTMLElement, ids: StripIds): IStripParts => {
    const actions = new Map(
        [...strip.querySelectorAll<HTMLButtonElement>("[data-strip-action]")].map((button) => [
            button.dataset["stripAction"] ?? "",
            button,
        ]),
    );
    return {
        strip,
        ids,
        fader: strip.querySelector<HTMLElement>("[data-slider]")!,
        buttons: [...actions.entries()].filter(([name]) => name !== "settings").map(([, button]) => button),
        action: (name) => actions.get(name) ?? null,
        icon: strip.querySelector<HTMLElement>("[data-strip-icon]")!,
    };
};

const buildStrip = (group: IStripGroup, meterNames: Set<string>): IStripParts => {
    const strip = (template().content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
    strip.dataset["ids"] = group.ids.join(",");
    const built = partsOf(strip, group.ids);
    nameStrip(built, group.name);
    // Analog inputs show their TONE and their 48V.
    strip.querySelector<HTMLElement>("[data-strip-tags]")!.hidden = !isAnalog(group.ids[0]);
    const meters = [...strip.querySelectorAll<HTMLElement>("[data-meter]")];
    group.ids.forEach((id: ChannelId, i) => meters[i] && meterNames.has(id) && (meters[i].dataset["meter"] = id));
    const link = built.action("link")!;
    link.hidden = !group.linkPair;
    if (group.linkLabel) link.setAttribute("aria-label", group.linkLabel);
    return built;
};

/** Rebuilds the strips for a new layout, keeping keyboard focus on the same control. */
export const renderStrips = (groups: IStripGroup[], meterNames: Set<string>): void => {
    const key = focusKey(document.activeElement);
    const list = stripsList();
    parts = groups.map((group) => buildStrip(group, meterNames));
    list.replaceChildren(...parts.map(({ strip }) => strip));
    initSliders(list);
    restoreFocus(key);
};

const press = (button: Element | null, isPressed: boolean): void => {
    if (button && button.getAttribute("aria-pressed") !== String(isPressed))
        button.setAttribute("aria-pressed", String(isPressed));
};

/** The channel's icon, swapped only when it changes. */
const refreshIcon = (strip: IStripParts, state: IMixerState): void => {
    const name = iconOf(state.icons, strip.ids[0]);
    if (strip.icon.dataset["icon"] === name) return;
    strip.icon.dataset["icon"] = name;
    strip.icon.replaceChildren(...[cloneIcon(name)].filter((icon) => icon !== null));
};

/** The tone button and the fader's colour, from the TONE the Volt lights for these channels. */
const refreshTone = (strip: IStripParts, state: IMixerState): void => {
    const tone = toneOf(state, strip.ids);
    if (strip.strip.dataset["tone"] === tone) return;
    strip.strip.dataset["tone"] = tone;
    setText(strip.strip.querySelector("[data-strip-tone]"), tone.charAt(0).toUpperCase() + tone.slice(1));
    labelTone(strip);
};

/** 48V and the tone: what the Volt lights for these channels. */
const refreshIndicators = (strip: IStripParts, state: IMixerState): void => {
    const preamps = strip.ids.map((id) => channelById[id].preampIndex);
    press(
        strip.action("phantom"),
        preamps.some((index) => index !== undefined && state.preamp.phantom[index]),
    );
    refreshTone(strip, state);
};

const refreshValues = (strip: IStripParts, state: IMixerState, name: string): void => {
    const channel = state.channels[strip.ids[0]];
    nameStrip(strip, name);
    setSliderValue(strip.fader, channel.fader);
    press(strip.action("mute"), channel.isMuted);
    press(strip.action("solo"), channel.isSoloed);
    press(strip.action("link"), isLinked(state, strip.ids[0]));
    refreshIcon(strip, state);
};

/** Read-only until the Volt can be changed. A fader works before this computer has the mix: the change is refused with a word why. */
const refreshLive = (strip: IStripParts, isLive: boolean): void => {
    setSliderDisabled(strip.fader, !isLive);
    for (const button of strip.buttons) button.disabled = !isLive;
    // Line inputs have no 48V.
    if (!hasPreamp(strip.ids)) strip.action("phantom")!.disabled = true;
};

/** Brings the strips up to date with what changed; `names` are the strips' names, by their channels. */
export const refreshStrips = (
    state: IMixerState,
    names: Map<string, string>,
    isLive: boolean,
    changes: IChanges,
): void => {
    const { topics } = changes;
    for (const strip of parts) {
        const isTouched = topics.has("layout") || strip.ids.some((id) => changes.channels.has(id));
        if (isTouched) refreshValues(strip, state, names.get(strip.ids.join(",")) ?? strip.strip.dataset["name"] ?? "");
        if (isTouched || topics.has("inputs")) refreshIndicators(strip, state);
        if (topics.has("layout") || topics.has("status")) refreshLive(strip, isLive);
    }
};
