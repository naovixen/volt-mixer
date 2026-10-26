import type { IChanges, Topic } from "../lib/engine/changes.ts";
import type { IEngineSnapshot, IVoltEngine } from "../lib/engine/engine.ts";
import { stripGroups } from "../lib/strip-groups.ts";
import { outputActions, refreshOutputs, wireMixerControls } from "./actions.ts";
import { carryMixLink, startCarryPanel } from "./carry-mix.ts";
import { followLayout, refreshChannelDialog, wireChannelDialog } from "./channel-dialog.ts";
import { connectionActions, renderConnection } from "./connection-view.ts";
import { initDialogs } from "./dialogs.ts";
import { desktopApp } from "./desktop.ts";
import { getEngine, viewSpec, type IEngineClient } from "./engine-client.ts";
import { startDesktopEngine } from "./host-desktop.ts";
import { driveVolt, startWebEngine } from "./host-web.ts";
import { findMeters, resetMeters, showMeterLevels } from "./meters-view.ts";
import { readMixFromAddress, receiveMixLink, takeLinksFromOtherTabs, type LinkReceiver } from "./mix-address.ts";
import { wireMixPasteForms } from "./mix-link-form.ts";
import { notice, showConditions } from "./notices.ts";
import { isPageShown, onPageVisibility, wirePageVisibility } from "./page-visibility.ts";
import { requestRender, setRenderer } from "./render-loop.ts";
import { whenRefused } from "./run-intent.ts";
import { refreshSettings, settingsActions, wireSettingsDialog } from "./settings-dialog.ts";
import { initSliders } from "./slider.ts";
import { clearRetiredSettings, loadTheme } from "./store.ts";
import { refreshStrips, renderStrips } from "./strips.ts";
import { applyTheme } from "./theme.ts";
import * as volt from "./transport-webhid.ts";

/*
 * The mixer page: picks its mode (drive a Volt over WebHID, or carry a mix to a computer that can),
 * starts what that mode needs, and draws what the engine says changed.
 */

const element = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;

/**
 * A control that just became disabled loses focus. It goes to the open dialog's Close button, or
 * to Connect, or to the start of the page.
 */
const keepFocus = (focused: Element | null): void => {
    if (focused === document.body || document.activeElement !== document.body) return;
    const connect = element<HTMLButtonElement>("[data-action='connect']");
    const fallback = connect.hidden || connect.disabled ? element("#main") : connect;
    (document.querySelector<HTMLElement>("dialog[open] .head button") ?? fallback).focus();
};

/** The meters the connected Volt (or the newest recorded one) reports. */
const meterNames = (snapshot: IEngineSnapshot): Set<string> =>
    new Set(Object.keys(viewSpec(snapshot).reports.meters.offsets));

/** The strips, rebuilt when the layout changed; their values, for the channels that changed. */
const renderMixer = (snapshot: IEngineSnapshot, changes: IChanges): void => {
    const { topics } = changes;
    if (!topics.has("layout") && changes.channels.size === 0 && !topics.has("inputs") && !topics.has("status")) return;
    const groups = stripGroups(snapshot.state, snapshot.view);
    if (topics.has("layout")) {
        renderStrips(groups, meterNames(snapshot));
        findMeters();
        followLayout();
    }
    const names = new Map(groups.map((group) => [group.ids.join(","), group.name]));
    refreshStrips(snapshot.state, names, snapshot.isLive, changes);
};

/** Whether any of `topics` changed. */
const isAny = (changes: IChanges, ...topics: Topic[]): boolean => topics.some((topic) => changes.topics.has(topic));

/** The mix setup panel and Apply mix: whether this computer has a mix, and can put it on the Volt. */
const renderMixOwnership = (snapshot: IEngineSnapshot): void => {
    const isMixMissing = snapshot.isHardwareKnown && !snapshot.state.isMixOwned && snapshot.mixHold === null;
    element("[data-mix-setup]").hidden = !(snapshot.connection && isMixMissing);
    element<HTMLButtonElement>("[data-action='push-mix']").disabled = !snapshot.isLive || !snapshot.state.isMixOwned;
};

/** Draws only what changed (a frame's worth of changes, render-loop.ts). */
const render = (changes: IChanges): void => {
    const engine = getEngine();
    const snapshot = engine.snapshot();
    const focused = document.activeElement;
    renderMixer(snapshot, changes);
    if (isAny(changes, "status")) renderConnection(snapshot);
    if (isAny(changes, "conditions")) showConditions(snapshot.conditions, engine.runCondition);
    if (isAny(changes, "outputs", "status")) refreshOutputs(snapshot.isLive);
    if (isAny(changes, "channels", "inputs", "status", "layout", "view")) refreshChannelDialog(snapshot.isLive);
    if (isAny(changes, "device", "routing", "status", "view", "channels")) refreshSettings(snapshot.isLive);
    if (isAny(changes, "status", "layout")) renderMixOwnership(snapshot);
    keepFocus(focused);
};

const confirmThen = (question: string, run: () => void): void => {
    if (window.confirm(question)) run();
};

const pageActions = (current: IEngineClient): Record<string, () => void> => ({
    ...connectionActions,
    ...outputActions,
    ...settingsActions,
    identify: () => current.identify(),
    "mix-defaults": () => confirmThen("Set every channel to 0 dB, like a new UAD Console session?", current.resetMix),
    "push-mix": () => confirmThen("Apply this computer's mix to the Volt?", current.pushMix),
    "forget-mix": () =>
        confirmThen("Forget this computer's mix? The Volt keeps playing what it has.", current.forgetMix),
});

/** Mix links, from the address (also when it changes) or a paste box, go to `receive`. */
const wireLinkIntake = (receive: LinkReceiver): void => {
    wireMixPasteForms(receive);
    window.addEventListener("hashchange", () => void readMixFromAddress(receive));
};

/** Shown again: the views catch up, and the meters start from empty rather than old peaks. */
const onVisibility = (current: IEngineClient, isShown: boolean): void => {
    current.setMetersWanted(isShown);
    if (!isShown) return;
    resetMeters();
    requestRender();
};

/** What the engine says changed is drawn; its messages go to the notice bar. */
const follow = (current: IEngineClient): void => {
    current.onChange(requestRender);
    current.onMessage((text, kind) => notice(text, { kind }));
    current.onMeters(showMeterLevels);
    current.setMetersWanted(isPageShown());
    onPageVisibility((isShown) => onVisibility(current, isShown));
    whenRefused(() => requestRender());
};

/** The views every mode has; they show the state, read-only until a Volt can be changed. */
const wireViews = (current: IEngineClient): void => {
    setRenderer(render);
    wirePageVisibility();
    follow(current);
    clearRetiredSettings();
    applyTheme(loadTheme());
    initSliders(document);
    initDialogs();
    // A meter's length is measured once; a new window size measures it again.
    window.addEventListener("resize", findMeters);
    wireMixerControls();
    wireChannelDialog();
    wireSettingsDialog();
    const actions = pageActions(current);
    document.addEventListener("click", (event) => {
        const action = (event.target as Element).closest<HTMLElement>("[data-action]")?.dataset["action"] ?? "";
        actions[action]?.();
    });
    requestRender();
};

/** A browser without WebHID (a phone, Firefox, Safari): it says why, and carries mix links. */
const startCarrying = (): void => {
    element<HTMLButtonElement>("[data-action='connect']").disabled = true;
    startCarryPanel();
    wireLinkIntake(carryMixLink);
    void readMixFromAddress(carryMixLink);
};

/** The website with WebHID: this page runs the engine and drives the Volt, once this tab has control. */
const startDriving = (engine: IVoltEngine): void => {
    wireLinkIntake(receiveMixLink);
    takeLinksFromOtherTabs(engine);
    // A link the page opened with is applied, kept, or sent to the tab in use: known once the lock is.
    driveVolt(engine, () => void readMixFromAddress(receiveMixLink));
};

export const start = (): void => {
    const desktop = desktopApp();
    if (desktop) {
        // The desktop app: the engine runs in its main process, and this page shows it.
        startDesktopEngine(desktop.engine);
        wireViews(getEngine());
        wireLinkIntake(receiveMixLink);
        return;
    }
    const engine = startWebEngine();
    wireViews(getEngine());
    if (volt.isWebHidSupported()) startDriving(engine);
    else startCarrying();
};
