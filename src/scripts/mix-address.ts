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

/** Takes a mix link in; the controller picks one for the page's mode. */
export type LinkReceiver = (link: string) => ILinkOutcome;

/** Applied now if this tab can put it on the Volt, otherwise kept (engine/ownership.ts). */
export const receiveMixLink: LinkReceiver = (link) => getEngine().receiveMixLink(link, location.href);

/**
 * A link opened in another tab, while this one drives the Volt: that tab keeps it for when the
 * Volt connects, and this one, already connected, takes it now.
 */
export const takeLinksFromOtherTabs = (): void =>
    window.addEventListener("storage", (event) => {
        const { isLive, mixHold } = getEngine().snapshot();
        if (isPendingMixChange(event) && isLive && mixHold === null) getEngine().takeSavedMix();
    });

/** A mix link the page was opened with (or navigated to), handed to `receive` and taken out of the address. */
export const readMixFromAddress = (receive: LinkReceiver): void => {
    if (!isMixHash(location.hash)) return;
    const { kind, text } = receive(location.href);
    notice(text, { kind });
    history.replaceState(null, "", location.pathname + location.search);
};
