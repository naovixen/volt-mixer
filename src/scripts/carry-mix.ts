import { notMixLink } from "../lib/engine/ownership.ts";
import { parseMixLink } from "../lib/mix-links.ts";
import { flashButton } from "./button-feedback.ts";
import { showMessage } from "./messages.ts";
import type { LinkReceiver } from "./mix-address.ts";
import { drawQr } from "./qr.ts";
import { loadCarriedLink, saveCarriedLink } from "./store.ts";

/*
 * A browser that can't reach a Volt (CarryMix.astro): a mix link given here, by the address or a
 * paste box, is kept, and shown as a QR code and a link to take to the computer with the Volt;
 * with none, the panel says what a phone can do. Nothing leaves the device unless the user shares it.
 */

const panel = (): HTMLElement => document.querySelector<HTMLElement>("[data-carry]")!;
const part = <T extends HTMLElement>(selector: string): T => panel().querySelector<T>(selector)!;
const message = (): HTMLElement | null => document.querySelector<HTMLElement>("[data-message='carry']");

/** The link kept here, if it's still a mix link. */
const carriedLink = (): string | null => {
    const link = loadCarriedLink();
    return link && parseMixLink(link) !== null ? link : null;
};

/** Shows the carried mix, or (with none, or once it's forgotten) what a phone can do. */
const showCarried = (): void => {
    const link = carriedLink();
    panel().hidden = false;
    part("[data-carry-mix]").hidden = !link;
    part("[data-carry-none]").hidden = Boolean(link);
    if (link) drawQr("carry", link);
};

/** Keeps a mix link to carry, and shows it. */
export const carryMixLink: LinkReceiver = (link) => {
    if (parseMixLink(link, location.href) === null) return notMixLink;
    saveCarriedLink(new URL(link.trim(), location.href).href);
    showCarried();
    return { kind: "success", text: "Mix kept on this device, below: take it to the computer with your Volt." };
};

const copy = async (button: HTMLElement): Promise<void> => {
    try {
        await navigator.clipboard.writeText(carriedLink() ?? "");
        flashButton(button, "success");
        showMessage(message(), "success", "Link copied.", { isQuiet: true });
    } catch {
        flashButton(button, "error");
        showMessage(message(), "error", "Couldn't copy it. Use Send the link instead.");
    }
};

/** The buttons act on whatever link is kept when they're pressed, so they're wired once. */
const wireButtons = (): void => {
    const share = part<HTMLButtonElement>("[data-carry-share]");
    // Only where the device can hand the link to another app (a phone's share sheet).
    share.hidden = typeof navigator.share !== "function";
    share.addEventListener("click", () => {
        const url = carriedLink();
        if (url) void navigator.share({ title: "Volt Mixer mix", url }).catch(() => {});
    });
    const copyButton = part<HTMLButtonElement>("[data-carry-copy]");
    copyButton.addEventListener("click", () => void copy(copyButton));
    part("[data-carry-forget]").addEventListener("click", () => (saveCarriedLink(null), showCarried()));
};

/** Shows the panel, with the carried mix if there is one. */
export const startCarryPanel = (): void => {
    wireButtons();
    showCarried();
};
