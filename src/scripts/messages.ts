import { cloneIcon } from "./icons.ts";

/*
 * Messages shown where they belong: under the field they're about (InlineMessage.astro) or in the
 * notice bar at the top of the page (notice() in notices.ts). Each says what kind it is three
 * ways: an icon, its colour (src/styles/message.css) and, for screen readers, a word before it.
 */

export type MessageKind = "success" | "info" | "warning" | "error";

const kinds: Record<MessageKind, { icon: string; label: string }> = {
    success: { icon: "circle-check", label: "Done" },
    info: { icon: "info", label: "Note" },
    warning: { icon: "triangle-alert", label: "Warning" },
    error: { icon: "circle-x", label: "Error" },
};

/** Fills a .message element: the kind's icon, the kind for screen readers, then the text. */
export const fillMessage = (element: HTMLElement, kind: MessageKind, text: string): void => {
    const icon = document.createElement("span");
    icon.className = "message-icon";
    icon.append(...[cloneIcon(kinds[kind].icon, "#message-icons")].filter((svg) => svg !== null));
    const label = Object.assign(document.createElement("span"), {
        className: "visually-hidden",
        textContent: `${kinds[kind].label}: `,
    });
    const body = document.createElement("span");
    body.append(label, text);
    element.dataset["kind"] = kind;
    element.replaceChildren(icon, body);
};

/** Fills waiting to happen (showMessage), so clearing a message also stops one about to appear. */
const pendingFills = new WeakMap<HTMLElement, number>();

export const clearMessage = (element: HTMLElement): void => {
    window.clearTimeout(pendingFills.get(element));
    delete element.dataset["kind"];
    element.replaceChildren();
};

/**
 * Shows a message under a field, replacing what it said; `isQuiet` keeps it for screen readers
 * only, where a button already shows the outcome (button-feedback.ts). Emptied first and filled a
 * moment later, so the live region announces it even when it's the same message again.
 */
export const showMessage = (
    element: HTMLElement | null,
    kind: MessageKind,
    text: string,
    { isQuiet = false } = {},
): void => {
    if (!element) return;
    clearMessage(element);
    element.toggleAttribute("data-quiet", isQuiet);
    pendingFills.set(
        element,
        window.setTimeout(() => fillMessage(element, kind, text), 50),
    );
};
