import { encodeMixCode } from "../lib/mix-code.ts";
import { toSavedMix, type ISavedMix } from "../lib/saved-mix.ts";
import { site } from "../lib/site.ts";
import { desktopApp } from "./desktop.ts";
import { snap } from "./engine-client.ts";
import { drawQr } from "./qr.ts";
import { flashButton, setInvalid } from "./button-feedback.ts";
import { showMessage } from "./messages.ts";

/* Settings › Your mix › Mix link: the link in a box that copies itself, and its QR code below. */

/** The mix as a link to the website. In the desktop app the page is app://volt/, which opens nowhere else. */
export const mixLink = (mix: ISavedMix = toSavedMix(snap().state)): string => {
    const url = desktopApp() ? new URL(site.websiteUrl) : new URL(import.meta.env.BASE_URL, location.origin);
    url.hash = `m=${encodeMixCode(mix)}`;
    return url.href;
};

const box = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>("[data-mix-link]");
const code = (): HTMLDetailsElement | null => document.querySelector<HTMLDetailsElement>("[data-mix-qr]");

/** The mix the box shows, so a refresh that changed nothing in it doesn't encode it again. */
let shownMix = "";

/** Keeps the link and its QR code current while Settings is open. */
export const refreshMixLink = (): void => {
    const input = box();
    if (!input?.closest("dialog")?.open) return;
    const mix = toSavedMix(snap().state);
    const text = JSON.stringify(mix);
    if (text === shownMix && input.value) return;
    shownMix = text;
    input.value = mixLink(mix);
    if (code()?.open) drawQr("mix", input.value);
};

const copy = async (input: HTMLInputElement): Promise<void> => {
    input.select();
    const message = document.querySelector<HTMLElement>("[data-message='mix-link']");
    const button = document.querySelector<HTMLElement>("[data-mix-copy]");
    try {
        await navigator.clipboard.writeText(input.value);
        setInvalid(input, false);
        flashButton(button, "success");
        showMessage(message, "success", "Mix link copied.", { isQuiet: true });
    } catch {
        // There's nothing to fix in the box itself, so it's red only while the cross shows.
        setInvalid(input, true);
        flashButton(button, "error", () => setInvalid(input, false));
        const text = "Couldn't copy it: the link is selected, so copy it with Ctrl+C.";
        showMessage(message, "error", text, { isQuiet: true });
    }
};

export const wireMixLink = (): void => {
    const input = box();
    const details = code();
    if (!input || !details) return;
    input.addEventListener("click", () => void copy(input));
    document.querySelector("[data-mix-copy]")?.addEventListener("click", () => void copy(input));
    input.addEventListener("keydown", (event) => event.key === "Enter" && void copy(input));
    // Drawn when it's opened, from the link the box shows.
    details.addEventListener("toggle", () => details.open && drawQr("mix", input.value || mixLink()));
};
