import type { IChanges, Topic } from "../lib/engine/changes.ts";
import type { IEngineSnapshot, IVoltEngine } from "../lib/engine/engine.ts";
import { stripGroups } from "../lib/strip-groups.ts";
import { outputActions, refreshOutputs, wireMixerControls } from "./actions.ts";
import { carryMixLink, startCarryPanel } from "./carry-mix.ts";
import { followLayout, refreshChannelDialog, wireChannelDialog } from "./channel-dialog.ts";
import { connectionActions, renderConnection } from "./connection-view.ts";
import { initDialogs } from "./dialogs.ts";
import { reportVoltLive, wireDisplayFade } from "./display-fade.ts";
import { viewSpec } from "./engine-client.ts";
import { driveVolt, startEngine } from "./host-web.ts";
import { findMeters, resetMeters, showMeterLevels } from "./meters-view.ts";
import { readMixFromAddress, receiveMixLink, takeLinksFromOtherTabs, type LinkReceiver } from "./mix-address.ts";
import { wireMixPasteForms } from "./mix-link-form.ts";
import { notice, showConditions } from "./notices.ts";
import { isPageShown, onPageVisibility, wirePageVisibility } from "./page-visibility.ts";
import { publish, wireRemote } from "./remote.ts";
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

let engine: IVoltEngine | null = null;

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
    if (!engine) return;
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

const pageActions = (current: IVoltEngine): Record<string, () => void> => ({
    ...connectionActions,
    ...outputActions,
    ...settingsActions,
    identify: current.identify,
    "mix-defaults": () => confirmThen("Set every channel to 0 dB, like a new UAD Console session?", current.resetMix),
    "push-mix": () => confirmThen("Apply this computer's mix to the Volt?", current.pushMix),
    "forget-mix": () =>
        confirmThen("Forget this computer's mix? The Volt keeps playing what it has.", current.forgetMix),
});

/** Mix links, from the address (also when it changes) or a paste box, go to `receive`. */
const wireLinkIntake = (receive: LinkReceiver): void => {
    wireMixPasteForms(receive);
    window.addEventListener("hashchange", () => readMixFromAddress(receive));
};

/** Shown again: the views catch up, and the meters start from empty rather than old peaks. */
const onVisibility = (current: IVoltEngine, isShown: boolean): void => {
    current.setMetersWanted(isShown);
    if (!isShown) return;
    resetMeters();
    requestRender();
};

/** What the engine says goes to the views, the tray and phones, and the desktop app. */
const follow = (current: IVoltEngine): void => {
    current.onChange((changes) => {
        requestRender(changes);
        publish();
        reportVoltLive(current.snapshot().isLive);
    });
    current.onMessage((text, kind) => notice(text, { kind }));
    current.onMeters(showMeterLevels);
    current.setMetersWanted(isPageShown());
    onPageVisibility((isShown) => onVisibility(current, isShown));
    whenRefused(() => requestRender());
};

/** The views every mode has; they show the state, read-only until a Volt can be changed. */
const wireViews = (current: IVoltEngine): void => {
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
    readMixFromAddress(carryMixLink);
};

/** The tray window and phones (desktop app only) send intents; only a page that can drive the Volt applies them. */
const answerOthers = (current: IVoltEngine): void =>
    wireRemote({
        isActive: () => current.snapshot().hasControl,
        snapshot: current.traySnapshot,
        run: (intent) => (current.snapshot().isLive ? current.runIntent(intent) : "ignored"),
        onViewOpened: current.reread,
    });

/** A browser with WebHID drives the Volt, once this tab has control. */
const startDriving = (current: IVoltEngine): void => {
    wireLinkIntake(receiveMixLink);
    takeLinksFromOtherTabs();
    answerOthers(current);
    wireDisplayFade();
    // A link the page opened with is applied, kept, or sent to the tab in use: known once the lock is.
    driveVolt(current, () => readMixFromAddress(receiveMixLink));
};

export const start = (): void => {
    engine = startEngine();
    wireViews(engine);
    if (volt.isWebHidSupported()) startDriving(engine);
    else startCarrying();
};
