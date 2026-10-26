import type { RemoteIntent } from "../lib/intents.ts";
import { site } from "../lib/site.ts";
import { newestSpec } from "../lib/spec.ts";
import type { ITrayRow } from "../lib/tray-rows.ts";
import { trayApp } from "./desktop.ts";
import { setText } from "./dom.ts";
import { cloneIcon } from "./icons.ts";
import { loadTheme } from "./store.ts";
import { applyTheme } from "./theme.ts";
import type { ITraySnapshot, RemoteMessage } from "./remote.ts";
import { initSliders, setSliderDisabled, setSliderValue, useSliderSpec } from "./slider.ts";
import { openTrayLink, type LinkStatus } from "./tray-link.ts";

/*
 * The tray mixer (src/pages/tray), in the desktop app's tray window or on a phone. It never
 * touches the Volt: it draws the rows the main window sends and asks for changes as intents,
 * which the main window checks and applies.
 */

const link = openTrayLink();
/**
 * This window's name in hello and bye, kept for the window's life (a reload keeps it), so a tray
 * that reloads is still the one that will say bye. Not crypto.randomUUID: a phone's plain-HTTP
 * page lacks it.
 */
const trayId = ((): string => {
    const key = "volt-mixer.tray-id";
    const fresh = Math.random().toString(36).slice(2);
    try {
        const kept = sessionStorage.getItem(key) ?? fresh;
        sessionStorage.setItem(key, kept);
        return kept;
    } catch {
        return fresh;
    }
})();
const list = (): HTMLElement => document.querySelector<HTMLElement>("[data-tray-rows]")!;
const note = (): HTMLElement => document.querySelector<HTMLElement>("[data-tray-note]")!;
let rows: ITrayRow[] = [];
let layoutKey = "";
/** A value just moved here wins over a snapshot that may predate it. */
const recentInputs = new Map<string, number>();
const inputHoldMs = 400;

const post = (message: RemoteMessage): void => link.send(message);

let linkStatus: LinkStatus = "connected";
let lastSnapshot: ITraySnapshot | null = null;
/** No snapshot came for a while: the main window isn't open. */
let isUnanswered = false;

/** What the note under the rows says, from the link and the last snapshot: one thing at a time. */
const noteText = (): string => {
    if (linkStatus !== "connected") return phoneStatus[linkStatus];
    if (!lastSnapshot) return isUnanswered ? "Open Volt Mixer to connect to the Volt." : "";
    const isMixMissing = lastSnapshot.isLive && !lastSnapshot.isMixOwned;
    return isMixMissing ? "Set up your mix in the main window first: the faders work once this computer has it." : "";
};

const showNote = (): void => {
    const text = noteText();
    // Empty, it takes no space and says nothing; it stays in place, as a live region must.
    setText(note(), text);
};

const rowTemplate = (): Element =>
    document.querySelector<HTMLTemplateElement>("#tray-row-template")!.content.firstElementChild!;

/** The row's icon says what it is and is its mute button; its name is there for screen readers. */
const buildRow = (row: ITrayRow): HTMLElement => {
    const item = rowTemplate().cloneNode(true) as HTMLElement;
    item.dataset["key"] = row.key;
    const icon = cloneIcon(row.icon);
    if (icon) item.querySelector("[data-row-icon]")!.replaceChildren(icon);
    const mute = item.querySelector<HTMLElement>("[data-row-action='mute']")!;
    mute.setAttribute("aria-label", `Mute ${row.name}`);
    // The icon says what it is; hovering says which channel.
    setText(item.querySelector("[data-row-tip]")!, row.name);
    const slider = item.querySelector<HTMLElement>("[data-slider]")!;
    slider.dataset["kind"] = row.kind === "channel" ? "fader" : "level";
    slider.setAttribute("aria-label", `${row.name} level`);
    return item;
};

const updateRow = (item: HTMLElement, row: ITrayRow, snapshot: ITraySnapshot): void => {
    item.dataset["tone"] = row.tone;
    const slider = item.querySelector<HTMLElement>("[data-slider]")!;
    const movedAt = recentInputs.get(item.dataset["key"] ?? "");
    if (movedAt === undefined || performance.now() - movedAt > inputHoldMs) setSliderValue(slider, row.level);
    const isFaderLocked = row.kind === "channel" && !snapshot.isMixOwned;
    setSliderDisabled(slider, !snapshot.isLive || isFaderLocked);
    const mute = item.querySelector<HTMLButtonElement>("[data-row-action='mute']")!;
    if (mute.getAttribute("aria-pressed") !== String(row.isMuted))
        mute.setAttribute("aria-pressed", String(row.isMuted));
    mute.disabled = !snapshot.isLive;
};

/** On a phone, a link that takes this computer's mix with it: to the website (which keeps it), and nowhere else. */
const showKeepLink = (mixLink: string | null): void => {
    const keep = document.querySelector<HTMLAnchorElement>("[data-tray-keep]")!;
    const isWebsite = mixLink !== null && mixLink.startsWith(site.websiteUrl);
    keep.hidden = !link.isPhone || !isWebsite;
    if (isWebsite && keep.href !== mixLink) keep.href = mixLink;
};

/** The faders' range is the connected Volt's, as the main window says. */
const useFaderRange = (maxDb: number): void => {
    if (lastSnapshot?.maxDb !== maxDb) useSliderSpec({ ...newestSpec(), faderMaxDb: maxDb });
};

const render = (snapshot: ITraySnapshot): void => {
    const status = document.querySelector<HTMLElement>("[data-tray-status]")!;
    // Just the connection: "Connected · firmware 1.0.3" is more than the tray needs.
    setText(status, snapshot.status.split(" · ")[0] ?? "");
    status.dataset["status"] = snapshot.statusKind;
    useFaderRange(snapshot.maxDb);
    const key = snapshot.rows.map((row) => `${row.key}:${row.icon}:${row.name}`).join("|");
    if (key !== layoutKey) {
        list().replaceChildren(...snapshot.rows.map(buildRow));
        initSliders(list());
        layoutKey = key;
    }
    rows = snapshot.rows;
    showKeepLink(snapshot.mixLink);
    const items = list().querySelectorAll<HTMLElement>("[data-tray-row]");
    snapshot.rows.forEach((row, i) => items[i] && updateRow(items[i], row, snapshot));
    lastSnapshot = snapshot;
    showNote();
};

const rowOf = (element: Element): ITrayRow | undefined => {
    const item = element.closest<HTMLElement>("[data-tray-row]");
    return rows[[...list().children].indexOf(item as HTMLElement)];
};

const levelIntent = (row: ITrayRow, value: number): RemoteIntent =>
    row.kind === "channel"
        ? { type: "fader", ids: row.ids, db: value }
        : { type: row.kind === "monitor" ? "monitorLevel" : "headphoneLevel", level: value };

/** The state it should end up in, not a flip, so a repeated message can't undo it. */
const muteIntent = (row: ITrayRow): RemoteIntent =>
    row.kind === "channel"
        ? { type: "mute", ids: row.ids, to: !row.isMuted }
        : { type: `${row.kind}Mute`, to: !row.isMuted };

const onSlider = (event: Event): void => {
    const row = rowOf(event.target as Element);
    if (!row) return;
    recentInputs.set(row.key, performance.now());
    post({ kind: "intent", intent: levelIntent(row, (event as CustomEvent<{ value: number }>).detail.value) });
};

const onClick = (event: Event): void => {
    const button = (event.target as Element).closest("[data-row-action]");
    const row = button && rowOf(button);
    if (row) post({ kind: "intent", intent: muteIntent(row) });
};

/** Escape hides the name tip under the pointer or focus; leaving the icon brings it back. */
const dismissTips = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    list()
        .querySelectorAll<HTMLElement>(".mute:is(:hover, :focus-visible)")
        .forEach((mute) => (mute.dataset["tipDismissed"] = ""));
};

const restoreTip = (event: PointerEvent | FocusEvent): void => {
    const mute = (event.target as Element).closest(".mute");
    if (mute && !mute.contains(event.relatedTarget as Node | null)) mute.removeAttribute("data-tip-dismissed");
};

const onMessage = (message: Partial<RemoteMessage> | null): void => {
    if (message?.kind === "snapshot" && message.snapshot) render(message.snapshot);
};

/**
 * The window's height for its content: the app sizes the tray to fit, up to the screen. The rows'
 * value bubbles live in the body's top padding, so that's counted too.
 */
const neededHeight = (): number => {
    const part = (selector: string): number => document.querySelector<HTMLElement>(selector)?.offsetHeight ?? 0;
    const body = getComputedStyle(document.querySelector(".body")!);
    const padding = parseFloat(body.paddingBlockStart) + parseFloat(body.paddingBlockEnd);
    return part(".head") + part("[data-tray-content]") + padding + part(".foot");
};

const fitWindow = (): void => trayApp()?.fitTray(Math.ceil(neededHeight()));

const phoneStatus: Record<LinkStatus, string> = {
    connected: "",
    lost: "Can't reach Volt Mixer on your computer. Is it running, with Phone remote on?",
    unpaired:
        "This phone isn't paired any more: scan the QR code in Volt Mixer › Settings › Desktop app › Phone remote.",
};

/** In a browser there's no app: Open is a plain link to the page, and there's nothing to close. */
const wireButtons = (): void => {
    const desktop = trayApp();
    const close = document.querySelector<HTMLButtonElement>("[data-tray-close]")!;
    close.hidden = !desktop;
    // On a phone the computer's page can't be opened, so the footer goes.
    document.querySelector<HTMLElement>(".foot")!.hidden = link.isPhone;
    close.addEventListener("click", () => desktop?.hideTray());
    // Escape puts the flyout away, like the click elsewhere that does.
    document.addEventListener("keydown", (event) => event.key === "Escape" && desktop?.hideTray());
    document.querySelector("[data-tray-open]")!.addEventListener("click", (event) => {
        if (!desktop) return;
        event.preventDefault();
        desktop.openMainWindow();
    });
};

export const startTray = (): void => {
    list().addEventListener("slider-input", onSlider);
    list().addEventListener("click", onClick);
    document.addEventListener("keydown", dismissTips);
    list().addEventListener("pointerout", restoreTip);
    list().addEventListener("focusout", restoreTip);
    link.listen(onMessage, (status) => ((linkStatus = status), showNote()));
    window.addEventListener("pagehide", () => post({ kind: "bye", id: trayId }));
    // Back from the back/forward cache, the page says hello again, as when it first opened.
    window.addEventListener("pageshow", (event) => event.persisted && post({ kind: "hello", id: trayId }));
    wireButtons();
    new ResizeObserver(fitWindow).observe(document.querySelector("[data-tray-content]")!);
    // The theme is chosen in the main window's Settings; follow it live.
    window.addEventListener("storage", (event) => event.key === "volt-mixer.theme" && applyTheme(loadTheme()));
    // Hello now, so the window is sized while still hidden, then updates only while it's shown.
    post({ kind: "hello", id: trayId });
    trayApp()?.onTrayVisible((isVisible) => post({ kind: isVisible ? "hello" : "bye", id: trayId }));
    window.setTimeout(() => {
        isUnanswered = true;
        showNote();
    }, 1500);
};
