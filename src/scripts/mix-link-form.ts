import { clearFeedback, flashButton, setInvalid } from "./button-feedback.ts";
import { snap } from "./engine-client.ts";
import { clearMessage, showMessage } from "./messages.ts";
import type { LinkReceiver } from "./mix-address.ts";

/*
 * The paste-a-mix-link boxes (Settings › Your mix, and the setup panel). What a link does depends
 * on the page's mode, so the controller hands in the receiver: apply it, or carry it.
 */

/**
 * Applied or refused, the Use button answers with a tick or a cross (a refused link turns the
 * box red until it's edited); kept for later, it says so under the box. Replacing a mix this
 * computer has asks first.
 */
const usePastedLink = (form: HTMLFormElement, receive: LinkReceiver): void => {
    const input = form.querySelector<HTMLInputElement>("[data-mix-link-input]")!;
    const question = "Replace this computer's mix with the one in the link?";
    if (snap().state.isMixOwned && !window.confirm(question)) return;
    const { kind, text } = receive(input.value);
    const isError = kind === "error";
    setInvalid(input, isError);
    if (!isError) input.value = "";
    const button = form.querySelector<HTMLElement>(".button--feedback");
    if (kind === "info") clearFeedback(button);
    else flashButton(button, isError ? "error" : "success");
    showMessage(form.querySelector<HTMLElement>("[data-message]"), kind, text, { isQuiet: kind !== "info" });
};

/** Editing a refused link takes the red off, and what was said about it. */
const onPasteEdited = (form: HTMLFormElement): void => {
    setInvalid(form.querySelector<HTMLInputElement>("[data-mix-link-input]")!, false);
    const message = form.querySelector<HTMLElement>("[data-message]");
    if (message) clearMessage(message);
};

export const wireMixPasteForms = (receive: LinkReceiver): void => {
    for (const form of document.querySelectorAll<HTMLFormElement>("[data-mix-paste]")) {
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            usePastedLink(form, receive);
        });
        form.addEventListener("input", () => onPasteEdited(form));
    }
};
