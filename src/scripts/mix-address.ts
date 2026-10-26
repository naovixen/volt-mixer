import type { IVoltEngine } from "../lib/engine/engine.ts";
import type { ILinkOutcome } from "../lib/engine/ownership.ts";
import { isMixHash } from "../lib/mix-links.ts";
import { getEngine } from "./engine-client.ts";
import { notice } from "./notices.ts";
import { isPendingMixChange } from "./store.ts";

/*
 * Mix links reaching this page: in its address, pasted, or opened in another tab. What becomes of
 * one depends on the page's mode, so each mode has its receiver: the engine's (applied now, or
 * kept for when it can be), or carry-mix.ts's on a device that can't reach a Volt.
 */

/** Takes a mix link in; the controller picks one for the page's mode. The app's engine answers a moment later. */
export type LinkReceiver = (link: string) => ILinkOutcome | Promise<ILinkOutcome>;

/** Applied now if the engine can put it on the Volt, otherwise kept (engine/ownership.ts). */
export const receiveMixLink: LinkReceiver = (link) => getEngine().receiveMixLink(link);

/**
 * A link opened in another tab, while this one drives the Volt: that tab keeps it for when the
 * Volt connects, and this one, already connected, takes it now.
 */
export const takeLinksFromOtherTabs = (engine: IVoltEngine): void =>
    window.addEventListener("storage", (event) => {
        const { isLive, mixHold } = engine.snapshot();
        if (isPendingMixChange(event) && isLive && mixHold === null) engine.takeSavedMix();
    });

/** A mix link the page was opened with (or navigated to), handed to `receive` and taken out of the address. */
export const readMixFromAddress = async (receive: LinkReceiver): Promise<void> => {
    if (!isMixHash(location.hash)) return;
    const href = location.href;
    history.replaceState(null, "", location.pathname + location.search);
    const { kind, text } = await receive(href);
    notice(text, { kind });
};
